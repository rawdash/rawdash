/**
 * Build-time loader for connector upvote counts (RAW-361).
 *
 * Voting on a planned ("placeholder") connector uses GitHub Discussions' native
 * upvote button — the same model Airbyte uses for its "New Connector Request"
 * category. Each connector maps to one discussion in the "Connector Requests"
 * category whose title is the connector id; its `upvoteCount` is the vote tally.
 *
 * This module fetches every connector-request discussion once at build time and
 * exposes a `id -> { url, count }` map. Counts are baked into the static pages,
 * so there is no client-side JavaScript, no iframe, and no runtime backend; the
 * tally refreshes whenever the site is rebuilt.
 *
 * A read-only `GITHUB_TOKEN` must be present in the build env (GitHub's GraphQL
 * API requires authentication even for public data). Without it, the loader
 * returns an empty map and the upvote control degrades to a plain "Upvote on
 * GitHub" link with no count.
 */
const REPO = 'rawdash/rawdash';
const CATEGORY = 'Connector Requests';
// Server-side (build-time) only. Never read a PUBLIC_-prefixed token here: those
// are inlined into the client bundle, so a token fallback would risk leaking it.
const TOKEN = import.meta.env.GITHUB_TOKEN ?? '';

export interface ConnectorUpvote {
  /** URL of the backing discussion. */
  url: string;
  /** Native upvote count. */
  count: number;
}

interface DiscussionsPage {
  repository: {
    discussions: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: {
        title: string;
        url: string;
        upvoteCount: number;
        category: { name: string } | null;
      }[];
    };
  };
}

const QUERY = `query ($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    discussions(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { title url upvoteCount category { name } }
    }
  }
}`;

async function fetchAll(): Promise<Map<string, ConnectorUpvote>> {
  const map = new Map<string, ConnectorUpvote>();
  if (!TOKEN) {
    console.warn(
      '[connector-upvotes] No GITHUB_TOKEN in build env; rendering upvote links without counts.',
    );
    return map;
  }
  const [owner, name] = REPO.split('/');
  let after: string | null = null;
  try {
    for (;;) {
      const res = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: QUERY,
          variables: { owner, name, after },
        }),
      });
      if (!res.ok) {
        console.warn(
          `[connector-upvotes] GitHub GraphQL HTTP ${res.status}; rendering links without counts.`,
        );
        return map;
      }
      const json = (await res.json()) as {
        data?: DiscussionsPage;
        errors?: { message: string }[];
      };
      if (json.errors?.length || !json.data) {
        console.warn(
          `[connector-upvotes] GitHub GraphQL error: ${json.errors?.map((e) => e.message).join('; ') ?? 'no data'}.`,
        );
        return map;
      }
      const { nodes, pageInfo } = json.data.repository.discussions;
      for (const node of nodes) {
        if (node.category?.name === CATEGORY) {
          map.set(node.title, { url: node.url, count: node.upvoteCount });
        }
      }
      if (!pageInfo.hasNextPage) {
        break;
      }
      after = pageInfo.endCursor;
    }
  } catch (err) {
    // A network failure (DNS, reset, offline build) must not fail the build;
    // degrade to link-only, matching the no-token path.
    console.warn(
      `[connector-upvotes] GitHub GraphQL fetch failed (${String(err)}); rendering links without counts.`,
    );
    return map;
  }
  return map;
}

let cache: Promise<Map<string, ConnectorUpvote>> | null = null;

/** Memoized map of connector id -> upvote info, fetched once per build. */
export function getConnectorUpvotes(): Promise<Map<string, ConnectorUpvote>> {
  return (cache ??= fetchAll());
}

/** URL of the "Connector Requests" discussions category. */
export function discussionsCategoryUrl(): string {
  const slug = CATEGORY.toLowerCase().replace(/\s+/g, '-');
  return `https://github.com/${REPO}/discussions/categories/${slug}`;
}
