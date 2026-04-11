FROM node:20-alpine AS builder

RUN corepack enable
WORKDIR /app

COPY package.json ./
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts
COPY jest.config.cjs ./

RUN pnpm install --no-frozen-lockfile
RUN pnpm build

FROM node:20-alpine

RUN corepack enable
WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY .env.example ./

EXPOSE 8787

CMD ["node", "dist/src/main.js"]
