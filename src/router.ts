import { router } from './trpc';
import { adminUsersRouter } from './routers/adminUsers';
import { siteContentRouter } from './routers/siteContent';
import { franchiseLeadsRouter } from './routers/franchiseLeads';
import { contactSubmissionsRouter } from './routers/contactSubmissions';

export const appRouter = router({
  adminUsers: adminUsersRouter,
  siteContent: siteContentRouter,
  franchiseLeads: franchiseLeadsRouter,
  contactSubmissions: contactSubmissionsRouter,
});

export type AppRouter = typeof appRouter;
