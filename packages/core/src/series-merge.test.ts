import { describe, expect, it } from 'vitest';

import { mergeSeries, mergeSeriesScalar } from './series-merge';
import type { WidgetSeries } from './wire';

function tsSeries(
  key: string,
  points: Array<{ date: string; value: number }>,
): WidgetSeries {
  return { key, connectorId: key, label: key, data: points };
}

describe('mergeSeries', () => {
  it('sums values across series by date', () => {
    const merged = mergeSeries([
      tsSeries('ios', [
        { date: '2026-05-01', value: 120 },
        { date: '2026-05-02', value: 140 },
      ]),
      tsSeries('android', [
        { date: '2026-05-01', value: 90 },
        { date: '2026-05-02', value: 110 },
      ]),
    ]);
    expect(merged).toEqual([
      { date: '2026-05-01', value: 210 },
      { date: '2026-05-02', value: 250 },
    ]);
  });

  it('keeps dates that appear in only one series', () => {
    const merged = mergeSeries([
      tsSeries('ios', [{ date: '2026-05-01', value: 10 }]),
      tsSeries('android', [{ date: '2026-05-02', value: 20 }]),
    ]);
    expect(merged).toEqual([
      { date: '2026-05-01', value: 10 },
      { date: '2026-05-02', value: 20 },
    ]);
  });

  it('supports avg as the merge fn', () => {
    const merged = mergeSeries(
      [
        tsSeries('ios', [{ date: '2026-05-01', value: 100 }]),
        tsSeries('android', [{ date: '2026-05-01', value: 200 }]),
      ],
      { fn: 'avg' },
    );
    expect(merged).toEqual([{ date: '2026-05-01', value: 150 }]);
  });

  it('ignores non-array / malformed series data', () => {
    const merged = mergeSeries([
      { key: 'a', connectorId: 'a', label: 'a', data: 42 },
      tsSeries('b', [{ date: '2026-05-01', value: 5 }]),
    ]);
    expect(merged).toEqual([{ date: '2026-05-01', value: 5 }]);
  });
});

describe('mergeSeriesScalar', () => {
  it('sums scalar series', () => {
    const value = mergeSeriesScalar([
      { key: 'a', connectorId: 'a', label: 'a', data: 3 },
      { key: 'b', connectorId: 'b', label: 'b', data: 4 },
    ]);
    expect(value).toBe(7);
  });

  it('averages scalar series when fn is avg', () => {
    const value = mergeSeriesScalar(
      [
        { key: 'a', connectorId: 'a', label: 'a', data: 10 },
        { key: 'b', connectorId: 'b', label: 'b', data: 20 },
      ],
      { fn: 'avg' },
    );
    expect(value).toBe(15);
  });
});
