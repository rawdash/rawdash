const REPO = 'rawdash/rawdash';
const CATEGORY = 'Connector Requests';
const TOKEN = import.meta.env.GITHUB_TOKEN ?? '';

export interface ConnectorUpvote {
  url: string;
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
    console.warn(
      `[connector-upvotes] GitHub GraphQL fetch failed (${String(err)}); rendering links without counts.`,
    );
    return map;
  }
  return map;
}

let cache: Promise<Map<string, ConnectorUpvote>> | null = null;

export function getConnectorUpvotes(): Promise<Map<string, ConnectorUpvote>> {
  return (cache ??= fetchAll());
}

export function discussionsCategoryUrl(): string {
  const slug = CATEGORY.toLowerCase().replace(/\s+/g, '-');
  return `https://github.com/${REPO}/discussions/categories/${slug}`;
}
