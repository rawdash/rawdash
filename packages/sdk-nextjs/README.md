# @rawdash/sdk-nextjs

[![npm version](https://img.shields.io/npm/v/@rawdash/sdk-nextjs)](https://www.npmjs.com/package/@rawdash/sdk-nextjs)
[![license](https://img.shields.io/npm/l/@rawdash/sdk-nextjs)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Rawdash SDK for the Next.js App Router.

## What it is

`@rawdash/sdk-nextjs` extends `@rawdash/sdk-client` with Next.js-specific behavior: the `http` function tags widget requests with Next.js cache tags so they can be invalidated via `revalidateTag`, and `createRawdashClient` wraps a data source so `triggerSync` automatically revalidates widget data in Server Components after the sync completes.

Use this package when your rawdash server runs separately from your Next.js app. For an in-process setup (engine in the same Next.js process), use `@rawdash/sdk-client`'s `inProcess` directly.

## Install

```sh
npm install @rawdash/sdk-nextjs
```

Requires Next.js 14+.

## Quick example

```ts
// lib/rawdash.ts
import { createRawdashClient, http } from '@rawdash/sdk-nextjs';

export const rawdash = createRawdashClient(
  http({
    baseUrl: process.env.RAWDASH_URL!,
    apiKey: process.env.RAWDASH_API_KEY,
  }),
);
```

```tsx
// app/dashboard/page.tsx
import { rawdash } from '@/lib/rawdash';

export default async function DashboardPage() {
  const widgets = await rawdash.getWidgets('engineering');

  return (
    <div>
      {widgets.map((w) => (
        <div key={w.id}>{/* render widget */}</div>
      ))}
    </div>
  );
}
```

In `app/actions.ts`:

```ts
'use server';

import { rawdash } from '@/lib/rawdash';

export async function syncDashboard() {
  // Triggers sync, polls /sync/state until it settles (succeeded or failed),
  // then calls revalidateTag('rawdash') so the Server Components re-fetch
  // widget data on next request. Throws on sync failure.
  await rawdash.triggerSync();
}
```

> **Don't block SSR on a sync.** `triggerSync` (and `ensureFresh`) wait for the sync to settle, which can take up to ~30s. Calling either from a Server Component would block every page render. Use them in Server Actions, cron-triggered routes, or webhooks — and let pages render against whatever's cached.

## Live dashboards (client-side hooks)

For dashboards that stay open all day, `@rawdash/sdk-nextjs/client` exposes `'use client'` hooks backed by the `@rawdash/sdk-runtime` subscription engine. The engine polls on the cadence the server publishes (`cachedAt + syncIntervalSeconds`), polls fast while a sync is in flight, backs off when syncs fail, pauses when the tab is hidden, and refetches on focus.

```tsx
// app/dashboard/live.tsx
'use client';

import { http } from '@rawdash/sdk-nextjs';
import { useDashboard, useWidget } from '@rawdash/sdk-nextjs/client';

// app/dashboard/live.tsx

// app/dashboard/live.tsx

const source = http({ baseUrl: '/rawdash' });

export function LiveDashboard() {
  const { widgets, error } = useDashboard(source, 'engineering');
  if (error) return <div>Connection error</div>;
  return (
    <div>
      {Object.values(widgets).map((w) => (
        <div key={w.widgetId}>{JSON.stringify(w.data)}</div>
      ))}
    </div>
  );
}

export function Revenue() {
  const { widget, syncState } = useWidget<number>(
    source,
    'engineering',
    'revenue',
  );
  return (
    <div>
      {widget?.data ?? '—'} {syncState === 'syncing' && '(refreshing…)'}
    </div>
  );
}
```

Two consumption modes, one package:

- **Server Components** (`@rawdash/sdk-nextjs`): static-feeling SSR via `createRawdashClient` + `revalidateTag`.
- **Client hooks** (`@rawdash/sdk-nextjs/client`): always-open dashboards with per-widget auto-polling.

## Switching between in-process and HTTP

```ts
// lib/rawdash.ts
import { inProcess } from '@rawdash/sdk-client';
import { createRawdashClient } from '@rawdash/sdk-nextjs';
import { http } from '@rawdash/sdk-nextjs';

const source =
  process.env.NODE_ENV === 'production'
    ? http({ baseUrl: process.env.RAWDASH_URL! })
    : inProcess(localEngine);

export const rawdash = createRawdashClient(source);
```

## API

### `http(options): DataSource`

Next.js-aware variant of `http` from `@rawdash/sdk-client`. Adds the `'rawdash'` cache tag to all widget fetch requests so they can be invalidated with `revalidateTag('rawdash')`. Accepts the same options as `@rawdash/sdk-client`'s `http`.

### `createRawdashClient(dataSource): DataSource`

Wraps any `DataSource` with Next.js behavior: `triggerSync` polls `/sync/state` until the sync settles (transitions to `succeeded` or `failed`), then calls `revalidateTag('rawdash')` to bust Server Component caches. Throws on `failed` or if the sync doesn't settle within 30s. `ensureFresh` is also tagged to revalidate after a sync. All other methods are passed through unchanged.

## Links

- [rawdash docs](https://rawdash.dev)
- [GitHub](https://github.com/rawdash/rawdash)
- [Issues](https://github.com/rawdash/rawdash/issues)

## License

Apache-2.0
