# Production Checklist

## 1. Environment

- Copy `apps/api/.env.example` to `apps/api/.env`
- Confirm `DATABASE_URL` points to `file:./prisma/dev.db`
- Confirm `MODEL_PROVIDER`, `MODEL_API_BASE_URL`, `MODEL_NAME`, `MODEL_API_KEY` are complete if you want real model mode
- If deploying to cloud or Docker, explicitly set `OPENCLAW_ROOT`, `OPENCLAW_CONFIG_PATH`, `OPENCLAW_WORKSPACE_ROOT`
- Do not commit `.env`, `.occ-secret`, or any real OpenClaw private config

## 2. Database

- Run `pnpm --filter @occ/api db:generate`
- Run `pnpm --filter @occ/api db:push`
- If Prisma SQLite returns a schema-engine error on your machine, run `pnpm --filter @occ/api db:bootstrap` and then `pnpm --filter @occ/api db:seed`
- Confirm the SQLite file exists at `apps/api/prisma/dev.db`
- Check the System page `Platform Readiness` card and confirm:
  - database file exists
  - managed agent count is non-zero
  - memory rows and usage logs can be written

## 3. OpenClaw Integration

- Confirm `~/.openclaw/openclaw.json` exists
- Confirm `~/.openclaw/workspace` exists
- If using a mounted data disk, confirm your configured `OPENCLAW_*` paths resolve correctly
- Open the System page and verify:
  - `OpenClaw config` path is detected
  - `Workspace root` path is detected
  - `liveWorkspaceAgentCount` is non-zero
- Open `Agents` and confirm you can:
  - create an agent
  - switch models
  - change token limits
  - edit SOUL and SOP
  - add long-term memory

## 4. Verification

- Run `pnpm typecheck`
- Run `pnpm build`
- Run `pnpm verify:local`
- Start the API with `node apps/api/dist/index.js`
- Run `pnpm verify:smoke`
- Prefer `pnpm test:smoke` as the final release gate
- Check `http://localhost:8787/health`
- Check `http://localhost:8787/ready`
- Log in to the web app and validate:
  - Dashboard loads
  - Agents page shows real OpenClaw agents
  - Agent Commander updates are persisted after refresh
  - System page shows no unresolved readiness warnings for your target environment
  - System page local monitor receives realtime snapshots without manual refresh
  - Cost governance cards show aggregated tokens and cost figures by tool

## 5. GitHub Publishing

- Review `.gitignore`
- Avoid committing `apps/api/prisma/dev.db` if it contains private data
- Avoid committing `aistudio/` assets if they contain licensed or private design material
- Prefer publishing with:
  - `README.md`
  - `docs/product-requirements.md`
  - `docs/technical-architecture.md`
  - `docs/ui-design.md`
  - `docs/PRODUCTION_CHECKLIST.md`
  - `docs/DEPLOYMENT_GUIDE.md`
