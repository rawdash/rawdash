# @rawdash/http-client

Internal HTTP client shared by Rawdash connectors. Centralizes the concerns every connector ends up reinventing: User-Agent, timeouts, retry/backoff, rate-limit parsing, pagination, and typed errors.

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
import { request } from '@rawdash/http-client';

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
} from '@rawdash/http-client';

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
import { githubRateLimit, request } from '@rawdash/http-client';

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
} from '@rawdash/http-client';

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

1. Depend on `@rawdash/http-client` via `workspace:*`.
2. Define your API types.
3. Per fetch site, call `request()` (or the right paginator). Don't reach for raw `fetch`.
4. If your API has a rate-limit header convention not yet covered, add a `RateLimitPolicy` here and export it — every connector for that API should share it.
5. In error handling, branch on `err.kind` (or `instanceof`), never regex on `err.message`.
