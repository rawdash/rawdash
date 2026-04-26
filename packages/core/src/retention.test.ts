import { describe, expect, it } from 'vitest';

import { selectForDeletion } from './retention';

const NOW = 1_000_000;
const getTs = (r: { ts: number }) => r.ts;

function makeRows(timestamps: number[]) {
  return timestamps.map((ts) => ({ ts }));
}

describe('selectForDeletion — no policy', () => {
  it('returns empty when neither maxAge nor maxSize is set', () => {
    const rows = makeRows([900, 800, 700]);
    expect(selectForDeletion(rows, getTs, {}, NOW)).toHaveLength(0);
  });
});

describe('selectForDeletion — maxAge', () => {
  it('marks rows older than maxAge as candidates', () => {
    const rows = makeRows([NOW - 100, NOW - 200, NOW - 500]);
    const toDelete = selectForDeletion(rows, getTs, { maxAge: 300 }, NOW);
    expect(toDelete).toHaveLength(1);
    expect(toDelete[0]!.ts).toBe(NOW - 500);
  });

  it('keeps all rows when none exceed maxAge', () => {
    const rows = makeRows([NOW - 100, NOW - 200]);
    expect(selectForDeletion(rows, getTs, { maxAge: 300 }, NOW)).toHaveLength(
      0,
    );
  });

  it('marks all rows when all exceed maxAge', () => {
    const rows = makeRows([NOW - 400, NOW - 500, NOW - 600]);
    const toDelete = selectForDeletion(rows, getTs, { maxAge: 300 }, NOW);
    expect(toDelete).toHaveLength(3);
  });
});

describe('selectForDeletion — maxSize', () => {
  it('keeps only the newest maxSize rows', () => {
    const rows = makeRows([NOW - 100, NOW - 200, NOW - 300, NOW - 400]);
    const toDelete = selectForDeletion(rows, getTs, { maxSize: 2 }, NOW);
    expect(toDelete).toHaveLength(2);
    expect(toDelete.map((r) => r.ts)).toEqual([NOW - 300, NOW - 400]);
  });

  it('returns empty when row count is within maxSize', () => {
    const rows = makeRows([NOW - 100, NOW - 200]);
    expect(selectForDeletion(rows, getTs, { maxSize: 5 }, NOW)).toHaveLength(0);
  });

  it('returns empty when row count equals maxSize', () => {
    const rows = makeRows([NOW - 100, NOW - 200]);
    expect(selectForDeletion(rows, getTs, { maxSize: 2 }, NOW)).toHaveLength(0);
  });
});

describe('selectForDeletion — floor', () => {
  it('always keeps newest floor rows even if maxAge would delete them', () => {
    const rows = makeRows([NOW - 500, NOW - 600, NOW - 700]);
    const toDelete = selectForDeletion(
      rows,
      getTs,
      { maxAge: 400, floor: 1 },
      NOW,
    );
    expect(toDelete).toHaveLength(2);
    expect(toDelete.map((r) => r.ts)).toEqual([NOW - 600, NOW - 700]);
  });

  it('always keeps newest floor rows even if maxSize would delete them', () => {
    const rows = makeRows([NOW - 100, NOW - 200, NOW - 300]);
    const toDelete = selectForDeletion(
      rows,
      getTs,
      { maxSize: 1, floor: 2 },
      NOW,
    );
    expect(toDelete).toHaveLength(1);
    expect(toDelete[0]!.ts).toBe(NOW - 300);
  });

  it('keeps all rows when floor >= total count', () => {
    const rows = makeRows([NOW - 100, NOW - 200]);
    const toDelete = selectForDeletion(
      rows,
      getTs,
      { maxSize: 0, floor: 2 },
      NOW,
    );
    expect(toDelete).toHaveLength(0);
  });
});

describe('selectForDeletion — combined maxAge + maxSize', () => {
  it('applies both rules as a union (OR)', () => {
    const rows = makeRows([NOW - 100, NOW - 200, NOW - 400, NOW - 500]);
    const toDelete = selectForDeletion(
      rows,
      getTs,
      { maxAge: 350, maxSize: 3 },
      NOW,
    );
    expect(toDelete.map((r) => r.ts).sort((a, b) => b - a)).toEqual([
      NOW - 400,
      NOW - 500,
    ]);
  });
});
