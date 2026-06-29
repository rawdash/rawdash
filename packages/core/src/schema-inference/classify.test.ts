import { describe, expect, it } from 'vitest';

import { validateObserved } from './classify';
import type { Schema } from './types';

const str: Schema = { type: 'string', freeform: true };
const num: Schema = { type: 'number' };
const nul: Schema = { type: 'null' };

function obj(properties: Record<string, Schema>, required: string[]): Schema {
  return { type: 'object', properties, required };
}

function nullable(inner: Schema): Schema {
  return { type: 'union', anyOf: [nul, inner] };
}

describe('validateObserved', () => {
  it('enum value outside the baseline is breaking', () => {
    const baseline: Schema = {
      type: 'string',
      enum: ['open', 'closed'],
    };
    const observed: Schema = {
      type: 'string',
      enum: ['archived'],
    };
    const result = validateObserved(baseline, observed);
    expect(result.severity).toBe('breaking');
    expect(result.errors).toEqual([
      {
        path: '$',
        kind: 'value-not-in-enum',
        detail: { values: ['archived'], allowed: ['open', 'closed'] },
      },
    ]);
  });

  it('identical schema validates → noise, no errors', () => {
    const baseline = obj({ id: num, name: str }, ['id', 'name']);
    const result = validateObserved(baseline, baseline);
    expect(result.severity).toBe('noise');
    expect(result.errors).toEqual([]);
  });

  it('present optional field (single-sample tightening) → noise', () => {
    const baseline = obj({ id: num, note: str }, ['id']);
    const observed = obj({ id: num, note: str }, ['id', 'note']);
    expect(validateObserved(baseline, observed).severity).toBe('noise');
  });

  it('non-null value for a nullable field → noise', () => {
    const baseline = obj({ val: nullable(str) }, ['val']);
    const observed = obj({ val: str }, ['val']);
    expect(validateObserved(baseline, observed).severity).toBe('noise');
  });

  it('null value for a nullable field → noise', () => {
    const baseline = obj({ val: nullable(str) }, ['val']);
    const observed = obj({ val: nul }, []);
    expect(validateObserved(baseline, observed).severity).toBe('noise');
  });

  it('extra field the baseline strips → noise', () => {
    const baseline = obj({ id: num }, ['id']);
    const observed = obj({ id: num, extra: str }, ['id', 'extra']);
    expect(validateObserved(baseline, observed).severity).toBe('noise');
  });

  it('type mismatch on a field → breaking with type-mismatch error', () => {
    const baseline = obj({ id: num }, ['id']);
    const observed = obj({ id: str }, ['id']);
    const result = validateObserved(baseline, observed);
    expect(result.severity).toBe('breaking');
    expect(result.errors).toEqual([
      {
        path: '$.id',
        kind: 'type-mismatch',
        detail: { expected: 'number', observed: 'string' },
      },
    ]);
  });

  it('missing required field → breaking with missing-required-field error', () => {
    const baseline = obj({ id: num, name: str }, ['id', 'name']);
    const observed = obj({ id: num }, ['id']);
    const result = validateObserved(baseline, observed);
    expect(result.severity).toBe('breaking');
    expect(result.errors).toEqual([
      { path: '$.name', kind: 'missing-required-field', detail: {} },
    ]);
  });

  it('null value where baseline is strictly non-null → breaking', () => {
    const baseline = obj({ id: str }, ['id']);
    const observed = obj({ id: nul }, []);
    const result = validateObserved(baseline, observed);
    expect(result.severity).toBe('breaking');
    expect(result.errors[0]?.kind).toBe('type-mismatch');
    expect(result.errors[0]?.path).toBe('$.id');
  });

  it('root array→object flip (non-2xx body shape) → breaking', () => {
    const baseline: Schema = { type: 'array', items: obj({ id: num }, ['id']) };
    const observed = obj({ error: str }, ['error']);
    const result = validateObserved(baseline, observed);
    expect(result.severity).toBe('breaking');
    expect(result.errors).toEqual([
      {
        path: '$',
        kind: 'type-mismatch',
        detail: { expected: 'array', observed: 'object' },
      },
    ]);
  });

  it('accepts an observed value matching a later union branch', () => {
    const baseline: Schema = {
      type: 'union',
      anyOf: [obj({ a: num }, ['a']), obj({ b: str }, ['b'])],
    };
    const observed = obj({ b: str }, ['b']);
    expect(validateObserved(baseline, observed).severity).toBe('noise');
  });

  it('validates element schema inside arrays', () => {
    const baseline: Schema = { type: 'array', items: obj({ id: num }, ['id']) };
    const observed: Schema = {
      type: 'array',
      items: obj({ id: str }, ['id']),
    };
    const result = validateObserved(baseline, observed);
    expect(result.severity).toBe('breaking');
    expect(result.errors[0]?.path).toBe('$[*].id');
  });
});
