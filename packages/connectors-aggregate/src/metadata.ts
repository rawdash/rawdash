import { connectorMetadata } from './metadata.generated';
import type { ConnectorMetadata } from './types';

export type { ConnectorMetadata } from './types';

/**
 * Every built-in connector's build-time metadata, generated from the connector
 * packages in this monorepo. Ordered by connector id.
 *
 * Importing this entry point pulls connector *metadata* only — distinct from
 * `@rawdash/connectors/registry`, which exposes the runnable connector classes
 * behind per-connector lazy loaders. Keep the two apart so a metadata consumer
 * (such as the cloud connector catalog) never bundles connector sync logic.
 */
export { connectorMetadata } from './metadata.generated';

/** The same metadata, keyed by connector id for direct lookup. */
export const connectorMetadataById: Record<string, ConnectorMetadata> =
  Object.fromEntries(connectorMetadata.map((m) => [m.id, m]));
