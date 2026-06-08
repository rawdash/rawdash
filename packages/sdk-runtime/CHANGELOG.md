# @rawdash/sdk-runtime

## 0.19.0

### Patch Changes

- Updated dependencies [725ebcc]
  - @rawdash/core@0.19.0
  - @rawdash/sdk-client@0.19.0

## 0.18.0

### Patch Changes

- @rawdash/core@0.18.0
- @rawdash/sdk-client@0.18.0

## 0.17.0

### Patch Changes

- @rawdash/core@0.17.0
- @rawdash/sdk-client@0.17.0

## 0.16.0

### Minor Changes

- 7060534: **New:** `@rawdash/sdk-runtime` — framework-agnostic auto-polling subscription engine that drives client-side dashboards from the schedule the server already publishes (`cachedAt` + `syncIntervalSeconds` on each `CachedWidget`).

  Per-widget state machine handles every `WidgetSyncState` branch: `fresh` advances notify subscribers and sleep until the next expected sync; mid-flight `syncing` polls fast (capped); late syncs back off (3s → 6s → 12s, capped at 30s) and resume normal scheduling after 2× the interval; `failing` / `stale` fires once and backs off ≥ 1 min; `unsynced` polls moderately. Pauses when `document.hidden` and resumes on visibility/focus.

  **Wire:** `CachedWidget` now carries `syncIntervalSeconds?: number` so clients can schedule polling without an extra request.

  **Next.js:** `@rawdash/sdk-nextjs` exposes client-side hooks at the `/client` subpath:

  ```tsx
  'use client';

  import { http } from '@rawdash/sdk-nextjs';
  import { useDashboard, useWidget } from '@rawdash/sdk-nextjs/client';

  const source = http({ baseUrl: '/rawdash' });

  export function MyWidget() {
    const { widget } = useWidget(source, 'main', 'revenue');
    return <div>{widget?.data}</div>;
  }
  ```

  Hooks add `react >= 18` as a peer dependency. Server-side `createRawdashClient` / `revalidateTag` flow is unchanged — import it from `@rawdash/sdk-nextjs` as before.

### Patch Changes

- Updated dependencies [422b711]
- Updated dependencies [79fdd64]
- Updated dependencies [a1c4c66]
- Updated dependencies [074ec25]
- Updated dependencies [022cbf1]
- Updated dependencies [e104540]
- Updated dependencies [9169ceb]
- Updated dependencies [5026a5b]
- Updated dependencies [c27c332]
- Updated dependencies [9318670]
- Updated dependencies [e8b014a]
- Updated dependencies [7060534]
- Updated dependencies [d52a6a8]
- Updated dependencies [d17a523]
  - @rawdash/core@0.16.0
  - @rawdash/sdk-client@0.16.0
