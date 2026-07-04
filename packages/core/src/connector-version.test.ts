import { describe, expect, it } from 'vitest';

import { compareConnectorVersions, latestVersion } from './connector-version';

describe('compareConnectorVersions', () => {
  it('orders by each dotted-numeric segment', () => {
    expect(compareConnectorVersions('1.0.0', '2.0.0')).toBe(-1);
    expect(compareConnectorVersions('2.0.0', '1.0.0')).toBe(1);
    expect(compareConnectorVersions('1.2.0', '1.10.0')).toBe(-1);
    expect(compareConnectorVersions('1.0.9', '1.0.10')).toBe(-1);
  });

  it('treats equal versions as 0', () => {
    expect(compareConnectorVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('treats missing trailing segments as 0', () => {
    expect(compareConnectorVersions('1.2', '1.2.0')).toBe(0);
    expect(compareConnectorVersions('1.2.1', '1.2')).toBe(1);
  });

  it('treats non-numeric segments as 0', () => {
    expect(compareConnectorVersions('1.x.0', '1.0.0')).toBe(0);
    expect(compareConnectorVersions('1.2.0', '1.x.0')).toBe(1);
  });

  it('produces a stable ascending sort', () => {
    const sorted = ['1.10.0', '1.2.0', '2.0.0', '1.2.1'].sort(
      compareConnectorVersions,
    );
    expect(sorted).toEqual(['1.2.0', '1.2.1', '1.10.0', '2.0.0']);
  });
});

describe('latestVersion', () => {
  it('selects the maximum version', () => {
    expect(latestVersion(['1.2.0', '2.0.0', '1.10.0'])).toBe('2.0.0');
    expect(latestVersion(['1.2.0', '1.2.1', '1.2.10'])).toBe('1.2.10');
  });

  it('returns the single version when only one is given', () => {
    expect(latestVersion(['3.4.5'])).toBe('3.4.5');
  });

  it('returns null for an empty list', () => {
    expect(latestVersion([])).toBeNull();
  });
});
