# Frontend Smoke Checklist

## Auth Flow

- [ ] First-time setup path works (`/api/auth/setup`).
- [ ] Login works (`/api/auth/login`).
- [ ] Logout returns to locked state.

## Dashboard & Navigation

- [ ] Sidebar tab switching works for all main tabs.
- [ ] Dashboard cards can navigate to projects/agents/model center.
- [ ] Notification center can jump to target tab.

## Project / Agent Flows

- [ ] New project modal can create project (with confirmation step).
- [ ] Project room can display real project/task status.
- [ ] Agent commander send flow shows confirmation card before execute.
- [ ] Deploy agent modal can create a new agent.
- [ ] Agent config modal can save config.

## Runtime & Monitoring

- [ ] OpenClaw workspace data loads from API.
- [ ] Monitoring/System tabs render dynamic metrics, not fallback mock text.
- [ ] SSE endpoint `/api/openclaw/events` can connect without 404.

## Audit & Settings

- [ ] Audit tab can search/filter logs.
- [ ] Settings panel can load and persist runtime config.

## Build Verification

- [ ] `pnpm --filter @occ/web build` passes.
- [ ] `pnpm run build` passes.

