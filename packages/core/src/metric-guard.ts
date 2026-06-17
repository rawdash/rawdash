import type { MetricSample, StorageHandle } from './connector';
import type { ResourceDefinitions } from './resource';

const RESERVED_METRIC_FIELDS = new Set(['name', 'ts', 'value']);

function declaredAttributeKeys(
  resources: ResourceDefinitions,
): Map<string, Set<string>> {
  const byName = new Map<string, Set<string>>();
  for (const [name, def] of Object.entries(resources)) {
    if (def.shape !== 'metric') {
      continue;
    }
    const keys = new Set<string>();
    for (const dim of def.dimensions ?? []) {
      keys.add(dim.name);
    }
    for (const measure of def.measures ?? []) {
      keys.add(measure.name);
    }
    byName.set(name, keys);
  }
  return byName;
}

export function withMetricResourceGuard(
  handle: StorageHandle,
  resources: ResourceDefinitions,
  warn: (message: string) => void = (m) => console.warn(m),
): StorageHandle {
  const declared = declaredAttributeKeys(resources);
  if (declared.size === 0) {
    return handle;
  }

  const sanitize = (m: MetricSample): MetricSample | null => {
    if (typeof m.value !== 'number' || !Number.isFinite(m.value)) {
      warn(
        `[rawdash storage] dropping metric "${m.name}" sample with non-finite value ${JSON.stringify(m.value)}`,
      );
      return null;
    }
    const allowed = declared.get(m.name);
    if (!allowed) {
      return m;
    }
    let stripped: Record<string, MetricSample['attributes'][string]> | null =
      null;
    for (const key of Object.keys(m.attributes)) {
      if (allowed.has(key) && !RESERVED_METRIC_FIELDS.has(key)) {
        continue;
      }
      if (stripped === null) {
        stripped = { ...m.attributes };
      }
      delete stripped[key];
      warn(
        `[rawdash storage] stripping undeclared attribute "${key}" from metric "${m.name}" (not a declared dimension or measure)`,
      );
    }
    return stripped === null ? m : { ...m, attributes: stripped };
  };

  return {
    ...handle,
    metric: async (m) => {
      const sanitized = sanitize(m);
      if (sanitized !== null) {
        await handle.metric(sanitized);
      }
    },
    metrics: async (ms, scope) => {
      const sanitized = ms
        .map(sanitize)
        .filter((m): m is MetricSample => m !== null);
      await handle.metrics(sanitized, scope);
    },
  };
}
