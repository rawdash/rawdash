import { describe, expect, it, vi } from 'vitest';

import {
  BaseConnector,
  type StorageHandle,
  type SyncOptions,
  type SyncResult,
  resolveBackfillCutoff,
  resolveSpecCutoff,
} from './connector';
import { EnvSecretsResolver, type SecretsResolver, secret } from './secrets';

class TestConnector extends BaseConnector<
  { foo: string },
  { TOKEN: { description: string; auth: 'required' } }
> {
  readonly id = 'test';
  override readonly credentials = {
    TOKEN: { description: 'token', auth: 'required' as const },
  };

  async sync(
    _options: SyncOptions,
    _storage: StorageHandle,
    _signal?: AbortSignal,
  ): Promise<SyncResult> {
    return { done: true };
  }

  getResolvedToken(): string {
    return this.creds.TOKEN;
  }
}

type NodeLike = { process?: { env?: Record<string, string | undefined> } };

function withEnv(name: string, value: string, fn: () => void): void {
  const g = globalThis as unknown as NodeLike;
  g.process ??= { env: {} };
  const prev = g.process.env![name];
  try {
    g.process.env![name] = value;
    fn();
  } finally {
    if (prev === undefined) {
      delete g.process.env![name];
    } else {
      g.process.env![name] = prev;
    }
  }
}

describe('BaseConnector secrets resolution', () => {
  it('uses ctx.secretsResolver when provided and does not consult EnvSecretsResolver', () => {
    const envResolveSpy = vi.spyOn(EnvSecretsResolver.prototype, 'resolve');

    const customResolver: SecretsResolver = {
      resolve: vi.fn((name: string) =>
        name === 'TOKEN' ? 'from-custom-resolver' : undefined,
      ),
    };

    const conn = new TestConnector(
      { foo: 'bar' },
      { TOKEN: secret('TOKEN') },
      { secretsResolver: customResolver },
    );

    expect(conn.getResolvedToken()).toBe('from-custom-resolver');
    expect(customResolver.resolve).toHaveBeenCalledWith('TOKEN');
    expect(envResolveSpy).not.toHaveBeenCalled();

    envResolveSpy.mockRestore();
  });

  it('falls back to EnvSecretsResolver when no ctx is provided', () => {
    withEnv('TOKEN_TEST_1', 'from-env', () => {
      const conn = new TestConnector(
        { foo: 'bar' },
        { TOKEN: secret('TOKEN_TEST_1') },
      );
      expect(conn.getResolvedToken()).toBe('from-env');
    });
  });

  it('falls back to EnvSecretsResolver when ctx has no secretsResolver', () => {
    withEnv('TOKEN_TEST_2', 'from-env-2', () => {
      const conn = new TestConnector(
        { foo: 'bar' },
        { TOKEN: secret('TOKEN_TEST_2') },
        {},
      );
      expect(conn.getResolvedToken()).toBe('from-env-2');
    });
  });
});

describe('resolveBackfillCutoff', () => {
  const now = Date.parse('2026-06-08T00:00:00Z');
  const day = 86_400_000;

  it('returns null when neither since nor window is set', () => {
    expect(resolveBackfillCutoff({}, 'workflow_run', now)).toBeNull();
  });

  it('returns the window cutoff when only a window is set', () => {
    expect(
      resolveBackfillCutoff(
        { requiredWindowMs: { workflow_run: 7 * day } },
        'workflow_run',
        now,
      ),
    ).toBe(now - 7 * day);
  });

  it('returns null for a resource without a configured window', () => {
    expect(
      resolveBackfillCutoff(
        { requiredWindowMs: { workflow_run: 7 * day } },
        'pull_request',
        now,
      ),
    ).toBeNull();
  });

  it('returns the since cutoff when only since is set', () => {
    const since = '2026-06-01T00:00:00Z';
    expect(resolveBackfillCutoff({ since }, 'workflow_run', now)).toBe(
      Date.parse(since),
    );
  });

  it('returns the more recent of since and the window cutoff', () => {
    const since = '2026-05-01T00:00:00Z';
    expect(
      resolveBackfillCutoff(
        { since, requiredWindowMs: { workflow_run: 7 * day } },
        'workflow_run',
        now,
      ),
    ).toBe(now - 7 * day);

    const recentSince = '2026-06-07T00:00:00Z';
    expect(
      resolveBackfillCutoff(
        { since: recentSince, requiredWindowMs: { workflow_run: 7 * day } },
        'workflow_run',
        now,
      ),
    ).toBe(Date.parse(recentSince));
  });
});

describe('resolveSpecCutoff', () => {
  const now = Date.parse('2026-06-08T00:00:00Z');
  const day = 86_400_000;

  it('returns null for an unbounded spec (no window)', () => {
    expect(resolveSpecCutoff(undefined, now)).toBeNull();
  });

  it('returns now minus the window for a bounded spec', () => {
    expect(resolveSpecCutoff(7 * day, now)).toBe(now - 7 * day);
  });
});
