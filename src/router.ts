import { router } from './trpc';
import { adminUsersRouter } from './routers/adminUsers';
import { siteContentRouter } from './routers/siteContent';
import { franchiseLeadsRouter } from './routers/franchiseLeads';
import { contactSubmissionsRouter } from './routers/contactSubmissions';
import { emailSettingsRouter } from './routers/emailSettings';
import { storageSettingsRouter } from './routers/storageSettings';

export const appRouter = router({
  adminUsers: adminUsersRouter,
  siteContent: siteContentRouter,
  franchiseLeads: franchiseLeadsRouter,
  contactSubmissions: contactSubmissionsRouter,
  emailSettings: emailSettingsRouter,
  storageSettings: storageSettingsRouter,
});

export type AppRouter = typeof appRouter;
