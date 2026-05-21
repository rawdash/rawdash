import { describe, expect, it, vi } from 'vitest';

import {
  BaseConnector,
  type StorageHandle,
  type SyncOptions,
  type SyncResult,
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
