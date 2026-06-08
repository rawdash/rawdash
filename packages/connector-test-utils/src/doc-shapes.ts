import type { InMemoryStorage, ResourceDefinitions } from '@rawdash/core';

import type { InvariantViolation } from './invariants';
import { snapshotStorage } from './invariants';

type ObservedShape = 'entity' | 'event' | 'metric';

function observedShapes(
  storage: InMemoryStorage,
  connectorId: string,
): Map<string, Set<ObservedShape>> {
  const snap = snapshotStorage(storage, connectorId);
  const observed = new Map<string, Set<ObservedShape>>();
  const add = (name: string, shape: ObservedShape): void => {
    const set = observed.get(name) ?? new Set<ObservedShape>();
    set.add(shape);
    observed.set(name, set);
  };
  for (const e of snap.entities) {
    add(e.type, 'entity');
  }
  for (const ev of snap.events) {
    add(ev.name, 'event');
  }
  for (const m of snap.metrics) {
    add(m.name, 'metric');
  }
  return observed;
}

export function connectorResourceShapeViolations(
  resources: ResourceDefinitions,
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] {
  const observed = observedShapes(storage, connectorId);
  const declared = new Map<string, string>(
    Object.entries(resources).map(([name, r]) => [name, r.shape]),
  );
  const dynamicShapes = new Set(
    Object.values(resources)
      .filter((r) => r.dynamic)
      .map((r) => r.shape),
  );

  const violations: InvariantViolation[] = [];
  for (const [name, shapes] of observed) {
    const declaredShape = declared.get(name);
    for (const shape of shapes) {
      if (declaredShape === undefined) {
        if (dynamicShapes.has(shape)) {
          continue;
        }
        violations.push({
          invariant: 'every stored resource is declared in `resources`',
          location: `${connectorId} resource "${name}"`,
          detail: `wrote a ${shape} named "${name}" with no matching resource definition`,
        });
      } else if (declaredShape !== shape) {
        violations.push({
          invariant: 'resource `shape` matches the written storage shape',
          location: `${connectorId} resource "${name}"`,
          detail: `declared shape "${declaredShape}" but wrote "${shape}"`,
        });
      }
    }
  }
  return violations;
}

export function assertConnectorResourceShapes(
  resources: ResourceDefinitions,
  storage: InMemoryStorage,
  connectorId: string,
): void {
  const violations = connectorResourceShapeViolations(
    resources,
    storage,
    connectorId,
  );
  if (violations.length > 0) {
    throw new Error(
      `Connector "${connectorId}" resource/storage shape mismatch:\n  - ${violations
        .map((v) => `${v.invariant}: ${v.detail}`)
        .join('\n  - ')}`,
    );
  }
}
