FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile
RUN pnpm exec prisma generate

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
RUN pnpm run build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
RUN mkdir -p /app/uploads
EXPOSE 3033
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
