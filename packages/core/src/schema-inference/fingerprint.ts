import type { Schema } from './types';

export function canonicalize(schema: Schema): unknown {
  if (schema.type === 'union') {
    const members = schema.anyOf.map(canonicalize);
    const sorted = sortBySerialized(members);
    return { anyOf: sorted, type: 'union' };
  }
  if (schema.type === 'string') {
    if (schema.freeform) {
      return { freeform: true, type: 'string' };
    }
    return { type: 'string' };
  }
  if (schema.type === 'object') {
    const keys = Object.keys(schema.properties).sort();
    const props: Record<string, unknown> = {};
    for (const k of keys) {
      props[k] = canonicalize(schema.properties[k] as Schema);
    }
    return {
      properties: props,
      required: [...schema.required].sort(),
      type: 'object',
    };
  }
  if (schema.type === 'array') {
    if (schema.items === undefined) {
      return { type: 'array' };
    }
    return { items: canonicalize(schema.items), type: 'array' };
  }
  return { type: schema.type };
}

function sortBySerialized(items: unknown[]): unknown[] {
  return items
    .map((m) => ({ key: stableStringify(m), value: m }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((m) => m.value);
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k]))
      .join(',') +
    '}'
  );
}

export async function fingerprint(schema: Schema): Promise<string> {
  const canonical = canonicalize(schema);
  const serialized = stableStringify(canonical);
  const bytes = new TextEncoder().encode(serialized);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return bytesToHex(new Uint8Array(digest));
}

function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += (bytes[i] as number).toString(16).padStart(2, '0');
  }
  return s;
}
