# Agent Collaboration Platform v2.1

NestJS + TypeORM implementation for v2.1 workflow engine:
- Three project modes: `complete` / `standalone` / `relay`
- Knowledge system with document ingestion, text knowledge CRUD, retrieval, and Hermes sync endpoints
- Dual-agent router (Hermes/OpenClaw) with dynamic assignment and hybrid execution
- Stage quality gates (`artifact_exists`, `quality_gate`, `manual_approval`, `auto_check`)
- Stitch integration hook for design-stage artifact enrichment
- Skill learning loop with extraction, observation window, and refinement

## Quick Start

1. Install dependencies

```bash
pnpm install
```

2. Start infrastructure (Postgres + Redis + optional mocks)

```bash
cd apps/platform-v21
docker compose up -d
```

3. Configure env

```bash
cp .env.example .env
```

4. Run migrations and seed

```bash
pnpm --filter @occ/platform-v21 migration:run
pnpm --filter @occ/platform-v21 seed
```

5. Start service

```bash
pnpm --filter @occ/platform-v21 start:dev
```

Service defaults to `http://localhost:3310`.

## API Entry

- Swagger: `http://localhost:3310/api/docs`
- Health: `http://localhost:3310/health`

Main APIs:
- Projects: `/api/v1/projects`
- Skills: `/api/v1/skills`
- Knowledge: `/api/v1/knowledge`

Hermes sync APIs:
- `GET /api/v1/skills/for-hermes`
- `POST /api/v1/skills/import/hermes`
- `GET /api/v1/knowledge/for-hermes`
- `POST /api/v1/knowledge/sync-from-hermes`

## Test & Build

```bash
pnpm --filter @occ/platform-v21 typecheck
pnpm --filter @occ/platform-v21 test
pnpm --filter @occ/platform-v21 build
```

## Important Env Vars

- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASS`
- `DB_MIGRATIONS_RUN`
- `OPENAI_API_KEY`, `OPENAI_CHAT_MODEL`, `OPENAI_EMBEDDING_MODEL`
- `HERMES_MCP`, `HERMES_FALLBACK_URL`
- `OPENCLAW_API`
- `STITCH_API`
- `SKILL_OBSERVATION_PERIOD_HOURS`, `SKILL_AUTO_EXTRACT_THRESHOLD`, `SKILL_REFINEMENT_TRIGGER_USES`
