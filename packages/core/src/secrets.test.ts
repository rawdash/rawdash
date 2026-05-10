import { describe, expect, it } from 'vitest';

import {
  EnvSecretsResolver,
  isSecretRef,
  resolveSecretRefs,
  secret,
} from './secrets';

describe('secret()', () => {
  it('returns a SecretRef for valid names', () => {
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

describe('isSecretRef()', () => {
  it('returns true for SecretRef objects', () => {
    expect(isSecretRef({ $secret: 'FOO' })).toBe(true);
  });

  it('returns false for plain strings', () => {
    expect(isSecretRef('FOO')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isSecretRef(null)).toBe(false);
  });

  it('returns false for objects without $secret', () => {
    expect(isSecretRef({ foo: 'bar' })).toBe(false);
  });

  it('returns false for objects with non-string $secret', () => {
    expect(isSecretRef({ $secret: 42 })).toBe(false);
  });
});

describe('resolveSecretRefs()', () => {
  const resolver: EnvSecretsResolver = {
    resolve: (name: string) =>
      name === 'MY_TOKEN' ? 'secret-value' : undefined,
  };

  it('resolves a top-level SecretRef', () => {
    expect(resolveSecretRefs(secret('MY_TOKEN'), resolver)).toBe(
      'secret-value',
    );
  });

  it('resolves SecretRefs inside an object', () => {
    const input = { token: secret('MY_TOKEN'), owner: 'acme' };
    expect(resolveSecretRefs(input, resolver)).toEqual({
      token: 'secret-value',
      owner: 'acme',
    });
  });

  it('resolves SecretRefs inside arrays', () => {
    const input = [secret('MY_TOKEN'), 'plain'];
    expect(resolveSecretRefs(input, resolver)).toEqual([
      'secret-value',
      'plain',
    ]);
  });

  it('passes through undefined values unchanged', () => {
    const input = { token: undefined };
    expect(resolveSecretRefs(input, resolver)).toEqual({ token: undefined });
  });

  it('throws a clear error for missing secrets', () => {
    expect(() => resolveSecretRefs(secret('MISSING_KEY'), resolver)).toThrow(
      /Missing secret "MISSING_KEY"/,
    );
  });
});

type NodeLike = { process?: { env?: Record<string, string | undefined> } };

describe('EnvSecretsResolver', () => {
  it('reads from process.env', () => {
    const resolver = new EnvSecretsResolver();
    const g = globalThis as unknown as NodeLike;
    g.process ??= { env: {} };
    g.process.env!['__TEST_SECRET__'] = 'test-value';
    expect(resolver.resolve('__TEST_SECRET__')).toBe('test-value');
    delete g.process.env!['__TEST_SECRET__'];
  });

  it('returns undefined for missing keys', () => {
    const resolver = new EnvSecretsResolver();
    expect(resolver.resolve('__DEFINITELY_NOT_SET__')).toBeUndefined();
  });
});
