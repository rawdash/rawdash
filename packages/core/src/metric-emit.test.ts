import { describe, expect, it } from 'vitest';

import { metricSample } from './metric-emit';
import { defineResources } from './resource';

const resources = defineResources({
  tokens_per_day: {
    shape: 'metric',
    description: 'Token usage per day.',
    unit: 'tokens',
    dimensions: [{ name: 'model', description: 'Model name.' }],
    measures: [{ name: 'costUsd', description: 'Cost in USD.' }],
  },
  errors_per_hour: {
    shape: 'metric',
    description: 'Errors per hour, no dimensions.',
    unit: 'errors',
  },
});

describe('metricSample', () => {
  it('builds a sample with declared dimension and measure attributes', () => {
    const s = metricSample(resources, 'tokens_per_day', {
      ts: 1,
      value: 10,
      attributes: { model: 'opus', costUsd: 2 },
    });
    expect(s).toEqual({
      name: 'tokens_per_day',
      ts: 1,
      value: 10,
      attributes: { model: 'opus', costUsd: 2 },
    });
  });

  it('builds a value-only sample for a metric with no declared fields', () => {
    const s = metricSample(resources, 'errors_per_hour', { ts: 1, value: 5 });
    expect(s).toEqual({
      name: 'errors_per_hour',
      ts: 1,
      value: 5,
      attributes: {},
    });
  });

  it('rejects an undeclared attribute key at compile time', () => {
    metricSample(resources, 'tokens_per_day', {
      ts: 1,
      value: 10,
      // @ts-expect-error "count" is not a declared dimension or measure
      attributes: { model: 'opus', count: 10 },
    });
    metricSample(resources, 'errors_per_hour', {
      ts: 1,
      value: 5,
      // @ts-expect-error errors_per_hour declares no attributes
      attributes: { region: 'us' },
    });
    expect(true).toBe(true);
  });
});
