---
'@rawdash/sdk-client': minor
'@rawdash/sdk-nextjs': minor
---

Rename frontend SDK packages with an `sdk-` prefix to make the namespace consistent with the upcoming `@rawdash/sdk-runtime` package and the existing `connector-*` family.

- `@rawdash/client` → `@rawdash/sdk-client`
- `@rawdash/nextjs` → `@rawdash/sdk-nextjs`

There are no deprecated aliases or re-exports under the old names. To upgrade, update your `package.json` dependencies and run a find-and-replace across imports:

```bash
# in your repo
sed -i '' -e 's|@rawdash/client|@rawdash/sdk-client|g' \
         -e 's|@rawdash/nextjs|@rawdash/sdk-nextjs|g' \
         $(git ls-files '*.ts' '*.tsx' '*.js' '*.mjs' '*.json')
```

`@rawdash/sdk-nextjs` now also re-exports the public `DataSource`, sync-state types, and `isSyncActive` / `ACTIVE_SYNC_STATUSES` helpers from `@rawdash/core`, so most apps no longer need a direct `@rawdash/core` import to type their data source helpers.
