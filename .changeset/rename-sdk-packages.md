---
'@rawdash/sdk-client': minor
'@rawdash/sdk-nextjs': minor
---

**Breaking:** the two frontend SDK packages have been renamed with an `sdk-` prefix so the namespace stays consistent as more SDK-layer packages land (notably the upcoming `@rawdash/sdk-runtime`).

- `@rawdash/client` → `@rawdash/sdk-client`
- `@rawdash/nextjs` → `@rawdash/sdk-nextjs`

There are no compatibility shims under the old names. The old packages are deprecated on npm — installing them will print a pointer to the new names but will not be republished.

## Migration

### 1. Swap the dependencies in `package.json`

```bash
npm uninstall @rawdash/client @rawdash/nextjs
npm install @rawdash/sdk-client @rawdash/sdk-nextjs
# or: pnpm remove ... && pnpm add ...
# or: yarn remove ...   && yarn add ...
```

Only install the packages you were already using.

### 2. Update imports across your codebase

Two literal replacements, nothing else changes:

- `@rawdash/client` → `@rawdash/sdk-client`
- `@rawdash/nextjs` → `@rawdash/sdk-nextjs`

A portable one-liner that works on macOS and Linux:

```bash
git grep -lE '@rawdash/(client|nextjs)' \
  | xargs perl -i -pe 's{\@rawdash/client\b}{\@rawdash/sdk-client}g; s{\@rawdash/nextjs\b}{\@rawdash/sdk-nextjs}g'
```

The `\b` word boundary is important — without it, a naive replace would corrupt `@rawdash/connector-*` paths or any future `@rawdash/client-*` / `@rawdash/nextjs-*` package names.

### 3. Drop any `@rawdash/core` imports that only existed for types

`@rawdash/sdk-nextjs` now re-exports the public consumer surface from `@rawdash/core` — `DataSource`, `CachedWidget`, `HealthResponse`, `SyncState`, `SyncStatus`, `TriggerSyncResponse`, `WidgetSyncState`, `WidgetsListResponse`, plus the `isSyncActive` / `ACTIVE_SYNC_STATUSES` helpers. If you only imported `@rawdash/core` to type a `DataSource` helper, you can now pull it from `@rawdash/sdk-nextjs` instead and remove the direct `@rawdash/core` dependency from your app.

No runtime, wire-format, or API-shape changes. The version of both packages is bumped to a `minor` per the pre-1.0 breaking-change policy.
