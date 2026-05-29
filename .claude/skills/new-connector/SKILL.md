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
   - All references in `README.md`.
5. **Strip what's vendor-specific from the copy** so the dev fills it in:
   - API response TypeScript types.
   - Zod response schemas (`static schemas`).
   - URL builders (`buildInitial*Url`, `allowedPagePath`).
   - Per-phase `fetchPage` and `writeBatch` bodies.
   - Entity/event/metric writers.
   - `PHASE_ORDER` and resource enum.

   Leave `TODO(connector)` comments at each removed site so `grep TODO(connector)` finds every spot the dev needs to revisit.
6. **Keep the shared substrate calls intact** — these are the parts the dev should NOT re-derive:
   - `BaseConnector` extension, `protected fetch` / `get` / `post`.
   - `paginateChunked` orchestration.
   - `makeChunkedCursorGuard`, `selectActivePhases`, `sanitizeAllowedUrl`.
   - `standardRateLimitPolicy` (if the vendor exposes standard rate-limit headers).
   - `connectorUserAgent('<id>')`.
   - `parseEpoch` for any timestamp normalization.
   - The property-test scaffolding from `@rawdash/connector-test-utils`.
7. **Auth setup** — do **not** invent or recommend an auth shape. Read the vendor's official docs and follow what they recommend for server-to-server access. Write the `Auth setup` section of the new connector's `README.md` to mirror the existing connectors' style: numbered steps, links to the vendor's console, exactly the secrets the dev needs to store. If the vendor supports multiple auth methods, document the recommended one as Option A and any alternatives as Option B/C, matching what the vendor's docs call out.
8. **Run `pnpm install`** so workspace links pick up the new package.

## Bias against asking questions

If the user provided the connector id, vendor name, or any other detail in their message, use it. Only ask for what's both **missing** and **required to scaffold** (in practice, just the connector id is required).

When asking, ask via `AskUserQuestion` and bundle multiple questions in one call.

## Contract reminders for the dev

The scaffolded `sync()` will compile against an old version of the contract, but it won't be _correct_ until the dev satisfies all of the following. Surface this list (verbatim) when you hand off:

- **Honor `options.since`.** Pass it through to the upstream API as a filter, and short-circuit pagination once a page is entirely older than `since`. Don't fetch the full backfill and drop rows client-side. See [`docs/authoring-a-connector.md` §4](../../../docs/authoring-a-connector.md#optionssince).
- **Honor `options.resources`.** Skip phases whose resource isn't in the allowlist. Also skip N+1 subresource calls (per-row reviews, per-issue events) gated on the same allowlist. Use `selectActivePhases` from `@rawdash/core`.
- **Stay a pure resource syncer.** A connector's only job is to sync rows (or write `metric` samples for natively metric-shaped sources). Do not intercept widget/metric queries to answer them server-side — the engine owns all query-time aggregation via `computeMetric`. There is deliberately no connector-level `aggregate()` hook.
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
- Pass `logger: this.logger` to `paginateChunked` so the per-page / per-resource INFO logs land in the right shape; hand-rolled loops must mirror the shape from `docs/authoring-a-connector.md` §6.
- Add a property-test `it` per resource in `src/property.test.ts`.
- Write the README's `Auth setup` and `Configuration` sections following the vendor's official docs.
- `pnpm --filter @rawdash/connector-<id> test` should pass.
- `grep -rn "TODO(connector)" packages/connectors/<id>` should return nothing.
