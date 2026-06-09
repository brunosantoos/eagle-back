import { PrismaClient } from '@prisma/client';
import { hashPassword } from 'better-auth/crypto';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.user.findUnique({ where: { email: 'admin@admin.com' } });

  if (!existing) {
    const hashedPassword = await hashPassword('admin@123');
    const userId = randomUUID();
    const now = new Date();

    await prisma.user.create({
      data: {
        id: userId,
        name: 'Admin',
        email: 'admin@admin.com',
        emailVerified: true,
        role: 'admin',
        active: true,
        createdAt: now,
        updatedAt: now,
      },
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

    console.log('Seeded admin user: admin@admin.com / admin@123');
  } else {
    console.log('Admin user already exists, skipping.');
  }

  await prisma.siteContent.upsert({
    where: { key: 'main' },
    update: {},
    create: { key: 'main', data: JSON.stringify({}) },
  });

  console.log('Seeded site content key: main');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
