import type { Loader, LoaderContext } from 'astro/loaders';
import { marked } from 'marked';

export type ContentPageType =
  | 'blog'
  | 'integration'
  | 'compare'
  | 'alternative'
  | 'dashboard'
  | 'metric';

export type ContentFeedItem = {
  pageType: ContentPageType;
  slug: string;
  title: string;
  metaTitle?: string;
  metaDescription: string;
  description?: string;
  body: string;
  targetKeyword?: string;
  connectors?: string[];
  faq?: { question: string; answer: string }[];
  cta?: { label: string; href: string };
  competitor?: string;
  author?: string;
  tags?: string[];
  definition?: string;
  formula?: string;
  benchmark?: { label: string; value: string }[];
  relatedMetrics?: { slug: string; title: string }[];
  pitfalls?: string[];
  publishedAt?: string;
  updatedAt?: string;
  draft?: boolean;
};

interface ContentFeedResponse {
  version: number;
  generatedAt?: string;
  items: ContentFeedItem[];
}

const DEFAULT_FEED_URL = 'https://cloud.rawdash.dev/api/content/feed';

interface FeedLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
}

export async function fetchPublishedFeedItems(
  logger: FeedLogger = console,
): Promise<ContentFeedItem[]> {
  const token = process.env.CONTENT_FEED_TOKEN?.trim();
  const url = process.env.CONTENT_FEED_URL?.trim() || DEFAULT_FEED_URL;

  if (!token) {
    logger.info(
      'CONTENT_FEED_TOKEN not set — skipping marketing content feed ' +
        '(/blog, /integrations, /compare, /alternatives, /dashboards, /metrics). ' +
        'This is expected for local docs and contributor builds.',
    );
    return [];
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

  let payload: ContentFeedResponse;
  try {
    payload = (await response.json()) as ContentFeedResponse;
  } catch (error) {
    throw new Error(
      `Content feed response from ${url} returned invalid JSON: ${(error as Error).message}`,
    );
  }
  const items = Array.isArray(payload.items) ? payload.items : [];

  return items.filter((item) => {
    if (item.draft) {
      return false;
    }
    if (!item.pageType || !item.slug) {
      logger.warn(
        `Skipping content feed item with missing pageType/slug: ${JSON.stringify(
          item,
        ).slice(0, 120)}`,
      );
      return false;
    }
    return true;
  });
}

export function contentFeedLoader(): Loader {
  return {
    name: 'rawdash-content-feed',
    load: async ({
      store,
      logger,
      parseData,
      generateDigest,
    }: LoaderContext) => {
      store.clear();

      const items = await fetchPublishedFeedItems(logger);

      for (const item of items) {
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
      }

      logger.info(`Loaded ${items.length} published content item(s) from feed`);
    },
  };
}
