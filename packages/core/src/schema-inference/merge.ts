import type {
  ArraySchema,
  ObjectSchema,
  Schema,
  StringSchema,
  UnionSchema,
} from './types';
import { ENUM_CANDIDATE_CAP } from './types';

export function merge(a: Schema, b: Schema): Schema {
  if (a.type === 'union' || b.type === 'union') {
    return mergeUnion(toMembers(a), toMembers(b));
  }
  if (a.type === b.type) {
    if (a.type === 'string') {
      return mergeString(a, b as StringSchema);
    }
    if (a.type === 'object') {
      return mergeObject(a, b as ObjectSchema);
    }
    if (a.type === 'array') {
      return mergeArray(a, b as ArraySchema);
    }
    return a;
  }
  return mergeUnion([a], [b]);
}

function mergeString(a: StringSchema, b: StringSchema): StringSchema {
  const freeform = Boolean(a.freeform || b.freeform);
  if (freeform) {
    return { type: 'string', freeform: true };
  }
  const set = new Set<string>([...(a.enum ?? []), ...(b.enum ?? [])]);
  if (set.size > ENUM_CANDIDATE_CAP) {
    return { type: 'string', freeform: true };
  }
  return { type: 'string', enum: [...set].sort() };
}

function mergeObject(a: ObjectSchema, b: ObjectSchema): ObjectSchema {
  const keys = new Set<string>([
    ...Object.keys(a.properties),
    ...Object.keys(b.properties),
  ]);
  const properties: Record<string, Schema> = {};
  const required: string[] = [];
  const aReq = new Set(a.required);
  const bReq = new Set(b.required);
  for (const k of keys) {
    const av = a.properties[k];
    const bv = b.properties[k];
    if (av !== undefined && bv !== undefined) {
      properties[k] = merge(av, bv);
      if (aReq.has(k) && bReq.has(k)) {
        required.push(k);
      }
    } else if (av !== undefined) {
      properties[k] = av;
    } else if (bv !== undefined) {
      properties[k] = bv;
    }
  }
  return { type: 'object', properties, required: required.sort() };
}

function mergeArray(a: ArraySchema, b: ArraySchema): ArraySchema {
  if (a.items === undefined) {
    return b.items === undefined ? a : { type: 'array', items: b.items };
  }
  if (b.items === undefined) {
    return a;
  }
  return { type: 'array', items: merge(a.items, b.items) };
}

function toMembers(s: Schema): Schema[] {
  return s.type === 'union' ? s.anyOf : [s];
}

function mergeUnion(aMembers: Schema[], bMembers: Schema[]): Schema {
  const result: Schema[] = [];
  const all = [...aMembers, ...bMembers];
  for (const m of all) {
    const idx = result.findIndex(
      (r) => r.type === m.type && r.type !== 'union',
    );
    if (idx === -1) {
      result.push(m);
    } else {
      result[idx] = merge(result[idx] as Schema, m);
    }
  }
  if (result.length === 1) {
    return result[0] as Schema;
  }
  const union: UnionSchema = { type: 'union', anyOf: result };
  return union;
}
