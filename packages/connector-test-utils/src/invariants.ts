import type { InMemoryStorage } from '@rawdash/core';

interface StorageSnapshot {
  events: Array<{
    name: string;
    start_ts: number;
    end_ts: number | null;
    attributes: Record<string, unknown>;
  }>;
  entities: Array<{
    type: string;
    id: string;
    attributes: Record<string, unknown>;
    updated_at: number;
  }>;
  edges: Array<{
    from_type: string;
    from_id: string;
    kind: string;
    to_type: string;
    to_id: string;
    attributes: Record<string, unknown>;
    updated_at: number;
  }>;
  metrics: Array<{
    name: string;
    ts: number;
    value: number;
    attributes: Record<string, unknown>;
  }>;
}

interface InternalStorage {
  eventStore: Map<string, StorageSnapshot['events']>;
  entityStore: Map<
    string,
    Map<string, Map<string, StorageSnapshot['entities'][number]>>
  >;
  edgeStore: Map<string, StorageSnapshot['edges']>;
  metricStore: Map<string, StorageSnapshot['metrics']>;
}

export function snapshotStorage(
  storage: InMemoryStorage,
  connectorId: string,
): StorageSnapshot {
  const s = storage as unknown as InternalStorage;
  const events = s.eventStore.get(connectorId) ?? [];
  const entityMap = s.entityStore.get(connectorId);
  const entities: StorageSnapshot['entities'] = [];
  if (entityMap) {
    for (const byId of entityMap.values()) {
      for (const e of byId.values()) {
        entities.push(e);
      }
    }
  }
  const edges = s.edgeStore.get(connectorId) ?? [];
  const metrics = s.metricStore.get(connectorId) ?? [];
  return { events, entities, edges, metrics };
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function hasUndefinedDeep(v: unknown, path: string): string | null {
  if (v === undefined) {
    return path || '<root>';
  }
  if (v === null || typeof v !== 'object') {
    return null;
  }
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const inner = hasUndefinedDeep(v[i], `${path}[${i}]`);
      if (inner) {
        return inner;
      }
    }
    return null;
  }
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const inner = hasUndefinedDeep(val, path ? `${path}.${k}` : k);
    if (inner) {
      return inner;
    }
  }
  return null;
}

export interface InvariantViolation {
  invariant: string;
  location: string;
  detail: string;
}

export function checkUniversalInvariants(
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] {
  const snap = snapshotStorage(storage, connectorId);
  const violations: InvariantViolation[] = [];

  for (let i = 0; i < snap.entities.length; i++) {
    const e = snap.entities[i]!;
    if (typeof e.id !== 'string' || e.id.length === 0) {
      violations.push({
        invariant: 'entity.id is a non-empty string',
        location: `entities[${i}] (type=${e.type})`,
        detail: `got id=${JSON.stringify(e.id)}`,
      });
    }
    if (typeof e.type !== 'string' || e.type.length === 0) {
      violations.push({
        invariant: 'entity.type is a non-empty string',
        location: `entities[${i}]`,
        detail: `got type=${JSON.stringify(e.type)}`,
      });
    }
    if (!isFiniteNumber(e.updated_at)) {
      violations.push({
        invariant: 'entity.updated_at is a finite number',
        location: `entities[${i}] (id=${e.id})`,
        detail: `got updated_at=${JSON.stringify(e.updated_at)}`,
      });
    }
    const undefPath = hasUndefinedDeep(e.attributes, 'attributes');
    if (undefPath) {
      violations.push({
        invariant: 'no undefined reaches entity.attributes',
        location: `entities[${i}] (id=${e.id})`,
        detail: `undefined at ${undefPath}`,
      });
    }
  }

  for (let i = 0; i < snap.events.length; i++) {
    const ev = snap.events[i]!;
    if (typeof ev.name !== 'string' || ev.name.length === 0) {
      violations.push({
        invariant: 'event.name is a non-empty string',
        location: `events[${i}]`,
        detail: `got name=${JSON.stringify(ev.name)}`,
      });
    }
    if (!isFiniteNumber(ev.start_ts)) {
      violations.push({
        invariant: 'event.start_ts is a finite number (valid date)',
        location: `events[${i}] (name=${ev.name})`,
        detail: `got start_ts=${JSON.stringify(ev.start_ts)}`,
      });
    }
    if (ev.end_ts !== null && !isFiniteNumber(ev.end_ts)) {
      violations.push({
        invariant: 'event.end_ts is null or a finite number',
        location: `events[${i}] (name=${ev.name})`,
        detail: `got end_ts=${JSON.stringify(ev.end_ts)}`,
      });
    }
    const undefPath = hasUndefinedDeep(ev.attributes, 'attributes');
    if (undefPath) {
      violations.push({
        invariant: 'no undefined reaches event.attributes',
        location: `events[${i}] (name=${ev.name})`,
        detail: `undefined at ${undefPath}`,
      });
    }
  }

  for (let i = 0; i < snap.edges.length; i++) {
    const edge = snap.edges[i]!;
    for (const field of [
      'from_type',
      'from_id',
      'kind',
      'to_type',
      'to_id',
    ] as const) {
      const v = edge[field];
      if (typeof v !== 'string' || v.length === 0) {
        violations.push({
          invariant: `edge.${field} is a non-empty string`,
          location: `edges[${i}] (kind=${edge.kind})`,
          detail: `got ${field}=${JSON.stringify(v)}`,
        });
      }
    }
    const undefPath = hasUndefinedDeep(edge.attributes, 'attributes');
    if (undefPath) {
      violations.push({
        invariant: 'no undefined reaches edge.attributes',
        location: `edges[${i}] (kind=${edge.kind})`,
        detail: `undefined at ${undefPath}`,
      });
    }
  }

  for (let i = 0; i < snap.metrics.length; i++) {
    const m = snap.metrics[i]!;
    if (!isFiniteNumber(m.value)) {
      violations.push({
        invariant: 'metric.value is a finite number',
        location: `metrics[${i}] (name=${m.name})`,
        detail: `got value=${JSON.stringify(m.value)}`,
      });
    }
    if (!isFiniteNumber(m.ts)) {
      violations.push({
        invariant: 'metric.ts is a finite number',
        location: `metrics[${i}] (name=${m.name})`,
        detail: `got ts=${JSON.stringify(m.ts)}`,
      });
    }
  }

  return violations;
}

export function formatViolations(violations: InvariantViolation[]): string {
  return violations
    .map(
      (v, i) =>
        `  [${i + 1}] ${v.invariant}\n      at ${v.location}\n      ${v.detail}`,
    )
    .join('\n');
}
