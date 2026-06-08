import type { ConnectorClass } from '@rawdash/core';

import { connectorLoaders } from './registry.generated';

export { connectorLoaders } from './registry.generated';

export const connectorIds: string[] = Object.keys(connectorLoaders).sort();

export async function loadConnector(id: string): Promise<ConnectorClass> {
  const loader = connectorLoaders[id];
  if (!loader) {
    throw new Error(
      `Unknown connector id "${id}". Known ids: ${connectorIds.join(', ')}.`,
    );
  }
  return loader();
}
