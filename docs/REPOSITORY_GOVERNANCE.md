# Repository Governance Standard

This document defines the repository storage and collaboration standard for local development, GitHub, and GitLab. The goal is to reduce maintenance drift and keep the release path understandable even when multiple agents or teammates work in parallel.

## 1. Source of Truth

- Source code lives in `apps/`, `packages/`, and `scripts/`.
- Product and engineering documentation lives in `docs/`.
- Public site assets live in `site/`.
- Local runtime data, caches, local databases, and operator exports are not source-of-truth artifacts.

Desktop exports, runtime caches, and local OpenClaw state may exist for operations, but the repository version is the canonical history for engineering review.

## 2. Remote Standard

Use consistent remote names:

- `origin`: GitHub primary repository
- `gitlab`: GitLab mirror or delivery repository

Recommended setup:

```bash
git remote set-url origin <your-github-repo-url>
git remote add gitlab <your-gitlab-repo-url>
git remote -v
```

If GitLab is not ready yet, reserve the `gitlab` remote name and document the missing URL before enabling automation.

## 3. Branching Model

- `main`: releasable code only
- `codex/*`: Codex-driven work branches
- `feature/*`: feature delivery
- `fix/*`: bug fixes
- `chore/*`: maintenance
- `release/*`: release preparation
- `hotfix/*`: emergency production fixes

All changes should flow into `main` through a PR or MR, not through direct pushes.

## 4. Review Contract

Every PR and MR must include:

- summary
- scope
- validation evidence
- risk and rollback note
- `handoff`
- `openQuestions`

`handoff` and `openQuestions` are mandatory because downstream protocol checks depend on them. If there are no open questions, use `none`.

## 5. Package and Lockfile Policy

- `pnpm` is the canonical package manager for this repository.
- `pnpm-lock.yaml` must stay tracked.
- CI must install with the repository lockfile so local, GitHub, and GitLab pipelines resolve dependencies consistently.

If other lockfiles exist, treat them as legacy compatibility artifacts until they are explicitly removed in an isolated cleanup change.

## 6. Storage Boundaries

Commit:

- application source
- Prisma schema and migration metadata
- deterministic CI/CD configuration
- documentation that explains shipped behavior

Do not commit:

- `.env`
- `.occ-secret`
- private OpenClaw workspace data
- local SQLite data containing private runtime state
- caches such as `.cache/`, `.turbo/`, `.runtime/`
- ad hoc desktop exports or screenshots unless the repo intentionally versions them

## 7. GitHub Standard

For GitHub, enable the following on `main`:

- protected branch or ruleset
- required pull request reviews
- required status checks for CI
- Code Owner review when protected files change
- automatic deletion of merged branches if your team wants a shorter-lived branch history

Repository files added for GitHub:

- `CODEOWNERS`
- `.github/pull_request_template.md`
- existing `.github/workflows/*.yml`

## 8. GitLab Standard

For GitLab, enable the following on `main`:

- protected branch
- merge request workflow for protected branches
- successful pipeline requirement
- Code Owner approval on the protected branch
- optional approval rules for domains like backend, frontend, or security

Repository files added for GitLab:

- `CODEOWNERS`
- `.gitlab/merge_request_templates/Default.md`
- `.gitlab-ci.yml`

## 9. Local Working Copy Standard

- Keep a clean branch for governance or release work whenever possible.
- Do not mix feature delivery, CI changes, and documentation cleanup in one review unless the changes are tightly coupled.
- Before release or handoff, run:

```bash
pnpm typecheck
pnpm build
pnpm health:check
pnpm test:smoke
```

For database-sensitive changes, also run:

```bash
pnpm db:baseline
pnpm --filter @occ/api db:migrate:status
```

## 10. Official References

- GitHub CODEOWNERS:
  - https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners
- GitHub pull request templates:
  - https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/creating-a-pull-request-template-for-your-repository
- GitHub protected branches:
  - https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
- GitLab Code Owners:
  - https://docs.gitlab.com/user/project/codeowners/
- GitLab description templates:
  - https://docs.gitlab.com/user/project/description_templates/
- GitLab protected branches:
  - https://docs.gitlab.com/user/project/repository/branches/protected/
- Git attributes:
  - https://git-scm.com/docs/gitattributes
- EditorConfig:
  - https://editorconfig.org/
- pnpm install and lockfile behavior:
  - https://pnpm.io/cli/install
