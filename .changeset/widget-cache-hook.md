---
'@rawdash/server': patch
'@rawdash/hono': patch
---

Add an optional `WidgetCache` hook to `listWidgets` / `getWidget` (`@rawdash/server`) and `createWidgetsRouter` (`@rawdash/hono`). Deployments can plug in any cache (in-memory LRU, KV, Redis, …) without forking the resolver; the impl owns TTL, eviction, and the backing store. When omitted, behavior is unchanged. `createWidgetsRouter` accepts a `cache: (c: Context) => WidgetCache` factory invoked once per request, so the cache can be scoped to the request's tenant/auth context. Cache errors are isolated — `get` failures fall through to fresh resolution, `set` failures are logged via `console.warn`.
