# Authoring a connector

This guide walks you from "I have a REST API" to a publishable `@rawdash/connector-<source>` package. It assumes you've read the top-level [README](../README.md) and skimmed [`@rawdash/core`](../packages/core/README.md).

If you're patching an existing connector, the relevant package READMEs are still the source of truth for the consumer surface. This guide covers the authoring side: what to build, why the contract looks the way it does, and the patterns we expect new connectors to follow.

## Contents

1. [What a connector is](#1-what-a-connector-is)
2. [Picking shapes](#2-picking-shapes)
3. [Settings and credentials](#3-settings-and-credentials)
4. [Implementing `sync()`](#4-implementing-sync)
5. [Chunked syncs](#5-chunked-syncs)
6. [Logging](#6-logging)
7. [Storage durability](#7-storage-durability)
8. [Rate-limit awareness](#8-rate-limit-awareness)
9. [Using `@rawdash/connector-shared`](#9-using-rawdashconnector-shared)
10. [Testing locally](#10-testing-locally)
11. [Publishing](#11-publishing)

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

Connector _classes_ additionally satisfy the `ConnectorClass` contract — they declare a static `id`, a static `schemas` map (see [Schemas](#schemas)), and an optional static `credentials`.

- **`id`** is a short, stable, lowercase identifier (`github-actions`, `linear`, `stripe`). It namespaces the connector's data in storage and appears in widget `source` strings (`github-actions:workflow_runs`). Once you publish, treat the id as a permanent contract.
- **`credentials`** declares what auth material the host should collect. Each key has a `description` and an `auth: 'none' | 'optional' | 'required'` policy. `required` means the host won't run the connector without it.
- **`serializeConfig()`** returns a plain JSON snapshot of the connector's settings (and any `Secret` references). The host stores it so cloud workers can rehydrate the connector without source access.
- **`sync()`** is the only behavior the host calls. It takes `SyncOptions`, a `StorageHandle` to write into, and an `AbortSignal` it must respect.

In practice you'll extend `BaseConnector`, which handles `serializeConfig`, secret resolution, retry/backoff helpers, and abort-aware `sleep`. The only abstract method left is `sync()`.

```ts
import { BaseConnector } from '@rawdash/core';
import { z } from 'zod';

export class MyConnector extends BaseConnector<
  MySettings,
  MyCredentialsSchema
> {
  static readonly id = 'my-source';
  static readonly schemas = {
    widgets: z.array(z.object({ id: z.string(), name: z.string() })),
  } as const;
  readonly id = 'my-source';

  async sync(options, storage, signal) {
    // …
    return { done: true };
  }
}
```

- **`schemas`** is a static, frozen map of resource name → Zod schema describing the raw API response shape for that resource. It is part of the `ConnectorClass` contract: a connector without `static schemas` is a TypeScript error at the registry site. See [Schemas](#schemas).

The lower-level `defineConnector<TSettings>()` factory is available for connectors that don't fit the class shape (rare). Prefer `BaseConnector`.

### Package entry point

Every `@rawdash/connector-*` package **must** export its connector class as the package's default export, plus its metadata as standalone named exports — `id`, `doc`, `configFields`, `resources`, and (if the connector declares one) `cost`:

```ts
// packages/connectors/<name>/src/my-connector.ts
export const id = 'my-connector';
export const myResources = defineResources({ ... });
// ...
export class MyConnector extends BaseConnector<...> {
  static readonly id = id; // derive the static from the standalone const
  static readonly resources = myResources;
  // ...
}
```

```ts
// packages/connectors/<name>/src/index.ts
import { MyConnector } from './my-connector';

export {
  configFields,
  doc,
  id,
  MyConnector,
  myResources as resources,
} from './my-connector';
export type { MySettings } from './my-connector';
export default MyConnector;
```

Also set `"sideEffects": false` in the package's `package.json`.

The **default export** is a hard requirement: rawdash cloud's sync-consumer Worker can't use runtime `import()` (Cloudflare bundles the module graph statically), so it relies on a build-time codegen step that scans `@rawdash/connector-*` dependencies and emits static `import` statements. A symbol-name-agnostic default export is what makes that codegen generic.

The **standalone metadata exports** (and `sideEffects: false`) exist so the `@rawdash/connectors` aggregate package can build a `/metadata` entry that imports connector metadata _by name only_, never the connector class. Because the class's `id`/`resources`/`cost` statics are read at module-eval time, importing the class to reach them would defeat tree-shaking and pull the connector's whole sync implementation into any metadata-only consumer (e.g. the cloud connector catalog). Exposing the values as standalone consts lets the class tree-shake out.

CI enforces the default export via `scripts/check-connector-publishing-prereqs.ts` (the **Check connector publishing prerequisites** step), and the metadata exports via `scripts/generate-connectors-package.ts` — its `--check` mode (the **Verify connectors aggregate package is up-to-date** step) fails if a connector is missing a named `id`/`doc`/`configFields`/`resources` export.

### Schemas

Every connector class **must** declare a `static schemas: Readonly<Record<string, z.ZodType>>` map of resource name → Zod schema describing the raw API response shape for that resource. This is part of the `ConnectorClass` contract in `@rawdash/core`; a connector class without it is a TypeScript error at the registry site (and won't compile against `ConnectorRegistry`).

```ts
static readonly schemas = {
  workflow_runs: z.object({ workflow_runs: z.array(/* ... */) }),
  pull_requests: z.array(/* ... */),
  // ...
} as const;
```

Two consumers rely on this map:

- **Cloud baseline generator**: at deploy time, rawdash cloud walks `ConnectorClass.schemas` for each `@rawdash/connector-*` dependency and writes one `connector_baselines` row per resource. Those baselines feed the shape-drift detection pipeline that flags upstream API changes at sync time.
- **Property tests** in `@rawdash/connector-test-utils`: `runPropertySyncTest({ connectorClass, resource, ... })` reads the schema from `connectorClass.schemas[resource]` and fuzzes against it. If you drop or misname a key, your own property tests break — that's a deliberate second layer of enforcement on top of the TypeScript contract.

**Resource keys must match the `resource` tag** passed to `request()` (see [§9](#9-using-rawdashconnector-shared)). The keys are the join column between schemas and runtime observations; a mismatch silently disables drift detection for that resource.

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

#### Composite (object) secrets

For credentials that are logically one unit but contain multiple fields (e.g. a role-assumption bundle with `type` / `roleArn` / `externalId`, or a service-account JSON blob), declare the field with `withSecretRef` so it accepts either the fully-resolved object or a `secret()` reference to it:

```ts
import { withSecretRef } from '@rawdash/core';
import { z } from 'zod';

const credentialsSchema = withSecretRef(
  z.object({
    type: z.literal('role'),
    roleArn: z.string(),
    externalId: z.string(),
  }),
);
```

At resolve time, `EnvSecretsResolver` inspects the plaintext: if it starts with `{` or `[`, it attempts `JSON.parse` and substitutes the parsed object/array on success; otherwise it substitutes the raw string. So a single env var holding a JSON-encoded credential bundle resolves to one structured object, and existing string secrets (`ghp_…`, `sk_…`, etc.) keep behaving exactly as before. Bundle structured values into one secret rather than fanning out into N string secrets — rotation stays atomic.

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
  resources?: ReadonlySet<string>; // allowlist of resource names the runner wants
}
```

It returns:

```ts
interface SyncResult {
  done: boolean;
  cursor?: unknown; // present iff !done
  transientError?: unknown; // soft failure — runner reschedules
}
```

The `{ done, cursor }` shape is the chunked-sync contract documented in [§5](#5-chunked-syncs). Single-call connectors return `{ done: true }` immediately and never emit a cursor.

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

### `options.since`

The runner sets `since` from the widest backfill window any widget on this connector actually needs (plus a small buffer). It is the lower bound on `updated_at` / `created_at` / whatever timestamp your source exposes. Two requirements:

1. **Filter on it.** Pass it through to the upstream API (`?since=`, `?updated_at[gte]=`, `?created[gte]=`, GraphQL `updatedAt: { gt: $since }`, etc.). Don't fetch the full backfill and then drop rows client-side — that defeats the point.
2. **Short-circuit pagination.** Even when the upstream endpoint accepts `since`, results are usually ordered newest-first; once a page is entirely older than `since`, stop paginating. Otherwise an "incremental" sync silently turns into a full scan when the upstream filter is missing or weaker than promised.

If the source has no timestamp filter at all, document it in the README and treat every sync as a full one — the runner still won't ask for more data than it needs (see [Storage durability](#7-storage-durability)).

### Resource allowlist (`options.resources`)

`options.resources` is the set of resources the runner actually wants this tick. It's derived from the widgets on dashboards in the current config, intersected with the dashboard's "scope" (which widgets the host evaluated). Two requirements:

1. **Skip phases nobody asked for.** If `options.resources` is set and a phase's resource isn't in it, don't fetch it. `selectActivePhases` in `@rawdash/core` does the intersection for `paginateChunked` callers.
2. **Don't sync subresources of skipped phases either.** If a phase fans out to N+1 calls per row (per-PR reviews, per-issue events), gate those calls on the same allowlist — they're expensive even when the parent phase has to run.

When `options.resources` is `undefined` or empty, sync everything (initial registration, debug runs).

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
- As a safety net, the `StorageHandle` itself is wired to the same `signal`: once the host aborts the run, any subsequent write call on the handle becomes a no-op (with a `console.warn`) instead of leaking into the next sync. This means a misbehaving connector that ignores `signal` can no longer overlap with the next run — but you should still honor `signal` so that wasted work stops promptly and your error messages remain accurate. Reads on the handle are unaffected.

## 6. Logging

Connectors emit structured `info` and `warn` events through the `ConnectorLogger` injected at construction time (`ctx.logger`, defaulted to `createDefaultConnectorLogger({ scope: this.id })`). Hosts route these through their own logger; OSS dev prints them to stdout/stderr.

The shape:

```ts
this.logger.info('event_name', { key: value, ... });
this.logger.warn('event_name', { key: value, ... });
```

### What you must emit

Per-page during paginated syncs:

```ts
this.logger.info('fetched page', {
  resource, // resource key matching `static schemas`
  page, // 1-indexed page number within the current phase
  items, // number of items in this page's batch
  cursor, // opaque inbound cursor (truncated by core if long)
  next, // opaque outbound cursor (truncated)
});
```

Per-resource summary after the phase finishes:

```ts
this.logger.info('resource done', {
  resource,
  pages, // total pages fetched this phase
  items, // total items written this phase
  duration_ms,
});
```

On a page-fetch or batch-write failure (before returning a `transientError` from `sync()`):

```ts
this.logger.warn('fetch page failed', {
  // or 'write batch failed'
  resource,
  page,
  cursor,
  error: err.message,
});
```

### Free for `paginateChunked` callers

The shape above is what `paginateChunked` (from `@rawdash/core`) emits if you pass it a `logger`. Connectors that use `paginateChunked` get the per-page log, the per-resource summary, and the WARN-on-error semantics for free — pass `this.logger` through and you're done. Connectors that hand-roll their pagination loop must emit the same shape themselves so dashboards and log queries are uniform.

### What NOT to do

- Don't `console.log` from a connector. The host's logger may be a structured pipeline; raw `console.log` bypasses it and ends up unstructured in production logs.
- Don't log credentials or full pagination URLs that may carry tokens. Cursors are already truncated to 80 chars by the helper, but if you log a URL directly, sanitize first.
- Don't log per-row. Per-page is the right granularity; per-row floods logs on large backfills.

## 7. Storage durability

`StorageHandle` is whatever the host wires up. In OSS dev, the default is now SQLite (`file:rawdash.db`), so **writes persist across restarts**. Earlier versions of the OSS dev runner used `InMemoryStorage` and started fresh on every boot; do not write a connector that depends on that behavior.

Concrete implications:

- **No implicit "first run" semantics.** Don't key cursor-init logic off "storage is empty" — it won't be on a restart of a long-running dev server. Either persist cursor state explicitly via the storage handle, or recompute it from the data already in storage.
- **Replace scopes are still your friend.** Idempotency (per [§4](#4-implementing-sync)) is what makes a re-sync against a populated store converge. Pass `{ types: [...] }` / `{ kinds: [...] }` / `{ names: [...] }` to the batch writers so stale rows for resources you re-sync get dropped.
- **Don't double-write on partial chunk completion.** A chunked sync that yields mid-resource and resumes from the same page **must not** re-write rows it already wrote. The simplest way to get this right is to make every write idempotent (entities upsert by `(type, id)`; events keyed on the source's own id). If you must clear a scope before writing, do it at the **start of the first chunk for that phase**, not at the start of every chunk — `paginateChunked`'s `writeBatch` is called once per page, not once per phase.
- **`since` cursors must be designed for a populated store.** Once SQLite is the default, your `since` is on every tick — there is no "initial backfill" gap where you can rely on the local DB being empty. Use the latest written `updated_at` (or whatever timestamp your source uses) as the floor on subsequent ticks, not "now − N days".

## 8. Rate-limit awareness

For most connectors, sending a `RateLimitPolicy` to `request()` is enough — the shared client classifies 429s as `RateLimitError`, the host catches it, and reschedules.

Build the policy from `standardRateLimitPolicy` in `@rawdash/connector-shared`, which parses the common `X-RateLimit-*` / `Retry-After` header conventions and honors back-off on 429. Each connector declares its own local policy (e.g. `const githubRateLimit = standardRateLimitPolicy({ ... })`) rather than importing a vendor-named shared export. If your API uses a header convention `standardRateLimitPolicy` doesn't cover, extend it (or add a shared helper) so future connectors for that API can reuse the parsing.

## 9. Using `@rawdash/connector-shared`

This is the internal HTTP substrate. It is **not** published to npm; connectors that publish bundle it at build time via tsup's `noExternal`.

```ts
import {
  AuthError,
  type HttpRequest,
  type HttpResponse,
  RateLimitError,
  paginateLink,
  parseLinkHeader,
  request,
  standardRateLimitPolicy,
} from '@rawdash/connector-shared';
```

What it gives you:

- `request()` — `fetch` with sensible defaults: timeouts, retry with backoff and jitter, automatic JSON parsing, typed errors on non-2xx, default `User-Agent`.
- Typed errors: `AuthError`, `RateLimitError`, `TransientError`, `UpstreamBugError`, `ClientBugError`. Branch on `instanceof` or `.kind`, never regex on `.message`.
- Pagination iterators: `paginateLink` (Web Linking / GitHub / Sentry), `paginateCursor` (Linear, modern REST), `paginatePage` (`?page=N`). Each runs every page through `request()` so retry and error handling are uniform.
- `standardRateLimitPolicy` — a configurable `RateLimitPolicy` that parses the common `X-RateLimit-*` / `Retry-After` header conventions and honors back-off on 429.

See [`packages/connector-shared/README.md`](../packages/connector-shared/README.md) for the full surface, including the rules for bundling (you depend on it via `workspace:*` in `devDependencies`, and add `noExternal: ['@rawdash/connector-shared']` to your `tsup.config.ts`).

## 10. Testing locally

Before publishing, smoke-test the connector against a real source from one of the example apps:

- `apps/example-server` — minimal Node-based rawdash server. Edit [`rawdash.config.ts`](../apps/example-server/rawdash.config.ts) to import your connector, pass a real token via env, and run the sync.
- `apps/example-nextjs` — full Next.js app with widgets, useful for verifying that the shapes you wrote (events, entities, etc.) actually drive the widgets you expect.

Recommended loop:

1. `pnpm --filter @rawdash/connector-<name> build` (or rely on `@rawdash/source` exports for live TS).
2. Wire your connector into `apps/example-server/rawdash.config.ts`.
3. `pnpm --filter example-server dev` and watch the sync logs.
4. Inspect the storage backend (`file:rawdash.db` by default) to verify the rows are shaped how you expect.
5. Re-run the sync — it should be a no-op against unchanged data (idempotency check).
6. Kill the process mid-sync and restart — it should resume from the cursor (chunked-sync check).

Unit-level tests live next to the source (`*.test.ts`). Mock at the `fetch` boundary; don't mock the storage handle — use `InMemoryStorage` from `@rawdash/core` if you want to assert on writes.

## 11. Publishing

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
- **Smoke-test against the example app** (section 10) before publishing.

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

1. **Pre-flight.** Both of the steps below silently fail in confusing ways if either of these isn't satisfied — `npm publish` returns HTTP 404 (not 401) on a brand-new scoped package when you lack publish rights, and `npm trust` on npm < 12 sends a request body the registry now rejects with an opaque `400 Bad Request` (it lacks the required `permissions` field added in npm 12). Check first:

   ```sh
   npm --version   # must be ≥ 12 — older CLIs send a payload the registry rejects with a 400
   npm whoami      # must be logged in as a maintainer with @rawdash publish rights
   ```

   **If `npm --version` is older than 12:** at the time of writing, npm 12 has not yet been published to the registry, so `npm install -g npm@latest` will leave you on 11.x. Build from source:

   ```sh
   cd /tmp && git clone --depth=1 https://github.com/npm/cli.git npm-cli && cd npm-cli
   node . install -g .
   npm --version   # confirm 12.x
   ```

   Once npm 12 ships to the registry, `npm install -g npm@latest` will be sufficient. If your Node was installed through a version manager (nvm, fnm, asdf, volta), make sure the upgraded `npm` lands on the active Node. On a macOS Homebrew install, refresh with `brew install node` if `-g` is blocked by permissions.

   **If `npm whoami` fails or prints the wrong account:** `npm login`.

2. **Publish v0.0.x manually.** This is the unavoidable step — npm requires the package to exist before any further config is possible. `cd` into the checkout where the new package source lives; if you're using a git worktree you'll need to be inside that worktree, since the package doesn't exist on `main` yet.

   ```sh
   cd packages/connectors/<name>
   pnpm build
   npm publish --access public
   ```

3. **Configure the Trusted Publisher entry.** `--file` takes the workflow's basename inside `.github/workflows/`, not a path — passing `.github/workflows/publish.yml` is rejected with "GitHub Actions workflow must be just a file not a path". `--allow-publish` is required: the registry rejects trust entries without an explicit permission, and omitting it surfaces a cryptic `400 Bad Request` rather than a usable error.

   ```sh
   npm trust github @rawdash/connector-<name> \
     --repository rawdash/rawdash \
     --file publish.yml \
     --allow-publish
   ```

4. **Re-run the release workflow.** From here on, every release publishes the new package via OIDC with provenance, in lockstep with the rest of the train.

> **Why this is still manual.** PyPI supports _pending_ publishers — a trust entry created before the first publish, so CI can bootstrap a new package on its own. npm doesn't; both the placeholder publish and the Trusted Publisher entry must exist before OIDC can take over, and there's no first-class API for managing trusted publishers programmatically. `npm trust` is a CLI wrapper over the same npm-side data store, not a way to skip the placeholder publish. Until npm ships pending publishers, treat this as a one-off chore per new package.

## See also

- [`packages/core/README.md`](../packages/core/README.md) — the consumer-facing core API.
- [`packages/connector-shared/README.md`](../packages/connector-shared/README.md) — full HTTP substrate reference.
- [`packages/connectors/github/`](../packages/connectors/github/) — the canonical connector. Read its `github.ts` source.
