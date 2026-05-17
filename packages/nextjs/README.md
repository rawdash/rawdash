# @rawdash/nextjs

[![npm version](https://img.shields.io/npm/v/@rawdash/nextjs)](https://www.npmjs.com/package/@rawdash/nextjs)
[![license](https://img.shields.io/npm/l/@rawdash/nextjs)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Rawdash SDK for the Next.js App Router.

## What it is

`@rawdash/nextjs` extends `@rawdash/client` with Next.js-specific behavior: the `http` function tags widget requests with Next.js cache tags so they can be invalidated via `revalidateTag`, and `createRawdashClient` wraps a data source so `triggerSync` automatically revalidates widget data in Server Components after the sync completes.

Use this package when your rawdash server runs separately from your Next.js app. For an in-process setup (engine in the same Next.js process), use `@rawdash/client`'s `inProcess` directly.

## Install

```sh
npm install @rawdash/nextjs
```

Requires Next.js 14+.

## Quick example

```ts
// lib/rawdash.ts
import { createRawdashClient, http } from '@rawdash/nextjs';

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
  // Triggers sync, waits for completion, then calls revalidateTag('rawdash')
  // so the Server Components re-fetch widget data on next request.
  await rawdash.triggerSync();
}
```

## Switching between in-process and HTTP

```ts
// lib/rawdash.ts
import { inProcess } from '@rawdash/client';
import { createRawdashClient } from '@rawdash/nextjs';
import { http } from '@rawdash/nextjs';

const source =
  process.env.NODE_ENV === 'production'
    ? http({ baseUrl: process.env.RAWDASH_URL! })
    : inProcess(localEngine);

export const rawdash = createRawdashClient(source);
```

## API

### `http(options): DataSource`

Next.js-aware variant of `http` from `@rawdash/client`. Adds the `'rawdash'` cache tag to all widget fetch requests so they can be invalidated with `revalidateTag('rawdash')`. Accepts the same options as `@rawdash/client`'s `http`.

### `createRawdashClient(dataSource): DataSource`

Wraps any `DataSource` with Next.js behavior: `triggerSync` waits for the sync to finish, then calls `revalidateTag('rawdash')` to bust Server Component caches. All other methods are passed through unchanged.

## Links

- [rawdash docs](https://rawdash.dev)
- [GitHub](https://github.com/rawdash/rawdash)
- [Issues](https://github.com/rawdash/rawdash/issues)

## License

Apache-2.0
