import { z } from 'zod';
import { hashPassword } from 'better-auth/crypto';
import { TRPCError } from '@trpc/server';
import { randomUUID } from 'crypto';
import { router, adminProcedure } from '../trpc';
import { prisma } from '../db';

const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const adminUsersRouter = router({
  list: adminProcedure.query(async () => {
    return prisma.user.findMany({
      select: userSelect,
      orderBy: { createdAt: 'asc' },
    });
  }),

  create: adminProcedure
    .input(
      z.object({
        name: z.string().min(1),
        email: z.string().email(),
        password: z.string().min(6),
        role: z.enum(['admin', 'editor', 'user']),
        active: z.boolean(),
      }),
    )
    .mutation(async ({ input }) => {
      const existing = await prisma.user.findUnique({
        where: { email: input.email.trim().toLowerCase() },
      });

      if (existing) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Email already in use' });
      }

      const hashedPassword = await hashPassword(input.password);
      const userId = randomUUID();
      const now = new Date();

      const user = await prisma.user.create({
        data: {
          id: userId,
          name: input.name,
          email: input.email.trim().toLowerCase(),
          emailVerified: false,
          role: input.role,
          active: input.active,
          createdAt: now,
          updatedAt: now,
        },
        select: userSelect,
      });

      await prisma.account.create({
        data: {
          id: randomUUID(),
          accountId: userId,
          providerId: 'credential',
          userId: userId,
          password: hashedPassword,
          createdAt: now,
          updatedAt: now,
        },
      });

      return user;
    }),

  update: adminProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).optional(),
        email: z.string().email().optional(),
        password: z.string().min(6).optional(),
        role: z.enum(['admin', 'editor', 'user']).optional(),
        active: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { id, password, email, ...rest } = input;

      const updateData: Record<string, unknown> = { ...rest, updatedAt: new Date() };
      if (email !== undefined) {
        updateData.email = email.trim().toLowerCase();
      }

      try {
        const user = await prisma.user.update({
          where: { id },
          data: updateData,
          select: userSelect,
        });

        if (password !== undefined) {
          const hashedPassword = await hashPassword(password);
          await prisma.account.updateMany({
            where: { userId: id, providerId: 'credential' },
            data: { password: hashedPassword, updatedAt: new Date() },
          });
        }

        return user;
      } catch {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const targetUser = await prisma.user.findUnique({ where: { id: input.id } });

      if (!targetUser) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }

      if ((targetUser as any).role === 'admin' && (targetUser as any).active) {
        const activeAdminCount = await prisma.user.count({
          where: { role: 'admin', active: true },
        });
        if (activeAdminCount <= 1) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Cannot delete the last active admin',
          });
        }
      }

      await prisma.user.delete({ where: { id: input.id } });
      return { success: true };
    }),
});
