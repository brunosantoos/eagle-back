import { initTRPC, TRPCError } from '@trpc/server';
import type { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from './auth';

export interface Context {
  userId?: string;
  userRole?: string;
}

export async function createContext({ req }: CreateExpressContextOptions): Promise<Context> {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });

  if (!session?.user) return {};

  const user = session.user as { id: string; role?: string; active?: boolean };
  if (user.active === false) return {};

  return {
    userId: user.id,
    userRole: user.role ?? 'editor',
  };
}

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  return next({
    ctx: {
      ...ctx,
      userId: ctx.userId,
    },
  });
});

export const adminProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  if (ctx.userRole !== 'admin') {
    throw new TRPCError({ code: 'FORBIDDEN' });
  }
  return next({
    ctx: {
      ...ctx,
      userId: ctx.userId,
      userRole: ctx.userRole,
    },
  });
});

export const leadsProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  if (ctx.userRole !== 'admin' && ctx.userRole !== 'user') {
    throw new TRPCError({ code: 'FORBIDDEN' });
  }
  return next({
    ctx: { ...ctx, userId: ctx.userId, userRole: ctx.userRole },
  });
});

export const contentProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  if (ctx.userRole !== 'admin' && ctx.userRole !== 'editor') {
    throw new TRPCError({ code: 'FORBIDDEN' });
  }
  return next({
    ctx: { ...ctx, userId: ctx.userId, userRole: ctx.userRole },
  });
});
