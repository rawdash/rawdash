import { describe, expect, it } from 'vitest';

import { canonicalize, fingerprint, stableStringify } from './fingerprint';
import { infer } from './infer';
import { merge } from './merge';

describe('fingerprint', () => {
  it('is deterministic regardless of object key insertion order', async () => {
    const a = infer({ a: 1, b: 'x', c: { d: true, e: null } });
    const b = infer({ c: { e: null, d: true }, b: 'x', a: 1 });
    expect(await fingerprint(a)).toBe(await fingerprint(b));
  });

  it('produces a stable 64-hex-char SHA-256 digest', async () => {
    const s = infer({ id: 1 });
    const fp = await fingerprint(s);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it('excludes enum candidate set from the hash input', async () => {
    let s = infer('seed');
    const baselineFp = await fingerprint(s);
    s = merge(s, infer('another'));
    s = merge(s, infer('and-another'));
    const expandedFp = await fingerprint(s);
    expect(expandedFp).toBe(baselineFp);
  });

  it('changes when shape changes (new field added)', async () => {
    const a = infer({ id: 1 });
    const b = infer({ id: 1, name: 'x' });
    expect(await fingerprint(a)).not.toBe(await fingerprint(b));
  });

  it('changes when required-set changes', async () => {
    const baseline = infer({ id: 1, label: 'a' });
    const withOptional = merge(baseline, infer({ id: 2, label: null }));
    expect(await fingerprint(baseline)).not.toBe(
      await fingerprint(withOptional),
    );
  });

  it('still flags freeform vs bounded as different shapes', async () => {
    const bounded = { type: 'string' as const, enum: ['x'] };
    const freeform = { type: 'string' as const, freeform: true };
    expect(await fingerprint(bounded)).not.toBe(await fingerprint(freeform));
  });

  it('canonicalize sorts object property keys deterministically', () => {
    const canonical = canonicalize(infer({ b: 1, a: 2 }));
    const json = stableStringify(canonical);
    expect(json.indexOf('"a"')).toBeLessThan(json.indexOf('"b"'));
  });
});
