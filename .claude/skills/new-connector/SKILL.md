---
name: new-connector
description: Scaffold a new rawdash connector package under packages/connectors/<id>. Use whenever the user asks to "add a new connector", "create a connector for <vendor>", "scaffold a <vendor> integration", or similar. Generates the package skeleton (package.json, tsconfig, vitest config, src/index.ts, src/<id>.ts, src/property.test.ts) using the shared substrate in @rawdash/connector-shared, @rawdash/core, and @rawdash/connector-test-utils. The dev still writes the vendor-specific API types, Zod schemas, URL builders, and writers — everything else is boilerplate this skill emits.
---

# new-connector

Scaffolds a new connector package in `packages/connectors/<id>/` using the shared substrate. The output is a package that compiles, tests pass with empty schemas, and clearly marks where the dev fills in the integration-specific code with `TODO(connector)` comments.

## When to invoke

Trigger on requests like:
- "add a new connector for X"
- "scaffold a connector for X"
- "create the X integration"
- "/new-connector linear"

## Important: do NOT force a Q&A flow

If the user has already provided the relevant details in their message (connector id, vendor display name, auth shape, pagination style, resources list, API host), use them directly — do not re-ask.

Only ask for fields that are **missing AND required to scaffold** (see "Required inputs" below). When asking, ask for several at once via `AskUserQuestion`, not one-by-one.

If the user said "just scaffold it, I'll fill the rest", default to:
- auth shape: `bearer-token`
- pagination: `cursor` (string `next` field)
- resources: a single placeholder `items`
- API host: `api.<id>.com`

…and emit `TODO(connector)` markers for everything the dev needs to revisit.

## Required inputs

Must be known (provided by user or sensibly defaulted) before scaffolding:

1. **`id`** — kebab-case connector id (e.g. `pagerduty`, `clickup`). Used as package name suffix, class id, and storage scope. Required, no default.
2. **`displayName`** — human name for descriptions ("PagerDuty"). Default: capitalize `id`.
3. **`auth`** — one of:
   - `bearer-token` — `Authorization: Bearer <secret>`
   - `api-key-header` — custom header (ask for header name)
   - `basic` — username + secret password
   - `oauth-refresh` — refresh-token flow (see google-analytics for an example, treat as advanced)
   Default: `bearer-token`.
4. **`pagination`** — one of:
   - `cursor` — request returns `next_cursor` string
   - `page` — request returns numeric `next` page index
   - `link-header` — RFC 5988 `Link` header (see github connector)
   - `graphql-connection` — `pageInfo { hasNextPage endCursor }` (see linear connector)
   - `none` — single-shot endpoint
   Default: `cursor`.
5. **`resources`** — array of resource ids the connector will sync. Default: `['items']`.
6. **`apiHost`** — base host (no protocol). Default: `api.<id>.com`.
7. **`rateLimit`** — optional, one of:
   - `{ kind: 'standard', remainingHeader, resetHeader, resetUnit: 's' | 'ms' }` — emits a `standardRateLimitPolicy` call.
   - `none` — omits rate-limit wiring.
   Default: `none`. (User can fill in later.)

## What the skill generates

```text
packages/connectors/<id>/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── tsup.config.ts
├── README.md
├── src/
│   ├── index.ts          # exports { <Class>Connector, configFields } + default
│   ├── <id>.ts           # connector class
│   └── property.test.ts  # property-test skeleton
```

### package.json template

Mirror an existing simple connector (e.g. `packages/connectors/vercel/package.json`):
- `name`: `@rawdash/connector-<id>`
- `version`: `0.0.1`
- `dependencies`: `@rawdash/connector-shared`, `@rawdash/core`, `zod`
- `devDependencies`: `@rawdash/connector-test-utils`, `tsup`, `typescript`, `vitest`
- Mirror `scripts`, `exports`, and `tsup` setup.

### src/<id>.ts skeleton

The skill emits a file using the cleaned-up shape from `RAW-326`. Concretely:

```ts
import {
  type HttpResponse,
  connectorUserAgent,
  parseEpoch,
  sanitizeAllowedUrl,
  // standardRateLimitPolicy,  // uncomment if rateLimit configured
} from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ChunkedSyncCursor,
  type ConnectorContext,
  type CredentialsSchema,
  type StorageHandle,
  type SyncOptions,
  type SyncResult,
  defineConfigFields,
  makeChunkedCursorGuard,
  paginateChunked,
  selectActivePhases,
} from '@rawdash/core';
import { z } from 'zod';

export const configFields = defineConfigFields(
  z.object({
    // TODO(connector): the secret field name + label per auth shape.
    apiToken: z.object({ $secret: z.string() }).meta({
      label: 'API Token',
      description: '<DisplayName> API token. Create one at <vendor docs URL>.',
      secret: true,
    }),
    resources: z
      .array(z.enum([/* TODO(connector): resource ids */]))
      .nonempty()
      .optional(),
  }),
);

export type <Class>Resource = /* TODO(connector): union of resource literals */;

export interface <Class>Settings {
  resources?: readonly <Class>Resource[];
}

const <id>Credentials = {
  apiToken: { description: '<DisplayName> API token', auth: 'required' as const },
} satisfies CredentialsSchema;
type <Class>Credentials = typeof <id>Credentials;

// Rate-limit policy (if configured)
// const <id>RateLimit = standardRateLimitPolicy({ ... });

const PHASE_ORDER = [/* TODO(connector): phase ids in execution order */] as const;
type <Class>Phase = (typeof PHASE_ORDER)[number];
type <Class>SyncCursor = ChunkedSyncCursor<<Class>Phase, string>;
const is<Class>SyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

const <ID>_API_HOST = '<apiHost>';
const <ID>_API_BASE = `https://${<ID>_API_HOST}`;

// TODO(connector): API response types + Zod schemas

export class <Class>Connector extends BaseConnector<<Class>Settings, <Class>Credentials> {
  static readonly id = '<id>';
  static readonly schemas = {
    // TODO(connector): per-resource response schemas
  } as const;

  static create(input: unknown, ctx?: ConnectorContext): <Class>Connector {
    const parsed = configFields.parse(input);
    return new <Class>Connector(
      { resources: parsed.resources },
      { apiToken: parsed.apiToken },
      ctx,
    );
  }

  readonly id = '<id>';
  override readonly credentials = <id>Credentials;

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.creds.apiToken}`,
      'User-Agent': connectorUserAgent('<id>'),
    };
  }

  private fetch<T>(url: string, resource: string, signal?: AbortSignal): Promise<HttpResponse<T>> {
    return this.get<T>(url, {
      resource,
      headers: this.buildHeaders(),
      signal,
      // rateLimit: <id>RateLimit,  // uncomment if rate-limit configured
    });
  }

  private activePhases(): <Class>Phase[] {
    return selectActivePhases<<Class>Resource, <Class>Phase>(
      (r) => r as <Class>Phase, // TODO(connector): map resource → phase if not 1:1
      PHASE_ORDER,
      this.settings.resources,
    );
  }

  private allowedPagePath(phase: <Class>Phase): string {
    // TODO(connector): per-phase path
    switch (phase) {
      default: return '';
    }
  }

  private sanitizePageUrl(phase: <Class>Phase, pageUrl: string | null): string | null {
    return sanitizeAllowedUrl({
      url: pageUrl,
      host: <ID>_API_HOST,
      pathname: this.allowedPagePath(phase),
    });
  }

  private resolveCursor(cursor: unknown): <Class>SyncCursor | undefined {
    if (!is<Class>SyncCursor(cursor)) return undefined;
    return { phase: cursor.phase, page: this.sanitizePageUrl(cursor.phase, cursor.page) };
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor = this.resolveCursor(options.cursor);
    const isFull = options.mode === 'full';
    const phases = this.activePhases();

    return paginateChunked<<Class>Phase, string>({
      phases,
      cursor,
      signal,
      fetchPage: async (phase, page, sig) => {
        // TODO(connector): per-phase fetch
        return { items: [], next: null };
      },
      writeBatch: async (phase, items, page) => {
        if (isFull && page === null) {
          // TODO(connector): truncate this phase's entities/events
        }
        // TODO(connector): per-phase writer
      },
    });
  }
}

export default <Class>Connector;
```

Use `TODO(connector)` everywhere the dev needs to fill in — grep `TODO(connector)` afterward to find every site.

### src/property.test.ts skeleton

```ts
import {
  type InvariantViolation,
  entityStoreFor,
  installFetchMock,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { <Class>Connector } from './<id>';

const CONNECTOR_ID = '<id>';

describe('<Class>Connector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // TODO(connector): one `it` per resource — pattern below
  // it('items: sync upholds universal invariants for any valid API payload', async () => { ... });
});
```

### src/index.ts

```ts
export { <Class>Connector, configFields } from './<id>';
export type { <Class>Resource, <Class>Settings } from './<id>';
export { default } from './<id>';
```

## After scaffolding

1. Run `pnpm install` so workspace links pick up the new package.
2. Print the file list and the post-scaffold checklist:
   - Fill in API types + Zod schemas in `src/<id>.ts`.
   - Implement `fetchPage` per phase.
   - Implement writers + truncation per phase.
   - Add a property-test `it` per resource.
   - `pnpm --filter @rawdash/connector-<id> test`.
3. Do **not** add the connector to any registry/index files. The dev will wire it in once the integration is real.

## Cross-references for the agent

When the dev asks "how does X work?", look at the closest existing connector for an example pattern:
- Cursor-based pagination + URL sanitization: `packages/connectors/vercel/src/vercel.ts`
- Link-header pagination: `packages/connectors/github/src/github.ts`
- GraphQL connections: `packages/connectors/linear/src/linear.ts`
- Standard list endpoint (Stripe-style `has_more`): `packages/connectors/stripe/src/stripe.ts`
- OAuth refresh + custom cursor shape: `packages/connectors/google-analytics/src/google-analytics.ts`
- Mix of entities + events + metrics: `packages/connectors/sentry/src/sentry.ts`
