import { merge } from './merge';
import type { JsonValue, Schema } from './types';

export function infer(value: JsonValue): Schema {
  if (value === null) {
    return { type: 'null' };
  }
  if (typeof value === 'string') {
    return { type: 'string', enum: [value] };
  }
  if (typeof value === 'number') {
    return { type: 'number' };
  }
  if (typeof value === 'boolean') {
    return { type: 'boolean' };
  }
  if (Array.isArray(value)) {
    return inferArray(value);
  }
  return inferObject(value as { [key: string]: JsonValue });
}

function inferArray(values: JsonValue[]): Schema {
  if (values.length === 0) {
    return { type: 'array' };
  }
  let items: Schema | undefined;
  for (const v of values) {
    const s = infer(v);
    items = items === undefined ? s : merge(items, s);
  }
  return { type: 'array', items };
}

function inferObject(obj: { [key: string]: JsonValue }): Schema {
  const properties: Record<string, Schema> = {};
  const required: string[] = [];
  for (const key of Object.keys(obj)) {
    const v = obj[key] as JsonValue;
    const childSchema = infer(v);
    properties[key] = childSchema;
    if (v !== null) {
      required.push(key);
    }
  }
  return { type: 'object', properties, required };
}
