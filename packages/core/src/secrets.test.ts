import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  EnvSecretsResolver,
  extractSecretNames,
  isSecret,
  resolveSecrets,
  secret,
  withSecretRef,
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
  const withEnv = <T>(
    name: string,
    value: string | undefined,
    fn: () => T,
  ): T => {
    const g = globalThis as unknown as NodeLike;
    g.process ??= { env: {} };
    const prev = g.process.env![name];
    try {
      if (value === undefined) {
        delete g.process.env![name];
      } else {
        g.process.env![name] = value;
      }
      return fn();
    } finally {
      if (prev === undefined) {
        delete g.process.env![name];
      } else {
        g.process.env![name] = prev;
      }
    }
  };

  it('reads a plain string from process.env', () => {
    const resolver = new EnvSecretsResolver();
    withEnv('__TEST_SECRET__', 'test-value', () => {
      expect(resolver.resolve('__TEST_SECRET__')).toBe('test-value');
    });
  });

  it('returns undefined for missing keys', () => {
    const resolver = new EnvSecretsResolver();
    expect(resolver.resolve('__DEFINITELY_NOT_SET__')).toBeUndefined();
  });

  it('parses a JSON object env var into an object', () => {
    const resolver = new EnvSecretsResolver();
    withEnv(
      '__TEST_OBJ__',
      '{"type":"role","roleArn":"arn:aws:iam::1:role/x","externalId":"abc"}',
      () => {
        expect(resolver.resolve('__TEST_OBJ__')).toEqual({
          type: 'role',
          roleArn: 'arn:aws:iam::1:role/x',
          externalId: 'abc',
        });
      },
    );
  });

  it('parses a JSON array env var into an array', () => {
    const resolver = new EnvSecretsResolver();
    withEnv('__TEST_ARR__', '[1,2,3]', () => {
      expect(resolver.resolve('__TEST_ARR__')).toEqual([1, 2, 3]);
    });
  });

  it('falls back to the raw string when a value starting with { is not valid JSON', () => {
    const resolver = new EnvSecretsResolver();
    withEnv('__TEST_BAD__', '{not json', () => {
      expect(resolver.resolve('__TEST_BAD__')).toBe('{not json');
    });
  });

  it('returns the empty string for an empty env var without attempting parse', () => {
    const resolver = new EnvSecretsResolver();
    withEnv('__TEST_EMPTY__', '', () => {
      expect(resolver.resolve('__TEST_EMPTY__')).toBe('');
    });
  });

  it('does not attempt to parse strings that do not start with { or [', () => {
    const resolver = new EnvSecretsResolver();
    withEnv('__TEST_PAT__', 'ghp_abc123', () => {
      expect(resolver.resolve('__TEST_PAT__')).toBe('ghp_abc123');
    });
  });
});

describe('withSecretRef()', () => {
  it('accepts the resolved value shape (string)', () => {
    const schema = withSecretRef(z.string());
    expect(schema.parse('plain-token')).toBe('plain-token');
  });

  it('accepts the resolved value shape (object)', () => {
    const schema = withSecretRef(
      z.object({
        type: z.literal('role'),
        roleArn: z.string(),
        externalId: z.string(),
      }),
    );
    const value = { type: 'role' as const, roleArn: 'arn:x', externalId: 'y' };
    expect(schema.parse(value)).toEqual(value);
  });

  it('accepts a $secret reference', () => {
    const schema = withSecretRef(z.string());
    expect(schema.parse({ $secret: 'MY_TOKEN' })).toEqual({
      $secret: 'MY_TOKEN',
    });
  });

  it('rejects a malformed $secret reference (non-string name)', () => {
    const schema = withSecretRef(z.string());
    expect(() => schema.parse({ $secret: 42 })).toThrow();
  });

  it('rejects unrelated shapes', () => {
    const schema = withSecretRef(z.string());
    expect(() => schema.parse(123)).toThrow();
    expect(() => schema.parse({ foo: 'bar' })).toThrow();
  });
});
