import { connectorUserAgent, parseEpoch } from '@rawdash/connector-shared';
import type { HttpResponse } from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ChunkedSyncCursor,
  type ConnectorContext,
  type ConnectorDoc,
  type CredentialsSchema,
  type Entity,
  type JSONValue,
  type MetricSample,
  type StorageHandle,
  type SyncOptions,
  type SyncResult,
  defineConfigFields,
  defineConnectorDoc,
  defineResources,
  makeChunkedCursorGuard,
  metricSample,
  paginateChunked,
  schemasFromResources,
  selectActivePhases,
} from '@rawdash/core';
import { z } from 'zod';

export const configFields = defineConfigFields(
  z.object({
    apiToken: z.object({ $secret: z.string() }).meta({
      label: 'API token',
      description:
        'Product Hunt API access token. A developer token from the Product Hunt API dashboard works for read-only access.',
      placeholder: 'Bearer token from the API dashboard',
      secret: true,
    }),
    slugs: z
      .array(z.string().min(1))
      .nonempty()
      .refine((values) => new Set(values).size === values.length, {
        error: 'Slugs must be unique.',
      })
      .optional()
      .meta({
        label: 'Post slugs (optional)',
        description:
          'Track specific launches by slug (the last path segment of a Product Hunt post URL). Omit to sync every post in the lookback window.',
        placeholder: 'my-product',
      }),
    topic: z.string().min(1).optional().meta({
      label: 'Topic (optional)',
      description:
        'Restrict the feed sync to a single Product Hunt topic slug. Ignored when specific post slugs are configured.',
      placeholder: 'developer-tools',
    }),
    lookbackDays: z.number().int().positive().optional().meta({
      label: 'Lookback days (full sync)',
      description:
        'How many days of launches to fetch on a full sync when no post slugs are configured. Defaults to 30.',
      placeholder: '30',
    }),
    resources: z
      .array(z.enum(['posts', 'post_metrics']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which Product Hunt resources to sync. Omit to sync all of them.',
      }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Product Hunt',
  category: 'marketing',
  brandColor: '#DA552F',
  tagline:
    'Sync Product Hunt launches as entities and daily vote, comment, and rank snapshots as metrics, for launch-day velocity and post-launch rank trajectory widgets.',
  vendor: {
    name: 'Product Hunt',
    domain: 'producthunt.com',
    apiDocs: 'https://api.producthunt.com/v2/docs',
    website: 'https://www.producthunt.com',
  },
  auth: {
    summary:
      'A Product Hunt API access token, sent as a bearer token on every GraphQL request. A non-expiring developer token is enough for the read-only access this connector needs.',
    setup: [
      'Sign in to Product Hunt and open the API dashboard at https://www.producthunt.com/v2/oauth/applications.',
      'Create an application (or open an existing one) and copy its developer token. Alternatively, exchange your client id and secret at https://api.producthunt.com/v2/oauth/token with grant_type=client_credentials for a client-level read-only token.',
      'Store the token as a secret and reference it from the connector config as `apiToken: secret("PRODUCT_HUNT_API_TOKEN")`.',
    ],
  },
  rateLimit:
    'The GraphQL endpoint meters a complexity budget of 6250 points per 15 minutes rather than a fixed request count. The connector requests a small fixed field set and pages 20 posts at a time to stay well inside the budget; the shared HTTP client backs off on 429 responses.',
  limitations: [
    'Vote and comment history is not exposed by the API, so metric samples are snapshots taken at sync time and bucketed per UTC day. Velocity is derived from successive syncs - a day with no sync has no sample.',
    'Only one sample per post per UTC day is retained; a later sync on the same day replaces the earlier one.',
    'Ranks come straight from the API (dailyRank, weeklyRank) and are null for posts that were never featured.',
    'Comment bodies, votes, collections, and maker profiles are out of scope; only post-level counters are synced.',
  ],
});

export interface ProductHuntSettings {
  slugs?: readonly string[];
  topic?: string;
  lookbackDays?: number;
  resources?: readonly ProductHuntResource[];
}

const productHuntCredentials = {
  apiToken: {
    description: 'Product Hunt API access token',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type ProductHuntCredentials = typeof productHuntCredentials;

const PHASE_ORDER = ['posts', 'post_metrics'] as const;

type ProductHuntPhase = (typeof PHASE_ORDER)[number];

export type ProductHuntResource = ProductHuntPhase;

type ProductHuntSyncCursor = ChunkedSyncCursor<ProductHuntPhase, string>;

const isProductHuntSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

const ENDPOINT = 'https://api.producthunt.com/v2/api/graphql';
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_LOOKBACK_DAYS = 30;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const CHUNK_BUDGET_MS = 25_000;

const POST_ENTITY = 'product_hunt_post';
const POST_METRIC = 'product_hunt_post_metrics';

const POST_FIELDS = `
  id
  name
  slug
  tagline
  description
  votesCount
  commentsCount
  reviewsCount
  reviewsRating
  dailyRank
  weeklyRank
  createdAt
  featuredAt
  url
  website
  topics(first: 10) { nodes { id name slug } }
`;

const POSTS_QUERY = `
  query Posts(
    $first: Int!
    $after: String
    $postedAfter: DateTime
    $topic: String
  ) {
    posts(
      order: NEWEST
      first: $first
      after: $after
      postedAfter: $postedAfter
      topic: $topic
    ) {
      nodes { ${POST_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const POST_BY_SLUG_QUERY = `
  query PostBySlug($slug: String!) {
    post(slug: $slug) { ${POST_FIELDS} }
  }
`;

const isoTimestampString = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/,
  );

const topicSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  slug: z.string().nullish(),
});

const postSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  slug: z.string(),
  tagline: z.string().nullish(),
  description: z.string().nullish(),
  votesCount: z.number().nullish(),
  commentsCount: z.number().nullish(),
  reviewsCount: z.number().nullish(),
  reviewsRating: z.number().nullish(),
  dailyRank: z.number().nullish(),
  weeklyRank: z.number().nullish(),
  createdAt: isoTimestampString,
  featuredAt: isoTimestampString.nullish(),
  url: z.string().nullish(),
  website: z.string().nullish(),
  topics: z.object({ nodes: z.array(topicSchema) }).nullish(),
});

const pageInfoSchema = z.object({
  hasNextPage: z.boolean(),
  endCursor: z.string().nullish(),
});

const postsResponseSchema = z.object({
  posts: z.object({
    nodes: z.array(postSchema),
    pageInfo: pageInfoSchema,
  }),
});

const postBySlugResponseSchema = z.object({
  post: postSchema.nullable(),
});

export const productHuntResources = defineResources({
  [POST_ENTITY]: {
    shape: 'entity',
    description:
      'Product Hunt launches with their name, tagline, counters, ranks, and launch timestamps.',
    endpoint: 'GraphQL query: posts { nodes { ... } } / post(slug:) { ... }',
    filterable: [],
    fields: [
      { name: 'slug', description: 'URL slug of the launch.' },
      { name: 'name', description: 'Product name.' },
      { name: 'tagline', description: 'One-line pitch shown on the listing.' },
      { name: 'description', description: 'Longer product description.' },
      { name: 'votesCount', description: 'Upvotes at the time of the sync.' },
      {
        name: 'commentsCount',
        description: 'Comments at the time of the sync.',
      },
      { name: 'reviewsCount', description: 'Number of reviews.' },
      { name: 'reviewsRating', description: 'Average review rating.' },
      {
        name: 'dailyRank',
        description: 'Rank on its launch day, or null when not featured.',
      },
      {
        name: 'weeklyRank',
        description: 'Rank for its launch week, or null when not featured.',
      },
      { name: 'topics', description: 'Topic names attached to the launch.' },
      { name: 'url', description: 'Product Hunt listing URL.' },
      { name: 'website', description: 'Product website URL.' },
      { name: 'createdAt', description: 'Post creation time (epoch ms).' },
      {
        name: 'featuredAt',
        description: 'Time the post was featured (epoch ms), or null.',
      },
    ],
    responses: {
      posts: postsResponseSchema,
      post_by_slug: postBySlugResponseSchema,
    },
  },
  [POST_METRIC]: {
    shape: 'metric',
    description:
      'Daily snapshot of the vote, comment, review, and rank counters of each tracked launch. The metric value is the upvote count.',
    endpoint: 'GraphQL query: posts { nodes { ... } } / post(slug:) { ... }',
    unit: 'votes',
    granularity: 'day',
    notes:
      'The API exposes current counters only, so each sample is a snapshot taken at sync time and bucketed into the UTC day it was taken. Samples for the current day are replaced on every sync, so re-syncing is idempotent; earlier days are preserved.',
    dimensions: [
      { name: 'date', description: 'UTC day the snapshot was taken.' },
      { name: 'postId', description: 'Product Hunt post id.' },
      { name: 'slug', description: 'URL slug of the launch.' },
      { name: 'postName', description: 'Product name.' },
    ],
    measures: [
      { name: 'votes', description: 'Upvote count at snapshot time.' },
      { name: 'comments', description: 'Comment count at snapshot time.' },
      { name: 'reviews', description: 'Review count at snapshot time.' },
      { name: 'reviewsRating', description: 'Average review rating.' },
      {
        name: 'dailyRank',
        description: 'Rank on the launch day, or null when not featured.',
      },
      {
        name: 'weeklyRank',
        description: 'Rank for the launch week, or null when not featured.',
      },
    ],
    responses: {
      post_metrics: postsResponseSchema,
      post_metrics_by_slug: postBySlugResponseSchema,
    },
  },
});

export type ProductHuntPost = z.infer<typeof postSchema>;

interface GraphQLError {
  message: string;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLError[];
}

interface PostsPayload {
  posts: { nodes: ProductHuntPost[]; pageInfo: z.infer<typeof pageInfoSchema> };
}

interface PostPayload {
  post: ProductHuntPost | null;
}

function startOfUtcDay(ms: number): number {
  return Math.floor(ms / MS_PER_DAY) * MS_PER_DAY;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toIsoDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function counterValue(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function nullableNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clampPageSize(requested: number | undefined): number {
  const n = requested ?? DEFAULT_PAGE_SIZE;
  if (!Number.isFinite(n) || n < 1) {
    return 1;
  }
  return Math.min(Math.floor(n), MAX_PAGE_SIZE);
}

export function postToEntity(post: ProductHuntPost): Entity {
  const createdMs = parseEpoch(post.createdAt, 'iso');
  const featuredMs = post.featuredAt
    ? parseEpoch(post.featuredAt, 'iso')
    : null;
  const topics: JSONValue = (post.topics?.nodes ?? []).map(
    (topic) => topic.name,
  );
  return {
    type: POST_ENTITY,
    id: post.id,
    attributes: {
      slug: post.slug,
      name: post.name,
      tagline: post.tagline ?? null,
      description: post.description ?? null,
      votesCount: counterValue(post.votesCount),
      commentsCount: counterValue(post.commentsCount),
      reviewsCount: counterValue(post.reviewsCount),
      reviewsRating: nullableNumber(post.reviewsRating),
      dailyRank: nullableNumber(post.dailyRank),
      weeklyRank: nullableNumber(post.weeklyRank),
      topics,
      url: post.url ?? null,
      website: post.website ?? null,
      createdAt: createdMs,
      featuredAt: featuredMs,
    },
    updated_at: featuredMs ?? createdMs ?? 0,
  };
}

export function postToMetricSample(
  post: ProductHuntPost,
  snapshotMs: number,
): MetricSample {
  const day = startOfUtcDay(snapshotMs);
  return metricSample(productHuntResources, POST_METRIC, {
    ts: day,
    value: counterValue(post.votesCount),
    attributes: {
      date: toIsoDate(day),
      postId: post.id,
      slug: post.slug,
      postName: post.name,
      votes: counterValue(post.votesCount),
      comments: counterValue(post.commentsCount),
      reviews: counterValue(post.reviewsCount),
      reviewsRating: nullableNumber(post.reviewsRating),
      dailyRank: nullableNumber(post.dailyRank),
      weeklyRank: nullableNumber(post.weeklyRank),
    },
  });
}

export const id = 'product-hunt';

export class ProductHuntConnector extends BaseConnector<
  ProductHuntSettings,
  ProductHuntCredentials
> {
  static readonly id = id;

  static readonly resources = productHuntResources;

  static readonly schemas = schemasFromResources(productHuntResources);

  static create(input: unknown, ctx?: ConnectorContext): ProductHuntConnector {
    const parsed = configFields.parse(input);
    return new ProductHuntConnector(
      {
        slugs: parsed.slugs,
        topic: parsed.topic,
        lookbackDays: parsed.lookbackDays,
        resources: parsed.resources,
      },
      { apiToken: parsed.apiToken },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = productHuntCredentials;

  private buildHeaders(): Record<string, string> {
    return {
      Accept: 'application/json',
      Authorization: `Bearer ${this.creds.apiToken}`,
      'Content-Type': 'application/json',
      'User-Agent': connectorUserAgent('product-hunt'),
    };
  }

  private async graphql<T>(
    query: string,
    variables: Record<string, unknown>,
    resource: string,
    signal?: AbortSignal,
  ): Promise<HttpResponse<GraphQLResponse<T>>> {
    const res = await this.post<GraphQLResponse<T>>(ENDPOINT, {
      resource,
      headers: this.buildHeaders(),
      body: JSON.stringify({ query, variables }),
      signal,
    });
    if (res.body.errors && res.body.errors.length > 0) {
      const messages = res.body.errors.map((e) => e.message).join('; ');
      throw new Error(`Product Hunt GraphQL error: ${messages}`);
    }
    if (!res.body.data) {
      throw new Error(
        `Product Hunt GraphQL response missing data for resource '${resource}'`,
      );
    }
    return res;
  }

  private postedAfter(options: SyncOptions, now: number): string {
    if (options.since) {
      const sinceMs = new Date(options.since).getTime();
      if (Number.isFinite(sinceMs)) {
        return new Date(sinceMs).toISOString();
      }
    }
    const lookbackDays = this.settings.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    return new Date(
      startOfUtcDay(now) - (lookbackDays - 1) * MS_PER_DAY,
    ).toISOString();
  }

  private async fetchPostsPage(
    page: string | null,
    options: SyncOptions,
    phase: ProductHuntPhase,
    now: number,
    signal?: AbortSignal,
  ): Promise<{ items: ProductHuntPost[]; next: string | null }> {
    const slugs = this.settings.slugs;
    if (slugs && slugs.length > 0) {
      const index = page === null ? 0 : Number(page);
      const cursor =
        Number.isFinite(index) && index >= 0 ? Math.floor(index) : 0;
      if (cursor >= slugs.length) {
        return { items: [], next: null };
      }
      const res = await this.graphql<PostPayload>(
        POST_BY_SLUG_QUERY,
        { slug: slugs[cursor] },
        phase === 'posts' ? 'post_by_slug' : 'post_metrics_by_slug',
        signal,
      );
      const post = res.body.data!.post;
      return {
        items: post ? [post] : [],
        next: cursor + 1 < slugs.length ? String(cursor + 1) : null,
      };
    }

    const res = await this.graphql<PostsPayload>(
      POSTS_QUERY,
      {
        first: clampPageSize(options.pageSize),
        after: page,
        postedAfter: this.postedAfter(options, now),
        topic: this.settings.topic ?? null,
      },
      phase,
      signal,
    );
    const { nodes, pageInfo } = res.body.data!.posts;
    return {
      items: nodes,
      next: pageInfo.hasNextPage ? (pageInfo.endCursor ?? null) : null,
    };
  }

  private async writePosts(
    storage: StorageHandle,
    posts: ProductHuntPost[],
  ): Promise<void> {
    for (const post of posts) {
      await storage.entity(postToEntity(post));
    }
  }

  private async writePostMetrics(
    storage: StorageHandle,
    posts: ProductHuntPost[],
    snapshotMs: number,
    replaceDay: boolean,
  ): Promise<void> {
    const samples = posts.map((post) => postToMetricSample(post, snapshotMs));
    const day = startOfUtcDay(snapshotMs);
    await storage.metrics(samples, {
      names: [POST_METRIC],
      ...(replaceDay
        ? { replaceWindow: { start: day, end: day + MS_PER_DAY - 1 } }
        : {}),
    });
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor: ProductHuntSyncCursor | undefined = isProductHuntSyncCursor(
      options.cursor,
    )
      ? options.cursor
      : undefined;
    const isFull = options.mode === 'full';
    const snapshotMs = Date.now();

    const phases = selectActivePhases<ProductHuntResource, ProductHuntPhase>(
      (r) => r,
      PHASE_ORDER,
      this.settings.resources,
    );

    return paginateChunked<ProductHuntPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      pipeline: true,
      maxChunkMs: CHUNK_BUDGET_MS,
      fetchPage: async (phase, page, sig) =>
        this.fetchPostsPage(page, options, phase, snapshotMs, sig),
      writeBatch: async (phase, items, page) => {
        const posts = items as ProductHuntPost[];
        switch (phase) {
          case 'posts':
            if (isFull && page === null) {
              await storage.entities([], { types: [POST_ENTITY] });
            }
            return this.writePosts(storage, posts);
          case 'post_metrics':
            return this.writePostMetrics(
              storage,
              posts,
              snapshotMs,
              page === null,
            );
        }
      },
    });
  }
}
