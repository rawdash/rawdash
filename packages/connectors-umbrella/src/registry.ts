import type { ConnectorClass } from '@rawdash/core';

import { connectorLoaders } from './registry.generated';

/**
 * Lazy loaders for every built-in connector, keyed by connector id. Each entry
 * dynamically imports its connector package and resolves to the connector
 * class (the module's default export).
 *
 * The per-connector dynamic `import()` preserves the lazy-load boundary:
 * resolving one connector never pulls the other connectors' class or sync code
 * into the same chunk. Consumers that only need metadata should use
 * `@rawdash/connectors/metadata` instead, which never touches this module.
 */
export { connectorLoaders } from './registry.generated';

/** Ids of every built-in connector, sorted. */
export const connectorIds: string[] = Object.keys(connectorLoaders).sort();

/**
 * Load a single connector class by id. Throws if the id is unknown.
 *
 * @example
 *   const GitHubConnector = await loadConnector('github-actions');
 */
export async function loadConnector(id: string): Promise<ConnectorClass> {
  const loader = connectorLoaders[id];
  if (!loader) {
    throw new Error(
      `Unknown connector id "${id}". Known ids: ${connectorIds.join(', ')}.`,
    );
  }
  return loader();
}
