# @rawdash/connector-shared

Internal shared substrate for Rawdash connectors. Today it's the HTTP client — User-Agent, timeouts, retry/backoff, rate-limit parsing, pagination, and typed errors. Future additions (auth helpers, common types, signing) will land here too rather than spawning more `connector-*-shared` packages until a real split is justified.

> **Internal package.** `"private": true` — not published to npm. Workspace consumers reference via `workspace:*`.

## Why

Every connector ends up writing the same five pieces of code badly:

1. A bare `fetch` call with custom headers.
2. A 4xx/5xx check that throws a generic `Error`.
3. A while loop for pagination that often misses the boundary case.
4. An ad-hoc retry helper.
5. A forgotten `User-Agent` header.

This package gives connectors a small substrate so the per-API code becomes "URL, parse function, rate-limit policy" — nothing more.

## Quick start

```ts
import { request } from '@rawdash/connector-shared';

const res = await request<{ name: string }>({
  url: 'https://api.example.com/v1/me',
  headers: { Authorization: `Bearer ${token}` },
});

console.log(res.body.name);
```

Defaults the client supplies for you:

- `User-Agent: rawdash-connector/<version> (+https://rawdash.dev)`
- `Accept: application/json`
- 10s timeout (via `AbortSignal`)
- 3 attempts with exponential backoff + jitter
- Retry 5xx, 408, 429, and network errors
- Parse JSON when `Content-Type: application/json`
- Throw a typed error on non-2xx

## Typed errors

```ts
import {
  AuthError,
  RateLimitError,
  TransientError,
  request,
} from '@rawdash/connector-shared';

try {
  await request({ url: '…' });
} catch (err) {
  if (err instanceof AuthError) {
    // expired credential — stop syncing this connector
  } else if (err instanceof RateLimitError) {
    // back off until err.retryAfter
  } else if (err instanceof TransientError) {
    // already retried; surface as a soft failure
  }
}
```

| Class              | `.kind`        | When                                          |
| ------------------ | -------------- | --------------------------------------------- |
| `TransientError`   | `transient`    | Network failure / 408 after retries exhausted |
| `RateLimitError`   | `rate_limit`   | 429                                           |
| `AuthError`        | `auth`         | 401, 403                                      |
| `UpstreamBugError` | `upstream_bug` | 5xx after retries exhausted                   |
| `ClientBugError`   | `client_bug`   | 4xx that isn't 401/403/408/429                |

## Rate limiting

Each API uses different headers. Pass a policy and the client surfaces parsed state on the response:

```ts
import { githubRateLimit, request } from '@rawdash/connector-shared';

const res = await request({
  url: 'https://api.github.com/…',
  rateLimit: githubRateLimit,
});

if (res.rateLimitState && res.rateLimitState.remaining < 100) {
  // tell the sync consumer to slow down
}
```

Pre-built policies: `githubRateLimit`, `sentryRateLimit`, `linearRateLimit`. Roll your own with `{ parse(headers): RateLimitState | null }`.

## Pagination

```ts
import {
  paginateCursor,
  paginateLink,
  paginatePage,
} from '@rawdash/connector-shared';

for await (const issue of paginateLink<Issue>(
  { url: 'https://api.github.com/repos/owner/repo/issues?per_page=100' },
  (body) => body as Issue[],
)) {
  // …
}
```

- `paginateLink` — Web Linking / GitHub / Sentry style (`Link` response header).
- `paginateCursor` — opaque-cursor APIs (Linear, modern REST).
- `paginatePage` — `?page=N` legacy APIs.

Each iterator runs each page through `request()`, so retry + rate-limit + typed errors apply transparently.

## Retry tuning

```ts
await request({
  url: '…',
  retry: {
    maxAttempts: 5,
    initialDelayMs: 500,
    maxDelayMs: 30_000,
    retryOn: (status, err) => status === 503,
  },
});
```

`Retry-After` (seconds or HTTP-date) is honored on 429.

## Out of scope (deliberately)

- GraphQL helpers — separate package if/when.
- AWS SigV4 — use `@aws-sdk/*` directly.
- OAuth flows — separate package if/when.
- Anything tenant-specific (KEK, secrets, D1). This is a pure HTTP layer.

## Authoring a new connector

1. Depend on `@rawdash/connector-shared` via `workspace:*` — in `devDependencies`, not `dependencies`. It gets inlined at build time (see "Bundling" below), so it must not appear in the published `dependencies` map.
2. Add `noExternal: ['@rawdash/connector-shared']` to the connector's `tsup.config.ts`:

   ```ts
   import { defineConfig } from 'tsup';

   export default defineConfig({
     entry: ['src/index.ts'],
     format: ['esm'],
     noExternal: ['@rawdash/connector-shared'],
     dts: true,
   });
   ```

3. Define your API types.
4. Per fetch site, call `request()` (or the right paginator). Don't reach for raw `fetch`.
5. If your API has a rate-limit header convention not yet covered, add a `RateLimitPolicy` here and export it — every connector for that API should share it.
6. In error handling, branch on `err.kind` (or `instanceof`), never regex on `err.message`.

## Bundling

This package is `"private": true` and never publishes to npm. Connectors that publish to npm (e.g. `@rawdash/connector-github`) inline it at build time via tsup's `noExternal`.

Why bundle instead of publish:

- Rename or split freely. Future re-organizations (e.g. splitting into `@rawdash/connector-aws-shared`, `@rawdash/connector-graphql-shared`) never touch npm.
- No semver discipline on internal API. Connectors and shared utilities update in lockstep via single PRs.
- Cleaner published surface. `npm view @rawdash/*` only lists what users actually `npm i`.
- One tarball per `npm i @rawdash/connector-<name>` — no dangling workspace deps.

Cost: ~10 KB of shared code duplicated per connector tarball, and bug fixes here require republishing every connector that uses it (`pnpm publish -r --filter '@rawdash/connector-*'`).

After editing a connector's `tsup.config.ts`, verify with `pnpm pack` in the connector's directory and inspect `package.json` inside the tarball — it must have no `@rawdash/connector-shared` entry under `dependencies`.
