FROM node:20-alpine

RUN apk add --no-cache bash sqlite curl ca-certificates

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --no-frozen-lockfile

COPY . .

RUN pnpm --filter @occ/shared build \
  && pnpm --filter @occ/api db:generate \
  && pnpm --filter @occ/api build

VOLUME ["/app/prisma", "/app/.occ-secret", "/app/uploads"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:10000/api/health || exit 1

EXPOSE 10000

CMD ["sh", "-c", "pnpm --filter @occ/api exec prisma migrate deploy && ./scripts/start-render.sh"]
