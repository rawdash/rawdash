import type { ComputedMetric } from '@rawdash/core';
import { computeMetric } from '@rawdash/core';

import type { McpRuntime } from '../runtime-config';
import type { McpServerOptions } from '../types';

export interface ResolvedMcpSeries {
  key: string;
  connectorId: string;
  label: string;
  data: unknown;
}

export type ResolveSeriesResult =
  | { ok: true; series: ResolvedMcpSeries[] }
  | { ok: false; connectorId: string };

export async function resolveMcpSeries(
  metrics: readonly ComputedMetric[],
  runtime: McpRuntime,
  storage: McpServerOptions['storage'],
): Promise<ResolveSeriesResult> {
  const knownNames = new Set(runtime.getConnectors().map((e) => e.name));
  const missing = metrics.find((m) => !knownNames.has(m.connectorId));
  if (missing) {
    return { ok: false, connectorId: missing.connectorId };
  }
  const series = await Promise.all(
    metrics.map(async (metric) => ({
      key: metric.label ?? metric.connectorId,
      connectorId: metric.connectorId,
      label: metric.label ?? metric.connectorId,
      data: await computeMetric(
        storage.getStorageHandle(metric.connectorId),
        metric,
      ),
    })),
  );
  return { ok: true, series };
}
