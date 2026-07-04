import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SYNC_INTERVAL_SECONDS,
  normalizeConfiguredConnector,
} from './config';

describe('normalizeConfiguredConnector()', () => {
  it('fills defaults for omitted fields', () => {
    const result = normalizeConfiguredConnector({
      name: 'main',
      connectorId: 'stub',
      config: { host: 'example.com' },
    });

    expect(result).toEqual({
      name: 'main',
      connectorId: 'stub',
      config: { host: 'example.com' },
      displayName: 'main',
      syncIntervalSeconds: DEFAULT_SYNC_INTERVAL_SECONDS,
      enabled: true,
    });
  });

  it('defaults displayName to name', () => {
    const result = normalizeConfiguredConnector({
      name: 'github-prod',
      connectorId: 'github',
      config: {},
    });

    expect(result.displayName).toBe('github-prod');
  });

  it('uses 300 as the canonical default sync interval', () => {
    expect(DEFAULT_SYNC_INTERVAL_SECONDS).toBe(300);

    const result = normalizeConfiguredConnector({
      name: 'main',
      connectorId: 'stub',
      config: {},
    });

    expect(result.syncIntervalSeconds).toBe(300);
  });

  it('preserves explicit overrides', () => {
    const result = normalizeConfiguredConnector({
      name: 'main',
      connectorId: 'stub',
      config: {},
      displayName: 'Main API',
      syncIntervalSeconds: 60,
      enabled: false,
    });

    expect(result.displayName).toBe('Main API');
    expect(result.syncIntervalSeconds).toBe(60);
    expect(result.enabled).toBe(false);
  });

  it('treats enabled: false as an explicit override, not a missing default', () => {
    const result = normalizeConfiguredConnector({
      name: 'main',
      connectorId: 'stub',
      config: {},
      enabled: false,
    });

    expect(result.enabled).toBe(false);
  });

  it('does not mutate the input entry', () => {
    const entry = {
      name: 'main',
      connectorId: 'stub',
      config: {},
    };

    normalizeConfiguredConnector(entry);

    expect(entry).not.toHaveProperty('displayName');
    expect(entry).not.toHaveProperty('syncIntervalSeconds');
    expect(entry).not.toHaveProperty('enabled');
  });
});
