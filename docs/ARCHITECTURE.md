# Frontend Refactor Architecture (2026-03)

## Goals

- Keep functional behavior equivalent while reducing `App.tsx` complexity.
- Move toward a composition-first shell (`App` orchestrates, features/pages own logic).
- Enable route-level code splitting for tab pages and heavy modals.

## Current Structure

```text
apps/web/src/
  App.tsx                           # app orchestration (< 500 lines)
  components/
    ErrorBoundary.tsx
    ToastContainer.tsx
    Layout/
      MainLayout.tsx
      Sidebar.tsx
      AppTopbar.tsx
  features/
    notifications/
    audit/
    settings/
    runtime-config/
    agent-config/
    deploy-agent/
  hooks/
    useAgents.ts
    useProjects.ts
    useTasks.ts
    useSessions.ts
    useModels.ts
    useSSE.ts
  lib/
    api/
    adapters/
    modelAdapters.ts
    runtimeCollections.ts
    useRealData.ts
  pages/
    *Page.tsx                       # route/page entrypoints
    modals/
      *.tsx                         # modal entrypoints
    impl/
      GovernanceShared.tsx          # shared governance-level UI helpers
```

## Runtime Data Flow

1. `useRealData` pulls workspace/runtime collections from backend APIs.
2. `App.tsx` computes `activeModels` from managed models + runtime fallback.
3. `syncRuntimeCollections` writes normalized runtime collections for page/modal consumers.
4. Feature hooks (`useNotifications`, `useAuditLogs`, etc.) consume live collections.

## Rendering Model

- `App.tsx` handles:
  - auth bootstrap and login/setup/logout flows
  - active tab and selected project/agent state
  - notification navigation dispatch
  - modal visibility orchestration
- Page content is loaded with `React.lazy` + `Suspense`.
- Modal entrypoints are also lazy-loaded to avoid eager loading of heavy sections.

## Performance Notes

- Initial web entry chunk is significantly reduced after removing static `AppSections` imports from `App.tsx`.
- All grouped `pages/sections/*` files have been removed; pages/modals are now independent lazy entrypoints.

## Next Refactor Steps

1. Replace runtime global collection access with explicit props/hooks to remove shared mutable state.
2. Keep `App.tsx` as shell-only orchestration (state + routing + modal toggles).
3. Add lightweight UI smoke tests for each tab and modal path.
4. Continue import cleanup in extracted pages/modals to reduce maintenance overhead.
