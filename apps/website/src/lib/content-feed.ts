import type { Loader, LoaderContext } from 'astro/loaders';
import { marked } from 'marked';

/**
 * Build-time integration with the cloud content feed (RAW-371).
 *
 * The marketing content (blog posts, integration money-pages, comparison and
 * "alternative" pages) is authored and automated in the private cloud repo and
 * served as a presentation-agnostic JSON feed. This OSS site fetches that feed
 * **at build time only** (SSG, never client-side runtime) and renders it to
 * static HTML on the `rawdash.dev` apex, where domain authority accumulates.
 *
 * Auth is a build token. The loader is **gated on the token**: contributor and
 * local docs builds without `CONTENT_FEED_TOKEN` skip the content section
 * gracefully instead of failing. A token that is present but rejected, or a
 * feed that is unreachable, is a hard build error — we never silently ship an
 * empty content section in production.
 *
 * See `docs/CONTENT_FEED.md` for the wire contract.
 */

export type ContentPageType =
  | 'blog'
  | 'integration'
  | 'compare'
  | 'alternative';

/** One published page as served by the feed (RAW-371). */
export type ContentFeedItem = {
  /** Which section the page belongs to; selects route + template. */
  pageType: ContentPageType;
  /** Path segment within the section, e.g. `stripe-revenue-dashboard`. */
  slug: string;
  /** The single on-page H1. */
  title: string;
  /** `<title>` override; falls back to `title`. */
  metaTitle?: string;
  /** Meta description / listing dek. */
  metaDescription: string;
  /** Short summary shown in section listings; falls back to metaDescription. */
  description?: string;
  /** Page body as plain markdown (no JSX / components — see RAW-370). */
  body: string;
  /** SEO target keyword (internal; not rendered). */
  targetKeyword?: string;
  /** Connector ids referenced by the page. */
  connectors?: string[];
  /** Conversion CTA, always pointing at the cloud subdomain. */
  cta?: { label: string; href: string };
  /** Competitor name for `compare` / `alternative` pages. */
  competitor?: string;
  /** Author display name for blog posts. */
  author?: string;
  /** Free-form tags. */
  tags?: string[];
  /** ISO timestamps. */
  publishedAt?: string;
  updatedAt?: string;
  /** Drafts are filtered out at load time. */
  draft?: boolean;
};

interface ContentFeedResponse {
  version: number;
  generatedAt?: string;
  items: ContentFeedItem[];
}

const DEFAULT_FEED_URL = 'https://cloud.rawdash.dev/api/content-feed';

/**
 * Astro Content Layer loader for the cloud content feed. Registered as the
 * `content` collection in `content.config.ts`.
 */
export function contentFeedLoader(): Loader {
  return {
    name: 'rawdash-content-feed',
    load: async ({
      store,
      logger,
      parseData,
      generateDigest,
    }: LoaderContext) => {
      const token = process.env.CONTENT_FEED_TOKEN?.trim();
      const url = process.env.CONTENT_FEED_URL?.trim() || DEFAULT_FEED_URL;

      store.clear();

      if (!token) {
        logger.info(
          'CONTENT_FEED_TOKEN not set — skipping marketing content feed ' +
            '(/blog, /integrations, /compare, /alternatives). This is expected ' +
            'for local docs and contributor builds.',
        );
        return;
      }

      logger.info(`Fetching content feed from ${url}`);

      let response: Response;
      try {
        response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
        });
      } catch (error) {
        throw new Error(
          `Content feed request to ${url} failed: ${(error as Error).message}`,
        );
      }

      if (!response.ok) {
        throw new Error(
          `Content feed request to ${url} returned ${response.status} ${response.statusText}`,
        );
      }

      const payload = (await response.json()) as ContentFeedResponse;
      const items = Array.isArray(payload.items) ? payload.items : [];

      let published = 0;
      for (const item of items) {
        if (item.draft) {
          continue;
        }
        if (!item.pageType || !item.slug) {
          logger.warn(
            `Skipping content feed item with missing pageType/slug: ${JSON.stringify(
              item,
            ).slice(0, 120)}`,
          );
          continue;
        }

        const id = `${item.pageType}/${item.slug}`;
        const data = await parseData({ id, data: item });
        const html = await marked.parse(item.body ?? '', { async: false });

        store.set({
          id,
          data,
          body: item.body,
          rendered: { html },
          digest: generateDigest({ ...data, html }),
        });
        published++;
      }

      logger.info(`Loaded ${published} published content item(s) from feed`);
    },
  };
}
