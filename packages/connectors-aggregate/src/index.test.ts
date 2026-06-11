import { describe, expect, it } from 'vitest';

import { connectorMetadata, connectorMetadataById } from './metadata';
import { connectorIds, connectorLoaders, loadConnector } from './registry';

describe('@rawdash/connectors metadata', () => {
  it('aggregates every connector with complete metadata', () => {
    expect(connectorMetadata.length).toBeGreaterThan(0);
    for (const c of connectorMetadata) {
      expect(c.id).toBeTruthy();
      expect(c.packageName).toMatch(/^@rawdash\/connector-/);
      expect(c.doc.displayName).toBeTruthy();
      expect(c.configFields).toBeDefined();
      expect(Object.keys(c.resources).length).toBeGreaterThan(0);
    }
  });

  it('has a unique id per connector', () => {
    const ids = connectorMetadata.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keys connectorMetadataById by id', () => {
    for (const c of connectorMetadata) {
      expect(connectorMetadataById[c.id]).toBe(c);
    }
  });

  it('declares a well-formed filterable array on every resource', () => {
    for (const c of connectorMetadata) {
      for (const [name, def] of Object.entries(c.resources)) {
        const where = `${c.id}.${name}`;
        expect(Array.isArray(def.filterable), `${where} filterable`).toBe(true);
        for (const entry of def.filterable) {
          expect(entry.field?.trim(), `${where} field`).toBeTruthy();
          expect(
            Array.isArray(entry.ops) && entry.ops.length > 0,
            `${where} ops`,
          ).toBe(true);
        }
      }
    }
  });
});

describe('@rawdash/connectors registry', () => {
  it('exposes a loader for every connector in the metadata', () => {
    expect(connectorIds).toEqual(connectorMetadata.map((c) => c.id).sort());
    for (const id of connectorIds) {
      expect(typeof connectorLoaders[id]).toBe('function');
    }
  });

  it('lazily loads a connector class whose static id matches its key', async () => {
    const id = connectorIds[0]!;
    const Cls = (await loadConnector(id)) as unknown as { id: string };
    expect(Cls.id).toBe(id);
  });

  it('throws on an unknown connector id', async () => {
    await expect(loadConnector('does-not-exist')).rejects.toThrow(
      /Unknown connector id/,
    );
  });
});
