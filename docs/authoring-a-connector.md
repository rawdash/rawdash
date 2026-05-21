# Authoring a connector

This guide walks you from "I have a REST API" to a publishable `@rawdash/connector-<source>` package. It assumes you've read the top-level [README](../README.md) and skimmed [`@rawdash/core`](../packages/core/README.md).

If you're patching an existing connector, the relevant package READMEs are still the source of truth for the consumer surface. This guide covers the authoring side: what to build, why the contract looks the way it does, and the patterns we expect new connectors to follow.

## Contents

1. [What a connector is](#1-what-a-connector-is)
2. [Picking shapes](#2-picking-shapes)
3. [Settings and credentials](#3-settings-and-credentials)
4. [Implementing `sync()`](#4-implementing-sync)
5. [Chunked syncs](#5-chunked-syncs)
6. [Rate-limit awareness](#6-rate-limit-awareness)
7. [Using `@rawdash/connector-shared`](#7-using-rawdashconnector-shared)
8. [Testing locally](#8-testing-locally)
9. [Publishing](#9-publishing)

---

## 1. What a connector is

A connector is anything that implements the `Connector` interface from `@rawdash/core`:

```ts
interface Connector {
  readonly id: string;
  readonly credentials?: CredentialsSchema;
  serializeConfig(): Record<string, unknown>;
  sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult>;
}
```

- **`id`** is a short, stable, lowercase identifier (`github-actions`, `linear`, `stripe`). It namespaces the connector's data in storage and appears in widget `source` strings (`github-actions:workflow_runs`). Once you publish, treat the id as a permanent contract.
- **`credentials`** declares what auth material the host should collect. Each key has a `description` and an `auth: 'none' | 'optional' | 'required'` policy. `required` means the host won't run the connector without it.
- **`serializeConfig()`** returns a plain JSON snapshot of the connector's settings (and any `Secret` references). The host stores it so cloud workers can rehydrate the connector without source access.
- **`sync()`** is the only behavior the host calls. It takes `SyncOptions`, a `StorageHandle` to write into, and an `AbortSignal` it must respect.

In practice you'll extend `BaseConnector`, which handles `serializeConfig`, secret resolution, retry/backoff helpers, and abort-aware `sleep`. The only abstract method left is `sync()`.

```ts
import { BaseConnector } from '@rawdash/core';

export class MyConnector extends BaseConnector<
  MySettings,
  MyCredentialsSchema
> {
  static readonly id = 'my-source';
  readonly id = 'my-source';

  async sync(options, storage, signal) {
    // …
    return { done: true };
  }
}
```

The lower-level `defineConnector<TSettings>()` factory is available for connectors that don't fit the class shape (rare). Prefer `BaseConnector`.

## 2. Picking shapes

Connectors write into five storage shapes. Choose by the access pattern, not the source's data model:

| Shape          | When                                                                                          | Mental model                                                          |
| -------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `event`        | Append-only, timestamped facts you'll count, slice, or chart over time.                       | "Something happened at time T." Workflow runs, deploys, PR merges.    |
| `entity`       | "Things" with state that changes over time, queried by id or by attribute.                    | Upserted rows keyed by `(type, id)`. PRs, issues, users, repos.       |
| `metric`       | Numeric samples already aggregated upstream; you want them as a time series.                  | `(name, ts, value, attributes)`. Build counts, gauges, latencies.     |
| `edge`         | Many-to-many relationships you'll traverse from either side.                                  | `(from, kind, to)` with attributes. `pr -reviewed_by-> user`.         |
| `distribution` | Histograms or summaries you didn't materialize as raw events (often because upstream did it). | A snapshot of a distribution at a timestamp. p50/p95 buckets, counts. |

Rules of thumb:

- **Events are not the source's events.** They're _your_ append-only facts. A "PR was opened" is an event; the PR itself is an entity.
- **Entities upsert.** Writing an entity with the same `(type, id)` overwrites the previous version. Use `updated_at` to track freshness.
- **Don't reach for distributions unless the source gives you one.** Most sources expose raw timestamped data — write events and aggregate at query time.
- **Edges replace, scoped by kind.** Passing `{ kinds: ['reviewed_by'] }` to `storage.edges([])` clears edges of that kind for the connector. Use this to drop stale relations on re-sync.

## 3. Settings and credentials

Settings are the per-instance, non-secret configuration: `owner`, `repo`, base URL, polling window, etc. Credentials are auth material.

### Define the config schema

`defineConfigFields` validates user input from JSON (e.g. from a hosted config UI) into a typed object. Use Zod and attach `.meta({ label, description, ... })` so the host can render forms:

```ts
import { defineConfigFields } from '@rawdash/core';
import { z } from 'zod';

export const configFields = defineConfigFields(
  z.object({
    owner: z.string().min(1).meta({
      label: 'Repository owner',
      description: 'GitHub username or organization name.',
    }),
    repo: z.string().min(1).meta({
      label: 'Repository',
      description: 'Repository name.',
    }),
    token: z.object({ $secret: z.string() }).optional().meta({
      label: 'Personal access token',
      description: 'GitHub PAT with `repo` scope.',
      secret: true,
    }),
  }),
);
```

The `{ $secret: 'ENV_NAME' }` shape is how secrets travel through serialized config without ever inlining the resolved value.

### Declare credentials policy

```ts
const credentials = {
  token: {
    description: 'GitHub personal access token',
    auth: 'optional' as const, // 'none' | 'optional' | 'required'
  },
} satisfies CredentialsSchema;
```

- `none` — the connector never accepts this credential. Drop the field instead; this exists for migrations.
- `optional` — the connector works without it but may be rate-limited, scoped down, or read-only.
- `required` — the host won't invoke `sync()` without a resolved value.

### Construct from typed inputs and from JSON

Constructors take typed settings plus typed credential inputs (where each value is `string | Secret | undefined`). For hosts that hand you opaque JSON, expose a `static create(input: unknown)` helper that runs `configFields.parse(input)` and splits the result.

```ts
static create(input: unknown): MyConnector {
  const parsed = configFields.parse(input);
  return new MyConnector(
    { owner: parsed.owner, repo: parsed.repo },
    { token: parsed.token },
  );
}
```

The user-facing path stays ergonomic:

```ts
new MyConnector(
  { owner: 'my-org', repo: 'my-repo' },
  { token: secret('GITHUB_TOKEN') },
);
```

## 4. Implementing `sync()`

`sync()` is called by the host with:

```ts
interface SyncOptions {
  mode: 'full' | 'latest';
  since?: string; // ISO timestamp; lower bound for incremental syncs
  cursor?: unknown; // resume token returned from a previous SyncResult
}
```

It returns:

```ts
interface SyncResult {
  done: boolean;
  cursor?: unknown; // present iff !done
}
```

A minimal implementation:

```ts
async sync(options, storage, signal) {
  signal?.throwIfAborted();

  const data = await fetch('https://api.example.com/things', {
    headers: { Authorization: `Bearer ${this.creds.token}` },
    signal,
  }).then((r) => r.json());

  await storage.entities(
    data.map((d) => ({
      type: 'thing',
      id: d.id,
      attributes: { name: d.name },
      updated_at: new Date(d.updated_at).getTime(),
    })),
    { types: ['thing'] }, // replace scope: clears prior 'thing' entities for this connector
  );

  return { done: true };
}
```

### Modes

- `latest` — cheap "give me the most recent value" sync. Fetch one row, write one row. Used for snapshot widgets that don't need history.
- `full` — sync the full window. Honor `options.since` if your API supports `?since=` or equivalent; otherwise fall back to fetching everything and filtering.

### Idempotency

Every successful `sync()` must converge on the same storage state regardless of how many times it runs.

- Use the batch writers (`storage.entities([...], { types: ['thing'] })`, `storage.edges([...], { kinds: ['reviewed_by'] })`) so the replace-scope semantics drop stale rows.
- For append-only shapes (`events`, `metrics`, `distributions`), pass an empty batch with the scope at the start of a full sync to clear prior data: `storage.events([], { names: ['workflow_run'] })`. Then stream the new data in.
- Never write directly keyed on "now" — use the source's own timestamps so re-syncing the same row is a no-op.

### Error contracts

When you use `@rawdash/connector-shared`'s `request()`, typed errors propagate up naturally:

- `AuthError` (401, 403) — host stops syncing this connector until the credential is replaced.
- `RateLimitError` (429) — host backs off and reschedules.
- `TransientError` / `UpstreamBugError` — host treats as a soft failure and retries on the next tick.

Throw these explicitly if you detect the condition yourself (e.g. a JSON payload that says `"error": "rate_limited"` with a 200 status). Don't wrap them in generic `Error`.

## 5. Chunked syncs

> **Why this section exists.** Hosts run connectors inside per-invocation budgets — serverless platforms cap subrequest counts, wall-clock time, or both (Cloudflare Workers, AWS Lambda, GitHub Actions runners all have their own ceilings; see each platform's docs for current numbers). A connector that has to fetch the entire backfill in one go either wedges itself on any source with more than a handful of pages of history, or silently drops data when the host kills it. Connectors that can yield mid-sync and resume on the next tick avoid this entirely.

The mechanism is `SyncOptions.cursor` + `SyncResult.cursor`:

- The host invokes `sync()` with `cursor: undefined` on the first tick.
- If the connector returns `{ done: false, cursor: X }`, the host saves `X` and invokes again with `options.cursor = X`.
- If the connector returns `{ done: true }`, the host marks the sync complete.

The cursor is **opaque to the host** — the connector owns its shape, JSON-serializes it, and parses it back on resume. Treat anything you receive as `unknown` and validate before trusting it (see "Cursor hygiene" below).

### When to chunk

Yes:

- Paginated APIs that may return thousands of pages.
- Multi-phase syncs (e.g. fetch parents, then fetch children per parent).
- Anything that could plausibly exceed a serverless platform's per-invocation subrequest or time budget.

No:

- Webhook-driven sources where the connector doesn't pull at all.
- Single-endpoint sources whose entire response fits in one request.
- Sources without a resumable position. Return `{ done: true }` on every run and don't emit a cursor — do as much work as fits in the budget, then stop. (`MAX_CHUNK_ATTEMPTS`, mentioned below, only bounds repeated `{ done: false }` resumes; it doesn't apply here.)

### Pattern A: phased pagination

Most connectors fit this shape — a fixed list of "phases" (entity types to sync), each driven by next-page links or cursors. Define a cursor that captures `(phase, page)`:

```ts
type SyncPhase = 'repos' | 'pull_requests' | 'issues' | 'releases';

interface SyncCursor {
  phase: SyncPhase;
  pageUrl?: string;
}

const PHASE_ORDER: readonly SyncPhase[] = [
  'repos',
  'pull_requests',
  'issues',
  'releases',
];

async sync(options, storage, signal) {
  const incoming = this.sanitizeIncomingCursor(options.cursor);
  const startIdx = incoming ? PHASE_ORDER.indexOf(incoming.phase) : 0;

  for (let i = startIdx; i < PHASE_ORDER.length; i++) {
    const phase = PHASE_ORDER[i]!;
    const initialPageUrl = i === startIdx ? incoming?.pageUrl : undefined;
    const result = await this.runPhase(phase, storage, options, initialPageUrl, signal);
    if (!result.done) {
      return { done: false, cursor: { phase, pageUrl: result.pageUrl } satisfies SyncCursor };
    }
  }

  return { done: true };
}
```

Each phase paginates through `Link` / cursor / page-number URLs and, on every page, checks `signal.aborted`. If aborted, return the URL of the next page that wasn't fetched:

```ts
while (nextUrl) {
  if (signal?.aborted) {
    return { done: false, pageUrl: nextUrl };
  }
  const res = await this.get<MyResponse>(nextUrl, signal);
  // write rows…
  nextUrl = parseLinkHeader(res.headers.get('link'))['next'] ?? null;
}
return { done: true };
```

The canonical implementation lives in [`packages/connectors/github/src/github.ts`](../packages/connectors/github/src/github.ts) — read it before writing your own.

> **Helper coming:** a `paginateChunked` helper in `@rawdash/connector-shared` will absorb the phase-loop boilerplate (you supply the phases array, a `fetchPage` and `writeBatch` per phase, and it produces the cursor for you). Adopt it when it ships; the underlying contract — the `(phase, page)` cursor shape — won't change.

### Pattern B: hand-rolled cursor

If your sync doesn't fit phased pagination (graph traversal, deep cursors, multi-axis fan-out), define your own cursor shape and the same yield-on-abort discipline applies. Make the shape something you can JSON-serialize round-trip, and version it if you expect to change it (`{ v: 1, ... }`) so old cursors from before a deploy are easy to detect and discard.

### Cursor hygiene

The cursor you receive is `unknown` — it came back from storage, possibly across a deploy that changed your cursor shape. Validate before using:

```ts
function isMyCursor(value: unknown): value is MyCursor {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { phase?: unknown; pageUrl?: unknown };
  if (
    typeof v.phase !== 'string' ||
    !PHASE_ORDER.includes(v.phase as SyncPhase)
  )
    return false;
  if (v.pageUrl !== undefined && typeof v.pageUrl !== 'string') return false;
  return true;
}
```

If the cursor includes a URL the host will pass back to `fetch()`, **sanitize it**: confirm the host, protocol, and path prefix match your API. A malicious or corrupted cursor must not exfiltrate credentials to an attacker-controlled host. See `resolveCursor`/`sanitizePageUrl` in the GitHub connector for a working example.

### What the host guarantees

- The host persists the cursor between invocations and passes it back verbatim.
- The host bounds total chunk attempts (currently `MAX_CHUNK_ATTEMPTS`); a connector that always returns `{ done: false }` will eventually be force-completed.
- The host calls `sync()` with `signal` and may abort at any time — including mid-page. Respect it.

## 6. Rate-limit awareness

For most connectors, sending a `RateLimitPolicy` to `request()` is enough — the shared client classifies 429s as `RateLimitError`, the host catches it, and reschedules.

Where you can do better: when you know in advance that the budget is gone (the response headers say `X-RateLimit-Remaining: 0`), tell the host to defer the next invocation instead of waiting for the next 429. Connectors can populate `SyncResult.rateLimitUpdates` (when supported by your `@rawdash/core` version) with the parsed `RateLimitState` so the host can schedule accordingly.

For pre-built policies (`githubRateLimit`, `sentryRateLimit`, `linearRateLimit`) the parsing is handled for you — the policy goes on the request, the parsed state shows up on the response. Add a new policy to `@rawdash/connector-shared` if your API uses a header convention that isn't there yet, so every future connector for that API can share it.

## 7. Using `@rawdash/connector-shared`

This is the internal HTTP substrate. It is **not** published to npm; connectors that publish bundle it at build time via tsup's `noExternal`.

```ts
import {
  AuthError,
  type HttpRequest,
  type HttpResponse,
  RateLimitError,
  githubRateLimit,
  paginateLink,
  parseLinkHeader,
  request,
} from '@rawdash/connector-shared';
```

What it gives you:

- `request()` — `fetch` with sensible defaults: timeouts, retry with backoff and jitter, automatic JSON parsing, typed errors on non-2xx, default `User-Agent`.
- Typed errors: `AuthError`, `RateLimitError`, `TransientError`, `UpstreamBugError`, `ClientBugError`. Branch on `instanceof` or `.kind`, never regex on `.message`.
- Pagination iterators: `paginateLink` (Web Linking / GitHub / Sentry), `paginateCursor` (Linear, modern REST), `paginatePage` (`?page=N`). Each runs every page through `request()` so retry and error handling are uniform.
- Rate-limit parsers and `Retry-After` honor on 429.

See [`packages/connector-shared/README.md`](../packages/connector-shared/README.md) for the full surface, including the rules for bundling (you depend on it via `workspace:*` in `devDependencies`, and add `noExternal: ['@rawdash/connector-shared']` to your `tsup.config.ts`).

## 8. Testing locally

Before publishing, smoke-test the connector against a real source from one of the example apps:

- `apps/example-server` — minimal Node-based rawdash server. Edit [`rawdash.config.ts`](../apps/example-server/rawdash.config.ts) to import your connector, pass a real token via env, and run the sync.
- `apps/example-nextjs` — full Next.js app with widgets, useful for verifying that the shapes you wrote (events, entities, etc.) actually drive the widgets you expect.

Recommended loop:

1. `pnpm --filter @rawdash/connector-<name> build` (or rely on `@rawdash/source` exports for live TS).
2. Wire your connector into `apps/example-server/rawdash.config.ts`.
3. `pnpm --filter @rawdash/example-server dev` and watch the sync logs.
4. Inspect the storage backend (`file:rawdash.db` by default) to verify the rows are shaped how you expect.
5. Re-run the sync — it should be a no-op against unchanged data (idempotency check).
6. Kill the process mid-sync and restart — it should resume from the cursor (chunked-sync check).

Unit-level tests live next to the source (`*.test.ts`). Mock at the `fetch` boundary; don't mock the storage handle — use `InMemoryStorage` from `@rawdash/core` if you want to assert on writes.

## 9. Publishing

- **Naming.** `@rawdash/connector-<source>`. The package name and the connector's `id` are related but serve different roles: the package name groups connectors by vendor or brand (`@rawdash/connector-github` is the home for anything GitHub-related), while the `id` identifies the specific data domain inside that package (`github-actions` for the GitHub Actions API). They don't need to be identical, but they should be obviously aligned. Once published, both the package name and the `id` are permanent — they appear in user config files and widget `source` strings.
- **Lockstep versioning.** All published `@rawdash/*` packages share a single version. They're declared as a [`fixed` group](https://github.com/changesets/changesets/blob/main/docs/config-file-options.md#fixed-array-of-arrays-of-package-names) in [`.changeset/config.json`](../.changeset/config.json), so when any one of them releases, _all_ of them bump to the same version even if their source didn't change. **Add your new package's name to the `fixed` array** in the same PR that adds the package — otherwise it'll drift the moment another package releases. Use [changesets](https://github.com/changesets/changesets) for the release notes themselves: add one with every PR that touches a published package.
- **Initial changeset.** The PR that introduces a new connector must ship with a changeset that bumps it `minor` and describes the first release. Without one, the connector inherits the train's next version through the `fixed` group but its `CHANGELOG.md` carries no entry announcing it. Drop a file under `.changeset/` like:

  ```md
  ---
  '@rawdash/connector-<name>': minor
  ---

  Add `@rawdash/connector-<name>` — one or two sentences describing what the connector syncs, how it authenticates, and any notable knobs (resource filters, account scoping, modes).
  ```

- **Semver discipline.** Even under lockstep versioning, the version field still encodes intent. Treat the connector's exported surface (constructor signature, `id`, the shapes it writes) as semver — breaking changes in any of those should land in a major bump for the whole release train.
- **Dependency on `@rawdash/core`.** Declare it under `dependencies` (not peer) at `workspace:*`. The publish step rewrites it to the lockstep version at pack time. When `@rawdash/core` introduces a new optional field on `SyncOptions` or `SyncResult`, you don't need to bump anything; you only re-release when you actually use the new field.
- **Dependency on `@rawdash/connector-shared`.** `workspace:*` in `devDependencies`, **never** in `dependencies`. Add `noExternal: ['@rawdash/connector-shared']` to `tsup.config.ts`. Verify with `pnpm pack` and inspect the tarball's `package.json` — `@rawdash/connector-shared` must not appear under `dependencies`.
- **README.** Cover the consumer surface: install, quick example showing `defineMetric` against the connector's shapes, settings reference, credentials, and any source-specific gotchas (scopes, plans, rate limits). The authoring details belong in this guide; the README is for users.
- **Smoke-test against the example app** (section 8) before publishing.

### Wiring into CI

Nothing to add. Both workflows discover workspace packages automatically:

- [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs `pnpm turbo run lint/typecheck/build/test` with an "affected" filter across the whole workspace. As long as your `package.json` defines those script names, your package is exercised on every PR that touches it.
- [`.github/workflows/publish.yml`](../.github/workflows/publish.yml) runs [`scripts/npm-oidc-publish.ts`](../scripts/npm-oidc-publish.ts), which enumerates non-private workspace packages via `pnpm ls -r --json` and publishes anything not already on npm at the current version. No allowlist to maintain.

Required `package.json` scripts (copy from `packages/connectors/github/package.json`):

```json
{
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src"
  }
}
```

### First-time publishing and OIDC bootstrap

The publish workflow uses [npm OIDC trusted publishing](https://docs.npmjs.com/trusted-publishers) — no `NPM_TOKEN` is stored anywhere. The catch: **npm can't mint a publish token for a package that doesn't exist yet, and it can't accept a trusted publisher entry for a package that doesn't exist yet either.** So there's an unavoidable one-time-per-package bootstrap. The publish script detects when this hasn't been done and fails loudly with the steps below.

The four steps, run once per new package from a maintainer machine with publish rights to the `@rawdash` org and a real 2FA-enabled npm account.

1. **Pre-flight.** Both of the steps below silently fail in confusing ways if either of these isn't satisfied — `npm publish` returns HTTP 404 (not 401) on a brand-new scoped package when you lack publish rights, and `npm trust` simply doesn't exist on older CLIs. Check first:

   ```sh
   npm --version   # must be ≥ 11.10.0 — older CLIs don't ship `npm trust`
   npm whoami      # must be logged in as a maintainer with @rawdash publish rights
   ```

   **If `npm --version` is older than 11.10.0:**

   ```sh
   npm install -g npm@latest
   ```

   That works on most setups. If your Node was installed through a version manager (nvm, fnm, asdf, volta), the `npm` shipped with Node ≤ 22 is older than 11.10.0 — upgrade Node or reinstall npm under that toolchain so the upgraded npm lands on the active Node. On a macOS Homebrew install, refresh with `brew install node` if `-g` is blocked by permissions. Re-run `npm --version` to confirm.

   **If `npm whoami` fails or prints the wrong account:** `npm login`.

2. **Publish v0.0.x manually.** This is the unavoidable step — npm requires the package to exist before any further config is possible. `cd` into the checkout where the new package source lives; if you're using a git worktree you'll need to be inside that worktree, since the package doesn't exist on `main` yet.

   ```sh
   cd packages/connectors/<name>
   pnpm build
   npm publish --access public
   ```

3. **Configure the Trusted Publisher entry.** `--file` takes the workflow's basename inside `.github/workflows/`, not a path — passing `.github/workflows/publish.yml` is rejected with "GitHub Actions workflow must be just a file not a path".

   ```sh
   npm trust github @rawdash/connector-<name> \
     --repository rawdash/rawdash \
     --file publish.yml
   ```

4. **Re-run the release workflow.** From here on, every release publishes the new package via OIDC with provenance, in lockstep with the rest of the train.

> **Why this is still manual.** PyPI supports _pending_ publishers — a trust entry created before the first publish, so CI can bootstrap a new package on its own. npm doesn't; both the placeholder publish and the Trusted Publisher entry must exist before OIDC can take over, and there's no first-class API for managing trusted publishers programmatically. `npm trust` is a CLI wrapper over the same npm-side data store, not a way to skip the placeholder publish. Until npm ships pending publishers, treat this as a one-off chore per new package.

## See also

- [`packages/core/README.md`](../packages/core/README.md) — the consumer-facing core API.
- [`packages/connector-shared/README.md`](../packages/connector-shared/README.md) — full HTTP substrate reference.
- [`packages/connectors/github/`](../packages/connectors/github/) — the canonical connector. Read its `github.ts` source.
