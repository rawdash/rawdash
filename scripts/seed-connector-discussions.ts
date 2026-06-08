import { connectorPlaceholders } from './connector-placeholders';

const TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPOSITORY ?? 'rawdash/rawdash';
const CATEGORY = process.env.DISCUSSION_CATEGORY ?? 'Connector Requests';
const DRY_RUN = process.env.DRY_RUN === '1';
const [OWNER, NAME] = REPO.split('/');

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

async function gql<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`GitHub GraphQL HTTP ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as GraphQLResponse<T>;
  if (json.errors?.length) {
    throw new Error(
      `GitHub GraphQL errors: ${json.errors.map((e) => e.message).join('; ')}`,
    );
  }
  if (!json.data) {
    throw new Error('GitHub GraphQL returned no data');
  }
  return json.data;
}

async function getRepoAndCategory(): Promise<{
  repositoryId: string;
  categoryId: string;
}> {
  const data = await gql<{
    repository: {
      id: string;
      discussionCategories: { nodes: { id: string; name: string }[] };
    };
  }>(
    `query ($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        id
        discussionCategories(first: 50) { nodes { id name } }
      }
    }`,
    { owner: OWNER, name: NAME },
  );
  const category = data.repository.discussionCategories.nodes.find(
    (c) => c.name === CATEGORY,
  );
  if (!category) {
    throw new Error(
      `No "${CATEGORY}" discussion category in ${REPO}. Create it first ` +
        `(Discussions → Categories → New; Announcement format).`,
    );
  }
  return { repositoryId: data.repository.id, categoryId: category.id };
}

async function existingTitles(categoryId: string): Promise<Set<string>> {
  const titles = new Set<string>();
  let after: string | null = null;
  for (;;) {
    const data = await gql<{
      repository: {
        discussions: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: { title: string }[];
        };
      };
    }>(
      `query ($owner: String!, $name: String!, $categoryId: ID, $after: String) {
        repository(owner: $owner, name: $name) {
          discussions(first: 100, after: $after, categoryId: $categoryId) {
            pageInfo { hasNextPage endCursor }
            nodes { title }
          }
        }
      }`,
      { owner: OWNER, name: NAME, categoryId, after },
    );
    const { nodes, pageInfo } = data.repository.discussions;
    for (const node of nodes) {
      titles.add(node.title);
    }
    if (!pageInfo.hasNextPage) {
      break;
    }
    after = pageInfo.endCursor;
  }
  return titles;
}

function discussionBody(p: (typeof connectorPlaceholders)[number]): string {
  const docs = `https://rawdash.dev/docs/connectors/${p.category}/${p.id}/`;
  return (
    `**${p.name}** — ${p.tagline}\n\n` +
    `This connector isn't built yet. 👍 **Upvote this discussion** to help us prioritize it.\n\n` +
    `Docs / status: ${docs}\n\n` +
    `Want it sooner? rawdash connectors are typed resource-syncers — see the ` +
    `[connector author guide](https://rawdash.dev/docs/connector-guide/).`
  );
}

async function main(): Promise<void> {
  if (!TOKEN) {
    throw new Error('GITHUB_TOKEN is required.');
  }
  if (!OWNER || !NAME) {
    throw new Error(`Invalid GITHUB_REPOSITORY "${REPO}".`);
  }
  const { repositoryId, categoryId } = await getRepoAndCategory();
  const have = await existingTitles(categoryId);
  const missing = connectorPlaceholders.filter((p) => !have.has(p.id));
  console.log(
    `${connectorPlaceholders.length} placeholders, ${have.size} existing discussions, ${missing.length} to create.`,
  );
  let created = 0;
  for (const p of missing) {
    if (DRY_RUN) {
      console.log(`[dry-run] would create discussion "${p.id}" (${p.name}).`);
      continue;
    }
    if (created > 0) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    const data = await gql<{
      createDiscussion: { discussion: { id: string; url: string } };
    }>(
      `mutation ($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
        createDiscussion(input: { repositoryId: $repositoryId, categoryId: $categoryId, title: $title, body: $body }) {
          discussion { id url }
        }
      }`,
      {
        repositoryId,
        categoryId,
        title: p.id,
        body: discussionBody(p),
      },
    );
    await gql(
      `mutation ($subjectId: ID!) {
        removeUpvote(input: { subjectId: $subjectId }) {
          subject { ... on Discussion { upvoteCount } }
        }
      }`,
      { subjectId: data.createDiscussion.discussion.id },
    );
    created += 1;
    console.log(
      `Created discussion "${p.id}" (${p.name}): ${data.createDiscussion.discussion.url}`,
    );
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
