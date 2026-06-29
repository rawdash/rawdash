import { describe, expect, it } from 'vitest';

import { infer } from './infer';
import { merge } from './merge';
import { ENUM_CANDIDATE_CAP } from './types';

describe('merge', () => {
  it('unions string enum candidates up to the cap', () => {
    let s = infer('a');
    for (let i = 0; i < ENUM_CANDIDATE_CAP - 1; i++) {
      s = merge(s, infer(`v${i}`));
    }
    if (s.type !== 'string') {
      throw new Error('expected string');
    }
    expect(s.enum?.length).toBe(ENUM_CANDIDATE_CAP);
    expect(s.freeform).toBeUndefined();
  });

  it('drops enum and marks freeform when exceeding cap', () => {
    let s = infer('seed');
    for (let i = 0; i < ENUM_CANDIDATE_CAP + 5; i++) {
      s = merge(s, infer(`v${i}`));
    }
    if (s.type !== 'string') {
      throw new Error('expected string');
    }
    expect(s.freeform).toBe(true);
    expect(s.enum).toBeUndefined();
  });

  it('once freeform, stays freeform when merged with bounded set', () => {
    const free = { type: 'string' as const, freeform: true };
    const bounded = { type: 'string' as const, enum: ['x'] };
    const m = merge(free, bounded);
    expect(m).toEqual({ type: 'string', freeform: true });
  });

  it('builds a union when merging mismatched primitive types', () => {
    const m = merge(infer(1), infer('x'));
    if (m.type !== 'union') {
      throw new Error('expected union');
    }
    expect(m.anyOf.length).toBe(2);
  });

  it('flattens unions when re-merging like kinds', () => {
    const a = merge(infer(1), infer('x'));
    const b = merge(infer(2), infer('y'));
    const m = merge(a, b);
    if (m.type !== 'union') {
      throw new Error('expected union');
    }
    expect(m.anyOf.length).toBe(2);
    const stringMember = m.anyOf.find((s) => s.type === 'string');
    if (!stringMember || stringMember.type !== 'string') {
      throw new Error('expected string member');
    }
    expect(stringMember.enum?.sort()).toEqual(['x', 'y']);
  });

  it('intersection-merges required across object samples', () => {
    const a = infer({ a: 1, b: 2 });
    const b = infer({ a: 3, c: 4 });
    const m = merge(a, b);
    if (m.type !== 'object') {
      throw new Error('expected object');
    }
    expect(m.required.sort()).toEqual(['a']);
    expect(Object.keys(m.properties).sort()).toEqual(['a', 'b', 'c']);
  });

  it('merges array items recursively', () => {
    const a = infer([{ a: 1 }]);
    const b = infer([{ b: 'x' }]);
    const m = merge(a, b);
    if (m.type !== 'array' || !m.items || m.items.type !== 'object') {
      throw new Error('expected array of object');
    }
    expect(Object.keys(m.items.properties).sort()).toEqual(['a', 'b']);
    expect(m.items.required).toEqual([]);
  });
});
