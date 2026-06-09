import { z } from 'zod';
import { router, publicProcedure, adminProcedure, leadsProcedure } from '../trpc';
import { prisma } from '../db';

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
    .mutation(async ({ input }) => {
      return prisma.contactSubmission.create({
        data: {
          name: input.name,
          email: input.email,
          phone: input.phone ?? '',
          message: input.message,
        },
      });
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
