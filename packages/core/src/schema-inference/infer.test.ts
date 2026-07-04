import { describe, expect, it } from 'vitest';

import { infer } from './infer';
import { merge } from './merge';

describe('infer', () => {
  it('infers primitives', () => {
    expect(infer(null)).toEqual({ type: 'null' });
    expect(infer(true)).toEqual({ type: 'boolean' });
    expect(infer(42)).toEqual({ type: 'number' });
    expect(infer(1.5)).toEqual({ type: 'number' });
    expect(infer('hi')).toEqual({ type: 'string', enum: ['hi'] });
  });

  it('infers nested objects with required keys', () => {
    const s = infer({ id: 1, name: 'alice', nested: { a: true } });
    expect(s).toEqual({
      type: 'object',
      properties: {
        id: { type: 'number' },
        name: { type: 'string', enum: ['alice'] },
        nested: {
          type: 'object',
          properties: { a: { type: 'boolean' } },
          required: ['a'],
        },
      },
      required: ['id', 'name', 'nested'],
    });
  });

  it('marks keys with null values as not required', () => {
    const s = infer({ id: 1, label: null });
    expect(s).toEqual({
      type: 'object',
      properties: {
        id: { type: 'number' },
        label: { type: 'null' },
      },
      required: ['id'],
    });
  });

  it('unifies array element types across mixed shapes', () => {
    const s = infer([{ a: 1 }, { a: 2, b: 'x' }]);
    expect(s).toEqual({
      type: 'array',
      items: {
        type: 'object',
        properties: {
          a: { type: 'number' },
          b: { type: 'string', enum: ['x'] },
        },
        required: ['a'],
      },
    });
  });

  it('produces a union for arrays with primitive type mixes', () => {
    const s = infer([1, 'x', true]);
    expect(s.type).toBe('array');
    if (s.type !== 'array' || !s.items || s.items.type !== 'union') {
      throw new Error('expected union items');
    }
    const types = s.items.anyOf.map((m) => m.type);
    expect(types.sort()).toEqual(['boolean', 'number', 'string']);
  });

  it('handles empty array as type=array with no items', () => {
    expect(infer([])).toEqual({ type: 'array' });
  });

  it('detects optionality across multiple samples via merge', () => {
    const a = infer({ id: 1, name: 'a' });
    const b = infer({ id: 2 });
    const m = merge(a, b);
    if (m.type !== 'object') {
      throw new Error('expected object');
    }
    expect(m.required.sort()).toEqual(['id']);
    expect(Object.keys(m.properties).sort()).toEqual(['id', 'name']);
  });

  it('treats null observation as optional in merged schema', () => {
    const a = infer({ id: 1, label: 'x' });
    const b = infer({ id: 2, label: null });
    const m = merge(a, b);
    if (m.type !== 'object') {
      throw new Error('expected object');
    }
    expect(m.required.sort()).toEqual(['id']);
  });
});
