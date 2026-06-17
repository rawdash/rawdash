import { describe, expect, it, vi } from 'vitest';

import { InMemoryStorage } from './in-memory-storage';
import { withMetricResourceGuard } from './metric-guard';
import { defineResources } from './resource';

const resources = defineResources({
  tokens_per_day: {
    shape: 'metric',
    description: 'Token usage per day.',
    unit: 'tokens',
    dimensions: [{ name: 'model', description: 'Model name.' }],
    measures: [{ name: 'costUsd', description: 'Cost in USD.' }],
  },
});

const CONNECTOR_ID = 'acme';

function guardedHandle(warn: (m: string) => void) {
  const storage = new InMemoryStorage();
  const handle = withMetricResourceGuard(
    storage.getStorageHandle(CONNECTOR_ID),
    resources,
    warn,
  );
  return { storage, handle };
}

describe('withMetricResourceGuard', () => {
  it('strips undeclared attribute keys and warns', async () => {
    const warn = vi.fn();
    const { storage, handle } = guardedHandle(warn);
    await handle.metric({
      name: 'tokens_per_day',
      ts: 1,
      value: 10,
      attributes: { model: 'opus', costUsd: 2, count: 10 },
    });
    const [m] = await storage.getStorageHandle(CONNECTOR_ID).queryMetrics({
      name: 'tokens_per_day',
    });
    expect(m?.attributes).toEqual({ model: 'opus', costUsd: 2 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('count'));
  });

  it('drops samples with a non-finite value and warns', async () => {
    const warn = vi.fn();
    const { storage, handle } = guardedHandle(warn);
    await handle.metrics([
      { name: 'tokens_per_day', ts: 1, value: Number.NaN, attributes: {} },
      { name: 'tokens_per_day', ts: 2, value: 5, attributes: { model: 'x' } },
    ]);
    const written = await storage
      .getStorageHandle(CONNECTOR_ID)
      .queryMetrics({ name: 'tokens_per_day' });
    expect(written).toHaveLength(1);
    expect(written[0]?.value).toBe(5);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('non-finite'));
  });

  it('passes through compliant samples untouched', async () => {
    const warn = vi.fn();
    const { storage, handle } = guardedHandle(warn);
    await handle.metric({
      name: 'tokens_per_day',
      ts: 1,
      value: 10,
      attributes: { model: 'opus', costUsd: 2 },
    });
    const [m] = await storage
      .getStorageHandle(CONNECTOR_ID)
      .queryMetrics({ name: 'tokens_per_day' });
    expect(m?.attributes).toEqual({ model: 'opus', costUsd: 2 });
    expect(warn).not.toHaveBeenCalled();
  });
});
