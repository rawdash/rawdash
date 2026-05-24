import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GitHubConnector } from './github';

function mockJson(
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json', ...headers }),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

describe('GitHubConnector — aggregate', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('count via search API', () => {
    it('count(pull_request, state=open) hits search API with is:pr is:open', async () => {
      fetchSpy.mockResolvedValue(mockJson({ total_count: 194 }));
      const connector = new GitHubConnector({ owner: 'o', repo: 'r' });
      const value = await connector.aggregate({
        fn: 'count',
        resource: 'pull_request',
        filter: [{ field: 'state', op: 'eq', value: 'open' }],
      });
      expect(value).toBe(194);
      const url = String(fetchSpy.mock.calls[0]![0]);
      expect(url).toContain('/search/issues');
      const q = decodeURIComponent(url.split('q=')[1]!);
      expect(q).toBe('repo:o/r is:pr is:open');
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining('via="search API"'),
      );
    });

    it('count(issue, state=closed) translates to is:issue is:closed', async () => {
      fetchSpy.mockResolvedValue(mockJson({ total_count: 3 }));
      const connector = new GitHubConnector({ owner: 'o', repo: 'r' });
      await connector.aggregate({
        fn: 'count',
        resource: 'issue',
        filter: [{ field: 'state', op: 'eq', value: 'closed' }],
      });
      const q = decodeURIComponent(
        String(fetchSpy.mock.calls[0]![0]).split('q=')[1]!,
      );
      expect(q).toBe('repo:o/r is:issue is:closed');
    });

    it('supports label, author, assignee, milestone, draft, head, base', async () => {
      fetchSpy.mockResolvedValue(mockJson({ total_count: 0 }));
      const connector = new GitHubConnector({ owner: 'o', repo: 'r' });
      await connector.aggregate({
        fn: 'count',
        resource: 'pull_request',
        filter: [
          { field: 'label', op: 'eq', value: 'bug' },
          { field: 'author', op: 'eq', value: 'alice' },
          { field: 'assignee', op: 'eq', value: 'bob' },
          { field: 'milestone', op: 'eq', value: 'v1 release' },
          { field: 'draft', op: 'eq', value: true },
          { field: 'head', op: 'eq', value: 'feat-x' },
          { field: 'base', op: 'eq', value: 'main' },
        ],
      });
      const q = decodeURIComponent(
        String(fetchSpy.mock.calls[0]![0]).split('q=')[1]!,
      );
      expect(q).toBe(
        'repo:o/r is:pr label:bug author:alice assignee:bob milestone:"v1 release" is:draft head:feat-x base:main',
      );
    });

    it('rejects unsupported filter ops', async () => {
      const connector = new GitHubConnector({ owner: 'o', repo: 'r' });
      await expect(
        connector.aggregate({
          fn: 'count',
          resource: 'pull_request',
          filter: [{ field: 'state', op: 'gt', value: 'open' }],
        }),
      ).rejects.toThrow(/unsupported filter op gt/);
    });

    it('rejects OR filters (search would silently AND them)', async () => {
      const connector = new GitHubConnector({ owner: 'o', repo: 'r' });
      await expect(
        connector.aggregate({
          fn: 'count',
          resource: 'pull_request',
          filter: [
            {
              or: [
                { field: 'state', op: 'eq', value: 'open' },
                { field: 'state', op: 'eq', value: 'closed' },
              ],
            },
          ],
        }),
      ).rejects.toThrow(/OR filters are not supported/);
    });

    it('rejects unknown filter fields', async () => {
      const connector = new GitHubConnector({ owner: 'o', repo: 'r' });
      await expect(
        connector.aggregate({
          fn: 'count',
          resource: 'issue',
          filter: [{ field: 'whatever', op: 'eq', value: 'x' }],
        }),
      ).rejects.toThrow(/unsupported filter field whatever/);
    });

    it('count(contributor) parses Link rel="last" page number', async () => {
      fetchSpy.mockResolvedValue(
        mockJson([{}], {
          link: '<https://api.github.com/repositories/1/contributors?per_page=1&anon=true&page=2>; rel="next", <https://api.github.com/repositories/1/contributors?per_page=1&anon=true&page=42>; rel="last"',
        }),
      );
      const connector = new GitHubConnector({ owner: 'o', repo: 'r' });
      const value = await connector.aggregate({
        fn: 'count',
        resource: 'contributor',
      });
      expect(value).toBe(42);
    });

    it('count(contributor) rejects filters (none supported)', async () => {
      const connector = new GitHubConnector({ owner: 'o', repo: 'r' });
      await expect(
        connector.aggregate({
          fn: 'count',
          resource: 'contributor',
          filter: [{ field: 'login', op: 'eq', value: 'x' }],
        }),
      ).rejects.toThrow(/filters are not supported/);
    });
  });

  describe('latest via direct endpoints', () => {
    it('latest(repo, stars)', async () => {
      fetchSpy.mockResolvedValue(
        mockJson({
          stargazers_count: 99,
          forks_count: 7,
          subscribers_count: 3,
        }),
      );
      const connector = new GitHubConnector({ owner: 'o', repo: 'r' });
      const value = await connector.aggregate({
        fn: 'latest',
        resource: 'repo',
        field: 'stars',
      });
      expect(value).toBe(99);
      expect(String(fetchSpy.mock.calls[0]![0])).toBe(
        'https://api.github.com/repos/o/r',
      );
    });

    it('latest(workflow_run, conclusion) hits actions/runs?per_page=1', async () => {
      fetchSpy.mockResolvedValue(
        mockJson({
          workflow_runs: [
            {
              id: 1,
              name: 'CI',
              conclusion: 'success',
              status: 'completed',
              head_branch: 'main',
              actor: { login: 'alice' },
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-01T00:00:00Z',
              run_attempt: 1,
            },
          ],
        }),
      );
      const connector = new GitHubConnector({ owner: 'o', repo: 'r' });
      const value = await connector.aggregate({
        fn: 'latest',
        resource: 'workflow_run',
        field: 'conclusion',
      });
      expect(value).toBe('success');
      expect(String(fetchSpy.mock.calls[0]![0])).toBe(
        'https://api.github.com/repos/o/r/actions/runs?per_page=1',
      );
    });

    it('latest(release, tag_name) hits releases/latest', async () => {
      fetchSpy.mockResolvedValue(
        mockJson({
          id: 1,
          tag_name: 'v1.2.3',
          name: 'v1.2.3',
          draft: false,
          prerelease: false,
          created_at: '2026-01-01T00:00:00Z',
          published_at: '2026-01-01T00:00:00Z',
          author: { login: 'alice' },
        }),
      );
      const connector = new GitHubConnector({ owner: 'o', repo: 'r' });
      const value = await connector.aggregate({
        fn: 'latest',
        resource: 'release',
        field: 'tag_name',
      });
      expect(value).toBe('v1.2.3');
      expect(String(fetchSpy.mock.calls[0]![0])).toBe(
        'https://api.github.com/repos/o/r/releases/latest',
      );
    });

    it('latest(release) without field is unsupported', async () => {
      const connector = new GitHubConnector({ owner: 'o', repo: 'r' });
      await expect(
        connector.aggregate({ fn: 'latest', resource: 'release' }),
      ).rejects.toThrow(/unsupported latest for resource=release/);
    });

    it('count(repo) is rejected — repo only supports latest', async () => {
      const connector = new GitHubConnector({ owner: 'o', repo: 'r' });
      await expect(
        connector.aggregate({ fn: 'count', resource: 'repo' }),
      ).rejects.toThrow(/unsupported count for resource=repo/);
    });

    it('count(workflow_run) is rejected — workflow_run only supports latest', async () => {
      const connector = new GitHubConnector({ owner: 'o', repo: 'r' });
      await expect(
        connector.aggregate({ fn: 'count', resource: 'workflow_run' }),
      ).rejects.toThrow(/unsupported count for resource=workflow_run/);
    });
  });

  describe('validateCountFilter', () => {
    it('accepts supported filter combos without making API calls', () => {
      const connector = new GitHubConnector({ owner: 'o', repo: 'r' });
      expect(() =>
        connector.validateCountFilter('pull_request', [
          { field: 'state', op: 'eq', value: 'open' },
          { field: 'author', op: 'eq', value: 'alice' },
        ]),
      ).not.toThrow();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('rejects unsupported field', () => {
      const connector = new GitHubConnector({ owner: 'o', repo: 'r' });
      expect(() =>
        connector.validateCountFilter('issue', [
          { field: 'wat', op: 'eq', value: 'x' },
        ]),
      ).toThrow(/unsupported filter field wat/);
    });

    it('rejects unsupported resource', () => {
      const connector = new GitHubConnector({ owner: 'o', repo: 'r' });
      expect(() => connector.validateCountFilter('release', [])).toThrow(
        /unsupported resource=release/,
      );
    });

    it('rejects contributor with any filter', () => {
      const connector = new GitHubConnector({ owner: 'o', repo: 'r' });
      expect(() =>
        connector.validateCountFilter('contributor', [
          { field: 'login', op: 'eq', value: 'x' },
        ]),
      ).toThrow(/filters are not supported/);
    });
  });
});
