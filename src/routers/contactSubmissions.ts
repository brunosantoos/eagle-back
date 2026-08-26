import { z } from 'zod';
import { router, publicProcedure, adminProcedure, leadsProcedure } from '../trpc';
import { prisma } from '../db';
import {
  contactCustomerEmail,
  contactTeamEmail,
  dispatchFormEmails,
} from '../lib/email';
import { enforceRateLimit } from '../lib/rateLimit';
import { purgeExpiredTrash } from '../lib/trash';

const CONTACT_STATUSES = ['novo', 'lido', 'respondido'] as const;

/** Registro excluído some das listas — ver `lib/trash.ts`. */
const NOT_DELETED = { deletedAt: null };

export const contactSubmissionsRouter = router({
  list: leadsProcedure.query(async () => {
    // Momento natural para o expurgo: alguém abriu o painel, e o custo é um
    // deleteMany indexado por deletedAt.
    void purgeExpiredTrash();
    return prisma.contactSubmission.findMany({
      where: NOT_DELETED,
      orderBy: { createdAt: 'desc' },
    });
  }),

  /** Conteúdo da lixeira, do mais recente para o mais antigo. */
  listDeleted: leadsProcedure.query(async () => {
    void purgeExpiredTrash();
    return prisma.contactSubmission.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
    });
  }),

  create: publicProcedure
    .input(z.object({
      name: z.string().min(1),
      email: z.string().email(),
      phone: z.string().optional().default(''),
      message: z.string().min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      enforceRateLimit('contact', ctx.ip);
      // Segundo limite pelo destinatário: o e-mail de confirmação vai para um
      // endereço fornecido por quem envia, então IP rotativo não pode virar
      // ferramenta de spam contra um terceiro.
      enforceRateLimit('contact-email', input.email.trim().toLowerCase(), {
        windowMs: 60 * 60 * 1000,
        max: 3,
      });

      const submission = await prisma.contactSubmission.create({
        data: {
          name: input.name,
          email: input.email,
          phone: input.phone ?? '',
          message: input.message,
        },
      });

      // Confirmação para o cliente + notificação para a equipe.
      // Em background: falha de e-mail não derruba o envio do formulário.
      const payload = {
        name: submission.name,
        email: submission.email,
        phone: submission.phone,
        message: submission.message,
      };
      dispatchFormEmails((settings) => [
        contactCustomerEmail(payload, settings),
        contactTeamEmail(payload, settings),
      ]);

      return submission;
    }),

  updateStatus: leadsProcedure
    .input(z.object({
      id: z.string(),
      status: z.enum(CONTACT_STATUSES),
    }))
    .mutation(async ({ input }) => {
      return prisma.contactSubmission.update({
        where: { id: input.id },
        data: {
          status: input.status,
          // Carimba quando entra em "respondido" e limpa ao voltar atrás — é o
          // que sustenta o "respondida em X dias" e o cálculo de atraso.
          respondedAt: input.status === 'respondido' ? new Date() : null,
        },
      });
    }),

  updateNotes: leadsProcedure
    .input(z.object({
      id: z.string(),
      notes: z.string(),
    }))
    .mutation(async ({ input }) => {
      return prisma.contactSubmission.update({
        where: { id: input.id },
        data: { notes: input.notes },
      });
    }),

  /** Manda para a lixeira. O registro continua no banco. */
  delete: leadsProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await prisma.contactSubmission.update({
        where: { id: input.id },
        data: { deletedAt: new Date() },
      });
      return { success: true };
    }),

  /** Tira da lixeira e devolve para o quadro. */
  restore: leadsProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await prisma.contactSubmission.update({
        where: { id: input.id },
        data: { deletedAt: null },
      });
      return { success: true };
    }),

  /** Exclusão definitiva — só admin, e sem volta. */
  purge: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await prisma.contactSubmission.delete({ where: { id: input.id } });
      return { success: true };
    }),

  /** Esvazia a lixeira de contatos de uma vez — só admin. */
  purgeAll: adminProcedure.mutation(async () => {
    const { count } = await prisma.contactSubmission.deleteMany({
      where: { deletedAt: { not: null } },
    });
    return { count };
  }),
});
