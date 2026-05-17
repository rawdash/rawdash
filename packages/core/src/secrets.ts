export type Secret = { $secret: string };

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

export interface SecretsResolver {
  resolve(name: string): string | undefined;
}

export class EnvSecretsResolver implements SecretsResolver {
  resolve(name: string): string | undefined {
    const env = (
      globalThis as { process?: { env?: Record<string, string | undefined> } }
    ).process?.env;
    return env?.[name];
  }
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
