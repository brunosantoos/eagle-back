import { z } from 'zod';
import { router, publicProcedure, contentProcedure } from '../trpc';
import { prisma } from '../db';
import { siteContentSchema, type SiteContent } from '../schemas/siteContent';

export const siteContentRouter = router({
  get: publicProcedure.query(async () => {
    const record = await prisma.siteContent.findUnique({
      where: { key: 'main' },
    });

    if (!record) {
      return null;
    }

    try {
      return JSON.parse(record.data) as SiteContent;
    } catch {
      return null;
    }
  }),

  update: contentProcedure
    .input(z.object({ data: siteContentSchema }))
    .mutation(async ({ input }) => {
      const record = await prisma.siteContent.upsert({
        where: { key: 'main' },
        update: {
          data: JSON.stringify(input.data),
        },
        create: {
          key: 'main',
          data: JSON.stringify(input.data),
        },
      });

      try {
        return JSON.parse(record.data) as unknown;
      } catch {
        return null;
      }
    }),

  reset: contentProcedure.mutation(async () => {
    await prisma.siteContent.deleteMany({ where: { key: 'main' } });
    return null;
  }),
});
