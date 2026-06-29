import type { DiffEntry, Schema } from './types';

export function diff(baseline: Schema, observed: Schema): DiffEntry[] {
  const entries: DiffEntry[] = [];
  walk('$', baseline, observed, entries);
  return entries;
}

function walk(
  path: string,
  baseline: Schema,
  observed: Schema,
  entries: DiffEntry[],
): void {
  const bKind = kindOf(baseline);
  const oKind = kindOf(observed);
  if (bKind !== oKind) {
    entries.push({
      path,
      kind: 'type-change',
      detail: { from: bKind, to: oKind },
    });
    return;
  }
  if (baseline.type === 'union' && observed.type === 'union') {
    for (const b of baseline.anyOf) {
      const o = observed.anyOf.find((m) => m.type === b.type);
      if (o) {
        walk(path, b, o, entries);
      }
    }
    return;
  }
  if (baseline.type !== 'union' && observed.type !== 'union') {
    if (baseline.type === 'object' && observed.type === 'object') {
      walkObject(path, baseline, observed, entries);
      return;
    }
    if (baseline.type === 'array' && observed.type === 'array') {
      if (baseline.items !== undefined && observed.items !== undefined) {
        walk(`${path}[*]`, baseline.items, observed.items, entries);
      }
      return;
    }
    if (baseline.type === 'string' && observed.type === 'string') {
      walkEnums(
        path,
        baseline.enum,
        observed.enum,
        baseline.freeform,
        observed.freeform,
        entries,
      );
      return;
    }
  }
}

function walkObject(
  path: string,
  baseline: Extract<Schema, { type: 'object' }>,
  observed: Extract<Schema, { type: 'object' }>,
  entries: DiffEntry[],
): void {
  const baseReq = new Set(baseline.required);
  const obsReq = new Set(observed.required);
  const baseKeys = new Set(Object.keys(baseline.properties));
  const obsKeys = new Set(Object.keys(observed.properties));

  for (const k of baseKeys) {
    const childPath = joinPath(path, k);
    if (!obsKeys.has(k)) {
      entries.push({ path: childPath, kind: 'removed-field', detail: {} });
      continue;
    }
    if (baseReq.has(k) && !obsReq.has(k)) {
      entries.push({
        path: childPath,
        kind: 'required-became-optional',
        detail: {},
      });
    } else if (!baseReq.has(k) && obsReq.has(k)) {
      entries.push({
        path: childPath,
        kind: 'optional-became-required',
        detail: {},
      });
    }
    walk(
      childPath,
      baseline.properties[k] as Schema,
      observed.properties[k] as Schema,
      entries,
    );
  }
  for (const k of obsKeys) {
    if (baseKeys.has(k)) {
      continue;
    }
    entries.push({
      path: joinPath(path, k),
      kind: 'new-field',
      detail: { required: obsReq.has(k) },
    });
  }
}

function walkEnums(
  path: string,
  baseEnum: string[] | undefined,
  obsEnum: string[] | undefined,
  baseFreeform: boolean | undefined,
  obsFreeform: boolean | undefined,
  entries: DiffEntry[],
): void {
  if (baseFreeform || !baseEnum) {
    return;
  }
  if (obsFreeform || !obsEnum) {
    return;
  }
  const baseSet = new Set(baseEnum);
  const added: string[] = [];
  for (const v of obsEnum) {
    if (!baseSet.has(v)) {
      added.push(v);
    }
  }
  if (added.length > 0) {
    entries.push({
      path,
      kind: 'new-enum-value',
      detail: { values: added.sort() },
    });
  }
}

function kindOf(schema: Schema): string {
  if (schema.type === 'union') {
    const inner = schema.anyOf.map(kindOf).sort();
    return `union(${inner.join('|')})`;
  }
  return schema.type;
}

function joinPath(parent: string, key: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return `${parent}.${key}`;
  }
  return `${parent}[${JSON.stringify(key)}]`;
}
