import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { prisma } from './db';

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3001',
  secret: process.env.BETTER_AUTH_SECRET ?? 'better-auth-dev-secret-2024',
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },
  user: {
    additionalFields: {
      role: {
        type: 'string',
        required: false,
        defaultValue: 'editor',
        input: false,
      },
      active: {
        type: 'boolean',
        required: false,
        defaultValue: true,
        input: false,
      },
    },
  },
  // Qualquer origem: '*' casa com qualquer host no matcher do better-auth.
  trustedOrigins: ['*'],
  advanced: {
    // Desliga a checagem de CSRF/origem do better-auth — senão o login continua
    // recusando request de origem não listada, mesmo com o CORS aberto.
    disableCSRFCheck: true,
  },
});

export type AuthUser = typeof auth.$Infer.Session.user;
