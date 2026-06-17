import type { InMemoryStorage, ResourceDefinitions } from '@rawdash/core';

import type { InvariantViolation } from './invariants';
import { snapshotStorage } from './invariants';

const RESERVED_METRIC_FIELDS = new Set(['name', 'ts', 'value']);

function declaredAttributeKeys(
  resources: ResourceDefinitions,
  name: string,
): Set<string> | null {
  const def = resources[name];
  if (!def || def.shape !== 'metric') {
    return null;
  }
  const keys = new Set<string>();
  for (const dim of def.dimensions ?? []) {
    keys.add(dim.name);
  }
  for (const measure of def.measures ?? []) {
    keys.add(measure.name);
  }
  return keys;
}

export function connectorMetricConformanceViolations(
  resources: ResourceDefinitions,
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] {
  const snap = snapshotStorage(storage, connectorId);
  const violations: InvariantViolation[] = [];

  for (let i = 0; i < snap.metrics.length; i++) {
    const m = snap.metrics[i]!;
    const location = `${connectorId} metric "${m.name}" (metrics[${i}])`;

    if (typeof m.value !== 'number' || !Number.isFinite(m.value)) {
      violations.push({
        invariant: 'metric-shape sample carries the primary numeric in `value`',
        location,
        detail: `value must be a finite number, got ${JSON.stringify(m.value)}`,
      });
    }

    const declared = declaredAttributeKeys(resources, m.name);
    if (declared === null) {
      continue;
    }

    for (const key of Object.keys(m.attributes)) {
      if (RESERVED_METRIC_FIELDS.has(key)) {
        violations.push({
          invariant: 'metric `value` is never mirrored into an attribute',
          location,
          detail: `attribute "${key}" is reserved; the primary numeric lives in "value", reference it as field:'value'`,
        });
        continue;
      }
      if (!declared.has(key)) {
        violations.push({
          invariant:
            'metric attribute keys are declared dimensions or measures',
          location,
          detail: `attribute "${key}" is not a declared dimension/measure of "${m.name}". Declare it in defineResources or remove it (do not mirror the value into attributes).`,
        });
      }
    }
  }

  return violations;
}

export function assertConnectorMetricConformance(
  resources: ResourceDefinitions,
  storage: InMemoryStorage,
  connectorId: string,
): void {
  const violations = connectorMetricConformanceViolations(
    resources,
    storage,
    connectorId,
  );
  if (violations.length > 0) {
    throw new Error(
      `Connector "${connectorId}" metric-shape conformance failures:\n  - ${violations
        .map((v) => `${v.invariant}: ${v.detail}`)
        .join('\n  - ')}`,
    );
  }
}
