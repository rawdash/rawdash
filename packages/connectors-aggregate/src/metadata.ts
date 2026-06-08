import { connectorMetadata } from './metadata.generated';
import type { ConnectorMetadata } from './types';

export type { ConnectorMetadata } from './types';

export { connectorMetadata } from './metadata.generated';

export const connectorMetadataById: Record<string, ConnectorMetadata> =
  Object.fromEntries(connectorMetadata.map((m) => [m.id, m]));
