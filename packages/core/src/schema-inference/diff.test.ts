import { describe, expect, it } from 'vitest';

import { diff } from './diff';
import { infer } from './infer';
import { merge } from './merge';

describe('diff', () => {
  it('reports type-change at the leaf path', () => {
    const baseline = infer({ id: 1 });
    const observed = infer({ id: 'x' });
    const d = diff(baseline, observed);
    expect(d).toEqual([
      {
        path: '$.id',
        kind: 'type-change',
        detail: { from: 'number', to: 'string' },
      },
    ]);
  });

  it('reports new-field with required flag', () => {
    const baseline = infer({ id: 1 });
    const observed = infer({ id: 1, name: 'x' });
    const d = diff(baseline, observed);
    expect(d).toEqual([
      { path: '$.name', kind: 'new-field', detail: { required: true } },
    ]);
  });

  it('reports removed-field', () => {
    const baseline = infer({ id: 1, name: 'x' });
    const observed = infer({ id: 1 });
    const d = diff(baseline, observed);
    expect(d).toEqual([{ path: '$.name', kind: 'removed-field', detail: {} }]);
  });

  it('reports required-became-optional', () => {
    const baseline = infer({ id: 1, label: 'x' });
    const observed = merge(
      infer({ id: 1, label: 'x' }),
      infer({ id: 2, label: null }),
    );
    const d = diff(baseline, observed);
    expect(d).toContainEqual({
      path: '$.label',
      kind: 'required-became-optional',
      detail: {},
    });
  });

  it('reports optional-became-required', () => {
    const baseline = merge(infer({ id: 1 }), infer({ id: 2, label: 'x' }));
    const observed = infer({ id: 1, label: 'x' });
    const d = diff(baseline, observed);
    expect(d).toContainEqual({
      path: '$.label',
      kind: 'optional-became-required',
      detail: {},
    });
  });

  it('reports new-enum-value when observed has values absent from baseline', () => {
    const baseline = merge(
      infer({ status: 'open' }),
      infer({ status: 'closed' }),
    );
    const observed = merge(baseline, infer({ status: 'pending' }));
    const d = diff(baseline, observed);
    expect(d).toEqual([
      {
        path: '$.status',
        kind: 'new-enum-value',
        detail: { values: ['pending'] },
      },
    ]);
  });

  it('reports new-enum-value inside a union(string|null) member', () => {
    const baseline = merge(
      merge(infer({ status: 'open' }), infer({ status: 'closed' })),
      infer({ status: null }),
    );
    const observed = merge(baseline, infer({ status: 'pending' }));
    const d = diff(baseline, observed);
    expect(d).toEqual([
      {
        path: '$.status',
        kind: 'new-enum-value',
        detail: { values: ['pending'] },
      },
    ]);
  });

  it('does not report new-enum-value when either side is freeform', () => {
    const baselineFreeform = {
      type: 'object' as const,
      properties: { s: { type: 'string' as const, freeform: true } },
      required: ['s'],
    };
    const observed = infer({ s: 'x' });
    expect(diff(baselineFreeform, observed)).toEqual([]);
  });

  it('walks into nested objects and arrays', () => {
    const baseline = infer({ outer: { inner: 1 }, list: [{ a: 1 }] });
    const observed = infer({ outer: { inner: 'x' }, list: [{ a: 'x' }] });
    const d = diff(baseline, observed);
    expect(d).toContainEqual({
      path: '$.outer.inner',
      kind: 'type-change',
      detail: { from: 'number', to: 'string' },
    });
    expect(d).toContainEqual({
      path: '$.list[*].a',
      kind: 'type-change',
      detail: { from: 'number', to: 'string' },
    });
  });

  it('quotes non-identifier path keys', () => {
    const baseline = infer({ 'weird-key': 1 });
    const observed = infer({ 'weird-key': 'x' });
    const d = diff(baseline, observed);
    expect(d[0]?.path).toBe('$["weird-key"]');
  });
});
