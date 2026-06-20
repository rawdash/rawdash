# example-nextjs

A small Tremor/recharts dashboard built on `@rawdash/sdk-nextjs`, used as the public rawdash
example. It is a **pure static export** (`output: 'export'`) with no server runtime, so it can be
deployed to any static host (Cloudflare Workers Static Assets / Pages, Netlify, GitHub Pages, …).

## How it works

The dashboard is fully client-rendered: `src/app/page.tsx` uses the `useDashboard` hook from
`@rawdash/sdk-nextjs/client`, which polls the rawdash API directly from the browser (cadence derived
from each widget's `cachedAt`, faster while a sync is in flight, paused when the tab is hidden).

The rawdash API key must never reach the browser, so the app does **not** talk to the rawdash API
directly. Instead it calls a thin proxy that injects `Authorization: Bearer <key>` and forwards to
the real API. The proxy is **not** part of this repo — it is a standalone, **same-origin** service
that sits in front of the static site (in production, served at `<host>/api/*`). Because it is
same-origin, the app uses the **relative `/api` base** by default, so no proxy URL needs to be baked
into the static build.

```
browser ──> /api/dashboards/github/widgets ──(same-origin proxy injects API key)──> rawdash API
```

### Configuration

| Env var                         | Default | Purpose                                                             |
| ------------------------------- | ------- | ------------------------------------------------------------------- |
| `NEXT_PUBLIC_RAWDASH_PROXY_URL` | `/api`  | Base URL the browser uses to reach the rawdash API (via the proxy). |

In production leave `NEXT_PUBLIC_RAWDASH_PROXY_URL` unset to use the relative `/api` same-origin
base. Set it (e.g. to `http://localhost:8080`) only for local dev or alternate hosts. It is a
`NEXT_PUBLIC_*` variable, so it is inlined at build time.

> **Host-neutral by design.** This package intentionally adds no host-specific dependency
> (`@opennextjs/cloudflare`, `@cloudflare/next-on-pages`, `wrangler.toml`). The build output is a
> plain static export in `out/`.

## Local development

`pnpm dev` runs two processes:

1. A local rawdash API server (Hono, `dev-server.mts`) on `PORT` (default `8080`) that syncs GitHub
   CI data. It serves with permissive CORS so the browser can reach it cross-origin from the Next.js
   dev server. No API key is required for the local server.
2. The Next.js dev server on port `3000`.

With `NEXT_PUBLIC_RAWDASH_PROXY_URL=http://localhost:8080` (see `.env.example`), the browser fetches
widgets straight from the local rawdash server — no proxy is needed in dev.

```sh
cp .env.example .env.local   # then set GITHUB_TOKEN
pnpm dev                     # http://localhost:3000
```

## Build & preview

```sh
pnpm build      # emits the static export to ./out
pnpm preview    # serves ./out on http://localhost:3000
```

`pnpm preview` serves the static files only; point `NEXT_PUBLIC_RAWDASH_PROXY_URL` at a running
proxy/rawdash server (or run behind a same-origin proxy at `/api`) for live data.

## Tests

```sh
pnpm test:e2e   # Playwright; uses a mock rawdash server (e2e/fixtures/mock-server.ts)
```
