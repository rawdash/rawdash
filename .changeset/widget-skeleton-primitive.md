---
'@rawdash/sdk-nextjs': minor
---

**New:** `Skeleton` primitive exported from `@rawdash/sdk-nextjs/skeleton`. A dependency-free pulsing placeholder that consumers can use to render loading states keyed off `CachedWidget.syncState` (`syncing` / `unsynced`) without pulling in a styling framework.

Use it to replace static "Not yet synced" placeholders with a real loading affordance:

```tsx
import { Skeleton } from '@rawdash/sdk-nextjs/skeleton';

if (widget.data === null && widget.syncState !== 'failing') {
  return <Skeleton width="60%" height="2.5rem" />;
}
```

The component injects a keyframe `<style>` tag with React 19's `precedence` dedup, so multiple skeletons on the same page share a single animation rule.
