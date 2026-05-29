---
name: new-connector
description: Scaffold a new rawdash connector package under packages/connectors/<id>. Use whenever the user asks to "add a new connector", "create a connector for <vendor>", "scaffold a <vendor> integration", or similar. The skill is a thin procedure — it tells you to copy the closest existing connector as a starting point and what decisions you have to make. It does NOT embed a template, because the real connectors are the template.
---

# new-connector

Process skill for scaffolding a new connector. The existing connectors under `packages/connectors/` are the source of truth; this skill never duplicates their structure.

The long-form connector contract lives in [`docs/authoring-a-connector.md`](../../../docs/authoring-a-connector.md). Read it before reviewing the scaffold — every requirement below is documented there in more depth.

## When to invoke

Trigger on requests like:

- "add a new connector for X"
- "scaffold a connector for X"
- "create the X integration"
- "/new-connector <id>"

## Procedure

1. **Resolve the connector id** (kebab-case, e.g. `pagerduty`). If the user supplied it, use it. Otherwise ask once.
2. **Read `packages/connectors/`.** List the existing connectors. They are the template.
3. **Pick the closest existing connector to copy from.** Choose by matching:
   - **Pagination shape** of the vendor's API (cursor, page, RFC 5988 Link header, GraphQL `pageInfo`, single-shot).
   - **Auth shape** of the vendor's API (bearer token, custom header, basic, service account, etc.).
   - **Output shape** the dev expects (entities only, entities + events, metrics).

   Read 1–2 candidate connectors end-to-end (`src/<id>.ts`, `src/property.test.ts`, `package.json`, `README.md`) before choosing. Do **not** guess based on directory name.
4. **Copy the chosen connector's files** into `packages/connectors/<id>/`. Then rename:
   - Package name in `package.json` (and `version` to `0.0.1`).
   - Class name, exported types, `static id`, `readonly id`.
   - File names where applicable (`src/<id>.ts`, `src/property.test.ts`).
   - The `doc` export (`defineConnectorDoc({...})`) — copy it and re-export it from `src/index.ts` like the source connector does.

   Do **not** hand-edit `README.md`. It is generated from the connector's metadata (see step 12); the copied README will be overwritten.
5. **Strip what's vendor-specific from the copy** so the dev fills it in:
   - API response TypeScript types.
   - The `resources` definitions: each connector declares `const <id>Resources = defineResources({...})` at module scope, one entry per **stored resource** (the entity `type` / event `name` / metric `name` widgets query), keyed by that stored name. Each entry carries `shape`, `description`, optional `endpoint`/`notes`, shape-specific doc fields (entity/event `fields`; metric `unit`/`granularity`/`dimensions`), and a `responses` map holding the raw API-response Zod schema(s) that resource is built from (keyed by the `resource` tag passed to `request()`). The class then exposes `static readonly resources = <id>Resources` and `static readonly schemas = schemasFromResources(<id>Resources)`. There is no separate central `schemas` map.
   - URL builders (`buildInitial*Url`, `allowedPagePath`).
   - Per-phase `fetchPage` and `writeBatch` bodies.
   - Entity/event/metric writers.
   - `PHASE_ORDER` and resource enum.
   - The `doc` contents (connector-level only): `displayName`, `category`, `brandColor`, `tagline`, `vendor`, `auth`, optional `rateLimit`, `limitations`. Per-resource docs live in `resources` (above), not here; the example lives in a file (step 6a).

   Leave `TODO(connector)` comments at each removed site so `grep TODO(connector)` finds every spot the dev needs to revisit.
6. **Add the connector's brand icon** at `packages/connectors/<id>/icon.svg`. This is a required, committed asset (the docs generator fails if it's missing). Source it from [Simple Icons](https://simpleicons.org/) (CC0) when the vendor is listed there, or the vendor's official icon set otherwise; co-locate it like the existing connectors (e.g. `packages/connectors/github/icon.svg`). Use the brand's hex as `doc.brandColor`. Logos are trademarks of their owners; use the unmodified mark for identification only.
7. **Add a type-checked example** at `packages/connectors/<id>/src/example.config.ts`: a real `defineConfig(...)` importing only `@rawdash/core` and using the connector's real `connectorId` and config fields (see `packages/connectors/github/src/example.config.ts`). It lives under `src/` so the package's typecheck covers it and it can't go stale; the generator inlines it into the docs. Do not import the connector class into it (avoid unused imports).
8. **Report cost only when it's real.** If syncing this connector at a high cadence is genuinely expensive (per-query billing, tight quotas), add `static readonly cost: ConnectorCost = {...}` to the class (`recommendedInterval`, `minInterval`, `perSync`, `warning`). The generator renders it as a callout and the cloud surfaces it next to the frequency field. Omit it for connectors where frequent syncing is cheap.
9. **Keep the shared substrate calls intact** — these are the parts the dev should NOT re-derive:
   - `BaseConnector` extension, `protected fetch` / `get` / `post`.
   - `paginateChunked` orchestration.
   - `makeChunkedCursorGuard`, `selectActivePhases`, `sanitizeAllowedUrl`.
   - `standardRateLimitPolicy` (if the vendor exposes standard rate-limit headers).
   - `connectorUserAgent('<id>')`.
   - `parseEpoch` for any timestamp normalization.
   - The property-test scaffolding from `@rawdash/connector-test-utils`.
10. **Auth setup** - do **not** invent or recommend an auth shape. Read the vendor's official docs and follow what they recommend for server-to-server access. Capture it in the connector's `doc.auth` (`summary` plus numbered `setup` steps with the exact secrets to store) — this is what renders the README/docs `Authentication` section. Do not hand-write it into the README. If the vendor supports multiple auth methods, describe the recommended one and note alternatives in the setup steps.
11. **Run `pnpm install`** so workspace links pick up the new package.
12. **Generate the docs** - run `pnpm docs:connectors`. This renders the new connector's `README.md`, its Cloud docs page under `apps/website/src/content/docs/docs/connectors/<id>.mdx`, and refreshes the catalog. CI runs `pnpm docs:connectors:check` and fails if these are out of date, so regenerate and commit whenever the connector's metadata changes.

## Bias against asking questions

If the user provided the connector id, vendor name, or any other detail in their message, use it. Only ask for what's both **missing** and **required to scaffold** (in practice, just the connector id is required).

When asking, ask via `AskUserQuestion` and bundle multiple questions in one call.

## Contract reminders for the dev

The scaffolded `sync()` will compile against an old version of the contract, but it won't be _correct_ until the dev satisfies all of the following. Surface this list (verbatim) when you hand off:

- **Honor `options.since`.** Pass it through to the upstream API as a filter, and short-circuit pagination once a page is entirely older than `since`. Don't fetch the full backfill and drop rows client-side. See [`docs/authoring-a-connector.md` §4](../../../docs/authoring-a-connector.md#optionssince).
- **Honor `options.resources`.** Skip phases whose resource isn't in the allowlist. Also skip N+1 subresource calls (per-row reviews, per-issue events) gated on the same allowlist. Use `selectActivePhases` from `@rawdash/core`.
- **Implement `count()` / `latest()` aggregates** for any resource whose dashboard widgets are `stat` / `status` / `fn: 'count'` widgets, if the upstream API exposes a cheap server-side count or "latest" endpoint. Without this, the runner has to backfill the full resource just to compute one number. Reference: `aggregate()` / `validateCountFilter()` in `packages/connectors/github/src/github.ts`.
- **Emit the structured INFO log shape** on every page (`fetched page`), once per resource (`resource done`), and `warn` on page-fetch / batch-write failures. `paginateChunked` does this for you if you pass `logger: this.logger`. Hand-rolled loops must emit the same shape.
- **Storage is persistent** (SQLite in OSS dev, real DBs in cloud). Don't depend on storage being empty on the first run. Make every write idempotent so a chunked sync that resumes mid-resource doesn't double-write.

## Decisions the dev (or you, with their permission) must make

These shape which existing connector you should copy from. Surface them explicitly in your scaffolding plan if you make a non-obvious call:

- **Auth shape** — read the vendor's docs.
- **Pagination shape** — read the vendor's API reference.
- **Rate-limit headers** — if the vendor publishes `*-remaining` / `*-reset` headers, plan to wire `standardRateLimitPolicy`. Otherwise omit.
- **Resources** — what the connector will sync. Start with one or two, the dev can extend.
- **Output shape per resource** — entity, event, or metric. The dev usually knows; ask only if ambiguous.

## What NOT to do

- **Do not embed a connector code template in this skill.** The real connectors under `packages/connectors/` are the template. If you find yourself writing TypeScript inside SKILL.md, stop.
- **Do not register the new connector** in any registry, index, or example app. The dev wires it in after the integration is real.
- **Do not add a changeset** for the scaffold commit alone. Connectors are added under their own changeset when the first real implementation lands.
- **Do not recommend an auth method without checking the vendor's docs.** What's "standard" varies wildly across vendors.

## Post-scaffold checklist (print this for the dev)

- Fill in API types and Zod schemas in `src/<id>.ts`.
- Implement `fetchPage` and the writers per phase.
- Plumb `options.since` into the upstream filter and short-circuit pagination once a page is entirely older than it.
- Gate every phase (and any N+1 subresource calls) on `options.resources`.
- Add an `aggregate()` override (and `validateCountFilter()`) for any resource that has a cheap server-side count / latest endpoint upstream — see [GitHub connector](../../../packages/connectors/github/src/github.ts) for the reference pattern.
- Pass `logger: this.logger` to `paginateChunked` so the per-page / per-resource INFO logs land in the right shape; hand-rolled loops must mirror the shape from `docs/authoring-a-connector.md` §7.
- Add a property-test `it` per resource in `src/property.test.ts`.
- Wire the resource/storage shape check into the property tests: import `connectorResourceShapeViolations` from `@rawdash/connector-test-utils` and add it to each `runPropertySyncTest` call's `extraInvariants` as `(storage, connectorId) => connectorResourceShapeViolations(<Class>.resources, storage, connectorId)` (see `packages/connectors/github/src/property.test.ts`). For resources no property test writes, add one full-sync test that calls `assertConnectorResourceShapes(<Class>.resources, storage, connectorId)`. This fails if any stored resource is missing from `resources` or its declared `shape` doesn't match what was written.
- Fill in the per-resource `resources` definitions (shape + description + endpoint + fields/dimensions/notes + `responses` schemas) and the connector-level `doc` (`displayName`, `category`, `brandColor`, `tagline`, `vendor`, `auth`, optional `rateLimit`, `limitations`). The README and Cloud docs are generated from these; never hand-write them.
- Use only regular hyphens (`-`) in all doc/resource/config-field strings; em-dashes (`—`) and en-dashes (`–`) fail the docs check.
- Add `packages/connectors/<id>/icon.svg` (required, committed; the generator fails without it). Use Simple Icons (CC0) or the vendor's official mark, and set `doc.brandColor` to the brand hex.
- Add `packages/connectors/<id>/src/example.config.ts` (a type-checked `defineConfig`; the generator inlines it).
- Run `pnpm docs:connectors` and commit the generated `README.md` + `apps/website/src/content/docs/docs/connectors/<id>.mdx` + `apps/website/public/connectors/<id>.svg` + the updated landing data. `pnpm docs:connectors:check` must pass (it's the CI drift guard).
- `pnpm --filter @rawdash/connector-<id> test` should pass.
- `grep -rn "TODO(connector)" packages/connectors/<id>` should return nothing.
