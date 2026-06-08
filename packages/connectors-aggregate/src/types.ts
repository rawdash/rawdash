import type {
  ConnectorCost,
  ConnectorDoc,
  ResourceDefinitions,
} from '@rawdash/core';
import type { z } from 'zod';

export interface ConnectorMetadata {
  id: string;
  packageName: string;
  doc: ConnectorDoc;
  configFields: z.ZodObject<z.ZodRawShape>;
  resources: ResourceDefinitions;
  cost?: ConnectorCost;
}
