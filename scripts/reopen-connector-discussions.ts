const TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPOSITORY ?? 'rawdash/rawdash';
const CATEGORY = process.env.DISCUSSION_CATEGORY ?? 'Connector Requests';
const DRY_RUN = process.env.DRY_RUN === '1';
const [OWNER, NAME] = REPO.split('/');

const CLOSE_COMMENT_MARKER =
  'connector has shipped — thanks to everyone who upvoted';

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

interface DiscussionComment {
  id: string;
  body: string;
}

interface DiscussionNode {
  id: string;
  number: number;
  title: string;
  closed: boolean;
  url: string;
  category: { name: string };
  comments: { nodes: DiscussionComment[] };
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
            comments(last: 50) { nodes { id body } }
          }
        }
      }
    }`,
    { q: `repo:${REPO} in:title "${id}"` },
  );
  const matches = data.search.nodes.filter(
    (n) => n && n.title === id && n.category?.name === CATEGORY,
  );
  return matches[0] ?? null;
}

async function deleteCloseComments(
  d: DiscussionNode,
  id: string,
): Promise<number> {
  const wrong = d.comments.nodes.filter((c) =>
    c.body.includes(CLOSE_COMMENT_MARKER),
  );
  if (wrong.length === 0) {
    console.log(`  no close-comment found on #${d.number} for "${id}".`);
    return 0;
  }
  for (const c of wrong) {
    if (DRY_RUN) {
      console.log(`  [dry-run] would delete comment ${c.id} on #${d.number}`);
      continue;
    }
    await gql(
      `mutation ($id: ID!) {
        deleteDiscussionComment(input: { id: $id }) { clientMutationId }
      }`,
      { id: c.id },
    );
  }
  return wrong.length;
}

async function reopenDiscussion(d: DiscussionNode): Promise<void> {
  if (DRY_RUN) {
    console.log(`  [dry-run] would reopen #${d.number} (${d.url})`);
    return;
  }
  await gql(
    `mutation ($discussionId: ID!) {
      reopenDiscussion(input: { discussionId: $discussionId }) {
        discussion { id closed }
      }
    }`,
    { discussionId: d.id },
  );
}

async function main(): Promise<void> {
  const ids = process.argv
    .slice(2)
    .flatMap((arg) => arg.split(/\s+/))
    .filter(Boolean);
  if (ids.length === 0) {
    console.log('No connector ids passed; nothing to reopen.');
    return;
  }
  if (!TOKEN) {
    throw new Error('GITHUB_TOKEN is required.');
  }
  if (!OWNER || !NAME) {
    throw new Error(`Invalid GITHUB_REPOSITORY "${REPO}".`);
  }
  console.log(
    `Reopening ${ids.length} discussion(s) in "${CATEGORY}" of ${REPO}: ${ids.join(', ')}`,
  );
  for (const id of ids) {
    const discussion = await findDiscussion(id);
    if (!discussion) {
      console.log(`No "${CATEGORY}" discussion titled "${id}"; skipping.`);
      continue;
    }
    const deleted = await deleteCloseComments(discussion, id);
    if (discussion.closed) {
      await reopenDiscussion(discussion);
      console.log(
        `Reopened #${discussion.number} for "${id}" (deleted ${deleted} stale close-comment${deleted === 1 ? '' : 's'}).`,
      );
    } else {
      console.log(
        `#${discussion.number} for "${id}" already open (deleted ${deleted} stale close-comment${deleted === 1 ? '' : 's'}).`,
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
