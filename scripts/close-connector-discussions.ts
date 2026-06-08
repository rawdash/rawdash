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

interface DiscussionNode {
  id: string;
  number: number;
  title: string;
  closed: boolean;
  url: string;
  category: { name: string };
}

async function findDiscussion(id: string): Promise<DiscussionNode | null> {
  const data = await gql<{
    search: { nodes: DiscussionNode[] };
  }>(
    `query ($q: String!) {
      search(type: DISCUSSION, query: $q, first: 25) {
        nodes {
          ... on Discussion {
            id
            number
            title
            closed
            url
            category { name }
          }
        }
      }
    }`,
    { q: `repo:${REPO} in:title "${id}"` },
  );
  const matches = data.search.nodes.filter(
    (n) => n && n.title === id && n.category?.name === CATEGORY && !n.closed,
  );
  return matches[0] ?? null;
}

async function closeDiscussion(d: DiscussionNode, id: string): Promise<void> {
  const docsUrl = `https://rawdash.dev/docs/connectors/`;
  const body =
    `🎉 The **${id}** connector has shipped — thanks to everyone who upvoted!\n\n` +
    `See the docs: ${docsUrl}\n\n` +
    `Closing this request as resolved.`;
  if (DRY_RUN) {
    console.log(`[dry-run] would comment + close #${d.number} (${d.url})`);
    return;
  }
  await gql(
    `mutation ($discussionId: ID!, $body: String!) {
      addDiscussionComment(input: { discussionId: $discussionId, body: $body }) {
        comment { id }
      }
    }`,
    { discussionId: d.id, body },
  );
  await gql(
    `mutation ($discussionId: ID!) {
      closeDiscussion(input: { discussionId: $discussionId, reason: RESOLVED }) {
        discussion { id closed }
      }
    }`,
    { discussionId: d.id },
  );
  console.log(`Closed discussion #${d.number} for "${id}" (${d.url}).`);
}

async function main(): Promise<void> {
  const ids = process.argv
    .slice(2)
    .flatMap((arg) => arg.split(/\s+/))
    .filter(Boolean);
  if (ids.length === 0) {
    console.log('No graduated connector ids passed; nothing to close.');
    return;
  }
  if (!TOKEN) {
    throw new Error('GITHUB_TOKEN is required.');
  }
  if (!OWNER || !NAME) {
    throw new Error(`Invalid GITHUB_REPOSITORY "${REPO}".`);
  }
  console.log(
    `Checking ${ids.length} graduated connector(s) against "${CATEGORY}" discussions in ${REPO}: ${ids.join(', ')}`,
  );
  for (const id of ids) {
    const discussion = await findDiscussion(id);
    if (!discussion) {
      console.log(`No open "${CATEGORY}" discussion titled "${id}"; skipping.`);
      continue;
    }
    await closeDiscussion(discussion, id);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
