# Content feed integration

The marketing content surface (`/blog`, `/integrations`, `/compare`,
`/alternatives`, `/dashboards`) is **not** authored in this public repo. Content lives and is
automated in the private cloud repo (RAW-370) and is served to this site as a
presentation-agnostic JSON feed (RAW-371). This site fetches that feed **at
build time only** (SSG — never a client-side runtime fetch) and renders static
HTML on the `rawdash.dev` apex, where domain authority accumulates.

This document is the wire contract between the feed (RAW-371) and this
build-time consumer (RAW-372).

## Environment variables

| Variable             | Required | Default                                      | Purpose                                 |
| -------------------- | -------- | -------------------------------------------- | --------------------------------------- |
| `CONTENT_FEED_TOKEN` | gate     | —                                            | Bearer build token. **Absent → skip.**  |
| `CONTENT_FEED_URL`   | no       | `https://cloud.rawdash.dev/api/content/feed` | Full URL of the feed endpoint to `GET`. |

### Token gating

The loader is gated on `CONTENT_FEED_TOKEN`:

- **Token absent** — the content collection is skipped with an info log. The
  build still succeeds and the content routes simply emit nothing. This keeps
  local docs builds and outside-contributor CI green without secrets.
- **Token present but rejected (non-2xx), or feed unreachable** — a hard build
  error. We never silently ship an empty content section in production.

Drafts (`draft: true`) are filtered out at load time.

## Request

```http
GET <CONTENT_FEED_URL>
Authorization: Bearer <CONTENT_FEED_TOKEN>
Accept: application/json
```

## Response

```jsonc
{
  "version": 1,
  "generatedAt": "2026-05-31T00:00:00.000Z", // optional ISO timestamp
  "items": [
    {
      "pageType": "blog", // "blog" | "integration" | "compare" | "alternative" | "dashboard"
      "slug": "stripe-revenue-dashboard",
      "title": "Build a Stripe revenue dashboard", // the single on-page H1
      "metaTitle": "Stripe Revenue Dashboard — Rawdash", // optional <title> override
      "metaDescription": "Track MRR, churn, and net revenue …", // meta + listing dek
      "description": "Short listing summary.", // optional; falls back to metaDescription
      "body": "## Why …\n\nPlain **markdown** only — no JSX/components.",
      "targetKeyword": "stripe revenue dashboard", // optional, not rendered
      "connectors": ["stripe"], // optional connector ids
      "faq": [
        // optional; rendered as a FAQ section + FAQPage JSON-LD on `dashboard` pages
        {
          "question": "How fresh is the data?",
          "answer": "Synced every 15 minutes.",
        },
      ],
      "cta": {
        // optional; defaults to the generic Cloud CTA
        "label": "Start free on Rawdash Cloud ↗",
        "href": "https://cloud.rawdash.dev/signup?utm_source=blog",
      },
      "competitor": "Geckoboard", // optional; for compare / alternative pages
      "author": "Elad Shaham", // optional; blog byline
      "tags": ["stripe", "finance"], // optional
      "publishedAt": "2026-05-20T00:00:00.000Z", // optional ISO
      "updatedAt": "2026-05-22T00:00:00.000Z", // optional ISO
      "draft": false, // optional; drafts are dropped
    },
  ],
}
```

### Field rules

- `pageType` + `slug` are required and form the route: `/{section}/{slug}/`,
  where the section is `blog`, `integrations`, `compare`, `alternatives`, or
  `dashboards`.
- `body` is **plain markdown** (rendered to HTML at build via `marked`).
  Keep it presentation-agnostic: no MDX, no JSX, no Astro components — markup
  lives here in the OSS repo, data lives in the feed (see RAW-370).
- `connectors` and `faq` drive the dedicated sections on `dashboard` pages
  (connector chips link to the docs; `faq` also emits `FAQPage` JSON-LD). They
  are accepted on any `pageType` but only rendered by the dashboard template.
- All CTA links should point at the `cloud.rawdash.dev` conversion surface.

## Rendering & SEO

Each page gets: one `<h1>`, a meta title/description, a canonical URL, Open
Graph/Twitter tags, JSON-LD (`BlogPosting` for blog, `WebPage` for the SEO
pages, a `FAQPage` when a `dashboard` page carries `faq`, plus a
`BreadcrumbList`), and inclusion in `sitemap.xml` via `@astrojs/sitemap`. Every
page cross-links down to `cloud.rawdash.dev`.
