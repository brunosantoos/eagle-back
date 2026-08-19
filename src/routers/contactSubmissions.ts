import { z } from 'zod';
import { router, publicProcedure, adminProcedure, leadsProcedure } from '../trpc';
import { prisma } from '../db';
import {
  contactCustomerEmail,
  contactTeamEmail,
  dispatchFormEmails,
} from '../lib/email';
import { enforceRateLimit } from '../lib/rateLimit';

const CONTACT_STATUSES = ['novo', 'lido', 'respondido'] as const;

export const contactSubmissionsRouter = router({
  list: leadsProcedure.query(async () => {
    return prisma.contactSubmission.findMany({
      orderBy: { createdAt: 'desc' },
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
        data: { status: input.status },
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

  delete: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await prisma.contactSubmission.delete({ where: { id: input.id } });
      return { success: true };
    }),
});
