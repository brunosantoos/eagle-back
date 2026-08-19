import { z } from 'zod';
import { router, publicProcedure, adminProcedure, leadsProcedure } from '../trpc';
import { prisma } from '../db';
import {
  dispatchFormEmails,
  franchiseCustomerEmail,
  franchiseTeamEmail,
} from '../lib/email';
import { enforceRateLimit } from '../lib/rateLimit';

const FRANCHISE_STATUSES = ['novo', 'contatado', 'qualificado', 'encerrado'] as const;

export const franchiseLeadsRouter = router({
  list: leadsProcedure.query(async () => {
    return prisma.franchiseLead.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }),

  create: publicProcedure
    .input(z.object({
      name: z.string().min(1),
      email: z.string().email(),
      phone: z.string().min(1),
      city: z.string().min(1),
      capital: z.string().min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      enforceRateLimit('franchise', ctx.ip);
      // Ver comentário em contactSubmissions: limite por destinatário evita
      // usar a confirmação automática como spam contra terceiros.
      enforceRateLimit('franchise-email', input.email.trim().toLowerCase(), {
        windowMs: 60 * 60 * 1000,
        max: 3,
      });

      const lead = await prisma.franchiseLead.create({
        data: {
          name: input.name,
          email: input.email,
          phone: input.phone,
          city: input.city,
          capital: input.capital,
        },
      });

      // Confirmação para o interessado + notificação para a equipe (background).
      const payload = {
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        city: lead.city,
        capital: lead.capital,
      };
      dispatchFormEmails((settings) => [
        franchiseCustomerEmail(payload, settings),
        franchiseTeamEmail(payload, settings),
      ]);

      return lead;
    }),

  updateStatus: leadsProcedure
    .input(z.object({
      id: z.string(),
      status: z.enum(FRANCHISE_STATUSES),
    }))
    .mutation(async ({ input }) => {
      return prisma.franchiseLead.update({
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
      return prisma.franchiseLead.update({
        where: { id: input.id },
        data: { notes: input.notes },
      });
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await prisma.franchiseLead.delete({ where: { id: input.id } });
      return { success: true };
    }),
});
