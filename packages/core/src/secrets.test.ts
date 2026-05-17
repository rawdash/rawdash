import { describe, expect, it } from 'vitest';

import {
  EnvSecretsResolver,
  extractSecretNames,
  isSecret,
  resolveSecrets,
  secret,
} from './secrets';

describe('secret()', () => {
  it('returns a Secret for valid names', () => {
    expect(secret('GITHUB_TOKEN')).toEqual({ $secret: 'GITHUB_TOKEN' });
    expect(secret('MY_API_KEY_2')).toEqual({ $secret: 'MY_API_KEY_2' });
    expect(secret('A')).toEqual({ $secret: 'A' });
  });

  it('throws for lowercase names', () => {
    expect(() => secret('github_token')).toThrow(/Invalid secret name/);
  });

  it('throws for names starting with a digit', () => {
    expect(() => secret('1_TOKEN')).toThrow(/Invalid secret name/);
  });

  it('throws for names with spaces', () => {
    expect(() => secret('MY TOKEN')).toThrow(/Invalid secret name/);
  });

  it('throws for empty string', () => {
    expect(() => secret('')).toThrow(/Invalid secret name/);
  });
});

describe('isSecret()', () => {
  it('returns true for Secret objects', () => {
    expect(isSecret({ $secret: 'FOO' })).toBe(true);
  });

  it('returns false for plain strings', () => {
    expect(isSecret('FOO')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isSecret(null)).toBe(false);
  });

  it('returns false for objects without $secret', () => {
    expect(isSecret({ foo: 'bar' })).toBe(false);
  });

  it('returns false for objects with non-string $secret', () => {
    expect(isSecret({ $secret: 42 })).toBe(false);
  });
});

describe('resolveSecrets()', () => {
  const resolver: EnvSecretsResolver = {
    resolve: (name: string) =>
      name === 'MY_TOKEN' ? 'secret-value' : undefined,
  };

  it('resolves a top-level Secret', () => {
    expect(resolveSecrets(secret('MY_TOKEN'), resolver)).toBe('secret-value');
  });

  it('resolves Secrets inside an object', () => {
    const input = { token: secret('MY_TOKEN'), owner: 'acme' };
    expect(resolveSecrets(input, resolver)).toEqual({
      token: 'secret-value',
      owner: 'acme',
    });
  });

  it('resolves Secrets inside arrays', () => {
    const input = [secret('MY_TOKEN'), 'plain'];
    expect(resolveSecrets(input, resolver)).toEqual(['secret-value', 'plain']);
  });

  it('passes through undefined values unchanged', () => {
    const input = { token: undefined };
    expect(resolveSecrets(input, resolver)).toEqual({ token: undefined });
  });

  it('throws a clear error for missing secrets', () => {
    expect(() => resolveSecrets(secret('MISSING_KEY'), resolver)).toThrow(
      /Missing secret "MISSING_KEY"/,
    );
  });
});

describe('extractSecretNames()', () => {
  it('returns an empty array when no secrets are present', () => {
    expect(extractSecretNames({ foo: 'bar', n: 1, arr: [1, 'two'] })).toEqual(
      [],
    );
    expect(extractSecretNames(null)).toEqual([]);
    expect(extractSecretNames(undefined)).toEqual([]);
    expect(extractSecretNames('plain')).toEqual([]);
  });

  it('extracts a top-level Secret', () => {
    expect(extractSecretNames(secret('MY_TOKEN'))).toEqual(['MY_TOKEN']);
  });

  it('extracts Secrets from nested objects and arrays', () => {
    const config = {
      a: secret('A_TOKEN'),
      nested: {
        b: secret('B_TOKEN'),
        deep: { c: secret('C_TOKEN') },
      },
      list: [secret('D_TOKEN'), { e: secret('E_TOKEN') }, 'plain'],
    };
    expect(extractSecretNames(config).sort()).toEqual([
      'A_TOKEN',
      'B_TOKEN',
      'C_TOKEN',
      'D_TOKEN',
      'E_TOKEN',
    ]);
  });

  it('dedupes repeated secret names', () => {
    const config = {
      a: secret('SHARED'),
      b: secret('SHARED'),
      list: [secret('SHARED'), secret('OTHER')],
    };
    expect(extractSecretNames(config).sort()).toEqual(['OTHER', 'SHARED']);
  });

  it('does not descend into a Secret marker', () => {
    const fake = { $secret: 'OUTER', nested: secret('INNER') } as unknown;
    expect(extractSecretNames(fake)).toEqual(['OUTER']);
  });
});

type NodeLike = { process?: { env?: Record<string, string | undefined> } };

describe('EnvSecretsResolver', () => {
  it('reads from process.env', () => {
    const resolver = new EnvSecretsResolver();
    const g = globalThis as unknown as NodeLike;
    g.process ??= { env: {} };
    const prev = g.process.env!['__TEST_SECRET__'];
    try {
      g.process.env!['__TEST_SECRET__'] = 'test-value';
      expect(resolver.resolve('__TEST_SECRET__')).toBe('test-value');
    } finally {
      if (prev === undefined) {
        delete g.process.env!['__TEST_SECRET__'];
      } else {
        g.process.env!['__TEST_SECRET__'] = prev;
      }
    }
  });

  it('returns undefined for missing keys', () => {
    const resolver = new EnvSecretsResolver();
    expect(resolver.resolve('__DEFINITELY_NOT_SET__')).toBeUndefined();
  });
});
