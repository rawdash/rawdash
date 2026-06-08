# Connector request pages & upvoting

The docs catalog surfaces two kinds of connector:

- **Available** — a real `@rawdash/connector-*` package, generated from its
  metadata (see [`authoring-a-connector.md`](./authoring-a-connector.md)).
- **Planned / requested** — a placeholder for a connector we have not built
  yet, rendered from a checked-in list. Each gets a lightweight page with an
  **upvote** control so visitors can signal demand. (RAW-361)

## Where the placeholder list lives

`scripts/connector-placeholders.ts` is the single source of truth for planned
connectors. Each entry is `{ id, name, category, tagline, icon?, brandColor?,
requestIssue? }`. The same generator that renders real connectors
(`scripts/generate-connector-docs.ts`) reads this list and produces:

- a per-placeholder page at `/docs/connectors/<category>/<id>/`,
- the placeholder cards in the landing grid and the docs catalog,
- a "Planned / requested" section on each category page,
- a brand icon (synthesized from [Simple Icons](https://simpleicons.org/) when
  available, otherwise a monogram in the entry's `brandColor`).

Placeholders are **deduped against shipped connectors**: if a connector with the
same `id` or display name already exists as a real package, the generator
**fails** (so `docs:connectors:check` goes red in CI) until you cross it off the
list. When a connector ships, remove its entry here — the `new-connector` skill
checklist enforces this.

## How upvoting works (GitHub Discussions native upvotes)

Voting uses **GitHub Discussions' native upvote** — the same model
[Airbyte](https://github.com/airbytehq/airbyte/discussions/categories/new-connector-request)
uses for its "New Connector Request" category. No backend, database, iframe, or
client-side JavaScript is involved.

- Each connector maps to **one discussion** in the **"Connector Requests"**
  category whose **title is the connector id**.
- A visitor upvotes that discussion on GitHub; `upvoteCount` is the tally.
- At **build time**, `apps/website/src/lib/connector-upvotes.ts` fetches every
  connector-request discussion once (GraphQL) and bakes the count into the
  static placeholder page. The count refreshes on each site rebuild.
- The id is also the matching key for seeding (below) and auto-close, so the
  three never drift.

### One-time setup

1. ✅ **Enable Discussions** on `rawdash/rawdash` — already done (RAW-361).
2. **Create a category** named **"Connector Requests"** using the
   **Announcement** format (Discussions → Categories → New). Announcement means
   only maintainers (and the seed script) create discussions, but anyone can
   upvote and comment — exactly what we want. (There is no API to create a
   category; it must be done in the UI.)
3. **Seed the discussions** so every connector has one (and a live count) from
   day one:

   ```sh
   GITHUB_TOKEN=<token with discussions:write> pnpm connectors:seed-discussions
   ```

   It is idempotent — it skips connectors that already have a discussion, so
   re-run it after adding new placeholders. (`DRY_RUN=1` to preview.)

4. **Give the website build a token** so it can read counts: set a read-only
   `GITHUB_TOKEN` in the site's build environment (e.g. the Cloudflare Pages /
   Vercel project env). GitHub's GraphQL API requires auth even for public data;
   without a token the upvote control still renders, just as a plain "Upvote on
   GitHub" link with no number. In GitHub Actions the built-in `GITHUB_TOKEN`
   already works.

The repo and category names are hard-coded in
`apps/website/src/lib/connector-upvotes.ts` (and the two scripts); only the
token is environment-provided.

### Auto-close on ship

When a connector graduates from placeholder to shipped, its entry is removed
from `scripts/connector-placeholders.ts`. The
`.github/workflows/close-connector-discussions.yml` workflow runs on merge to
`main`, detects the removed `id`, and closes the matching "Connector Requests"
discussion as **resolved** (via `scripts/close-connector-discussions.ts`),
posting a comment that links to the new connector's docs.
