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
  trustedOrigins: [
    process.env.CORS_ORIGIN ?? 'http://localhost:5173',
    'http://localhost:3000',
  ],
});

export type AuthUser = typeof auth.$Infer.Session.user;
