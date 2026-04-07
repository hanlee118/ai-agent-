# Contributing Guide

This repository uses a single engineering workflow for local development, GitHub pull requests, and GitLab merge requests. The goal is to keep review, release, and rollback paths predictable.

## Tooling Baseline

- Node.js: 20.x
- Package manager: `pnpm@10.32.1`
- Canonical lockfile: `pnpm-lock.yaml`
- Default branch: `main`

Use `pnpm` for installs, builds, tests, and release validation. Do not switch CI or local automation to `npm` unless the repository explicitly adopts that change in a separate governance update.

## Branch Naming

Use short-lived branches with clear intent:

- `codex/*` for Codex-driven work
- `feature/*` for product features
- `fix/*` for bug fixes
- `chore/*` for maintenance or tooling work
- `release/*` for release preparation
- `hotfix/*` for urgent production fixes

Examples:

- `codex/repository-governance`
- `feature/gitlab-harness-webhook`
- `fix/runtime-config-validation`

## Commit Convention

Use Conventional Commits where practical:

- `feat:`
- `fix:`
- `refactor:`
- `docs:`
- `test:`
- `chore:`
- `ci:`
- `build:`

Keep commits reviewable and focused. If a change mixes feature work with repository governance, split it into separate commits when possible.

## Local Development

1. Install dependencies with `pnpm install`.
2. Generate Prisma client with `pnpm --filter @occ/api db:generate`.
3. Prepare the local database with `pnpm --filter @occ/api db:push`.
4. Start services with `pnpm dev:api` and `pnpm dev:web`.

Before opening a PR or MR, run:

```bash
pnpm typecheck
pnpm build
pnpm health:check
pnpm test:smoke
```

If your change touches database flows or release gates, also run:

```bash
pnpm db:baseline
pnpm --filter @occ/api db:migrate:status
```

## Review Checklist

Every PR/MR should include:

- clear scope and business intent
- validation steps actually executed locally
- risks, rollback notes, or follow-up items
- `handoff` section for the next owner or operator
- `openQuestions` section, even if the value is `none`

If a change updates product behavior, also update the relevant files under `docs/`.

## Storage Rules

- Commit source code, schemas, docs, and deterministic build/test configuration.
- Do not commit secrets, personal credentials, or local OpenClaw private config.
- Treat SQLite runtime data, caches, generated artifacts, and desktop exports as local-only unless a document explicitly states they are source-of-truth assets.
- Keep `pnpm-lock.yaml` tracked. CI and teammate installs depend on it for reproducibility.

## Remote Layout

- `origin`: GitHub primary remote
- `gitlab`: GitLab mirror or delivery remote

If GitLab is not configured yet, keep the remote name reserved so later automation and docs do not drift.

## Platform Expectations

- GitHub: protect `main`, require PR review, require CI status checks, and require Code Owner review where applicable.
- GitLab: protect `main`, require merge requests for protected branches, enable pipeline success checks, and enable Code Owner approval on the protected branch.

See `docs/REPOSITORY_GOVERNANCE.md` for the full cross-platform standard.
