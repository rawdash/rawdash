export type SecretRef = { $secret: string };

export function secret(name: string): SecretRef {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
    throw new Error(
      `Invalid secret name "${name}". Must match /^[A-Z][A-Z0-9_]*$/ ` +
        `(uppercase letters, digits, underscores; must start with a letter).`,
    );
  }
  return { $secret: name };
}

export function isSecretRef(value: unknown): value is SecretRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    '$secret' in value &&
    typeof (value as SecretRef).$secret === 'string'
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

export function resolveSecretRefs<T>(obj: T, resolver: SecretsResolver): T {
  if (isSecretRef(obj)) {
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
    return obj.map((item) => resolveSecretRefs(item, resolver)) as unknown as T;
  }
  if (typeof obj === 'object' && obj !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj as object)) {
      result[key] = resolveSecretRefs(val, resolver);
    }
    return result as T;
  }
  return obj;
}
