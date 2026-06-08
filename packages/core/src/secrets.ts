import { z } from 'zod';

export type Secret = { $secret: string };
export type SecretRef = Secret;

export function secret(name: string): Secret {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
    throw new Error(
      `Invalid secret name "${name}". Must match /^[A-Z][A-Z0-9_]*$/ ` +
        `(uppercase letters, digits, underscores; must start with a letter).`,
    );
  }
  return { $secret: name };
}

export function isSecret(value: unknown): value is Secret {
  return (
    typeof value === 'object' &&
    value !== null &&
    '$secret' in value &&
    typeof (value as Secret).$secret === 'string'
  );
}

export const secretRefSchema: z.ZodType<SecretRef> = z.strictObject({
  $secret: z.string(),
});

export function withSecretRef<T extends z.ZodTypeAny>(
  schema: T,
): z.ZodUnion<[T, z.ZodType<SecretRef>]> {
  return z.union([schema, secretRefSchema]);
}

export interface SecretsResolver {
  resolve(name: string): unknown;
}

export class EnvSecretsResolver implements SecretsResolver {
  resolve(name: string): unknown {
    const env = (
      globalThis as { process?: { env?: Record<string, string | undefined> } }
    ).process?.env;
    const raw = env?.[name];
    if (raw === undefined) {
      return undefined;
    }
    if (raw.length === 0) {
      return raw;
    }
    const first = raw.charCodeAt(0);
    if (first !== 0x7b && first !== 0x5b) {
      return raw;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
}

export function extractSecretNames(value: unknown): string[] {
  const names: string[] = [];
  const visit = (v: unknown): void => {
    if (isSecret(v)) {
      names.push(v.$secret);
      return;
    }
    if (v && typeof v === 'object') {
      if (Array.isArray(v)) {
        v.forEach(visit);
      } else {
        Object.values(v as Record<string, unknown>).forEach(visit);
      }
    }
  };
  visit(value);
  return [...new Set(names)];
}

export function resolveSecrets<T>(obj: T, resolver: SecretsResolver): T {
  if (isSecret(obj)) {
    const name = obj.$secret;
    const value = resolver.resolve(name);
    if (value === undefined) {
      throw new Error(
        `Missing secret "${name}". Set it via process.env.${name} or the CLI: rawdash secrets set ${name} ...`,
      );
    }
    return value as unknown as T;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => resolveSecrets(item, resolver)) as unknown as T;
  }
  if (typeof obj === 'object' && obj !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj as object)) {
      Object.defineProperty(result, key, {
        value: resolveSecrets(val, resolver),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return result as T;
  }
  return obj;
}
