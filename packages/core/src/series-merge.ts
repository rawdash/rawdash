import { aggregateNumeric } from './compute';
import type { AggFn } from './config';
import type { WidgetSeries } from './wire';

export interface MergedPoint {
  date: string;
  value: number | null;
}

export interface MergeSeriesOptions {
  fn?: AggFn;
}

export function mergeSeries(
  series: readonly WidgetSeries[],
  opts: MergeSeriesOptions = {},
): MergedPoint[] {
  const fn = opts.fn ?? 'sum';
  const byDate = new Map<string, number[]>();
  for (const s of series) {
    if (!Array.isArray(s.data)) {
      continue;
    }
    for (const point of s.data as unknown[]) {
      if (point === null || typeof point !== 'object') {
        continue;
      }
      const date = (point as { date?: unknown }).date;
      const value = (point as { value?: unknown }).value;
      if (typeof date !== 'string' || typeof value !== 'number') {
        continue;
      }
      const bucket = byDate.get(date);
      if (bucket) {
        bucket.push(value);
      } else {
        byDate.set(date, [value]);
      }
    }
  }
  return [...byDate.entries()]
    .map(([date, values]) => ({ date, value: aggregateNumeric(values, fn) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function mergeSeriesScalar(
  series: readonly WidgetSeries[],
  opts: MergeSeriesOptions = {},
): number | null {
  const fn = opts.fn ?? 'sum';
  const values: number[] = [];
  for (const s of series) {
    if (typeof s.data === 'number') {
      values.push(s.data);
    }
  }
  return aggregateNumeric(values, fn);
}
