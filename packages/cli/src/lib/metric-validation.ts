import type { DashboardConfig, ResourcesByConnectorId } from '@rawdash/core';
import { validateConfigMetrics } from '@rawdash/core';

import { printError, printWarning } from './output';

async function loadResourcesByConnectorId(): Promise<ResourcesByConnectorId> {
  const { connectorMetadataById } =
    await import('@rawdash/connectors/metadata');
  const out: Record<string, ResourcesByConnectorId[string]> = {};
  for (const [id, metadata] of Object.entries(connectorMetadataById)) {
    out[id] = metadata.resources;
  }
  return out;
}

export async function validateMetricsOrThrow(
  config: DashboardConfig,
): Promise<void> {
  const resourcesByConnectorId = await loadResourcesByConnectorId();
  const { errors, warnings } = validateConfigMetrics(
    config,
    resourcesByConnectorId,
  );

  for (const warning of warnings) {
    printWarning(`${warning.ref}: ${warning.message}`);
  }

  if (errors.length > 0) {
    for (const error of errors) {
      printError(`${error.ref}: ${error.message}`);
    }
    throw new Error(
      `${errors.length} metric validation ${
        errors.length === 1 ? 'error' : 'errors'
      } — see above.`,
    );
  }
}
