import type {
  ConnectorCost,
  ConnectorDoc,
  ResourceDefinitions,
} from '@rawdash/core';
import type { z } from 'zod';

/**
 * Build-time metadata for a single connector, aggregated into the umbrella
 * package so consumers (e.g. the cloud connector catalog) can enumerate every
 * connector without depending on each `@rawdash/connector-*` package
 * individually.
 *
 * This is the *metadata-only* view: it carries the display/config/cost
 * descriptors a catalog needs, never the runnable connector class or its sync
 * logic. To instantiate a connector, use the lazy loaders from
 * `@rawdash/connectors/registry` instead.
 */
export interface ConnectorMetadata {
  /** The connector's stable id (the class's `static id`), e.g. `github-actions`. */
  id: string;
  /** The npm package the connector ships in, e.g. `@rawdash/connector-github`. */
  packageName: string;
  /** Display name, category, auth, vendor, per-resource docs, etc. */
  doc: ConnectorDoc;
  /** Zod schema describing the connector's configuration fields. */
  configFields: z.ZodObject<z.ZodRawShape>;
  /** Per-resource definitions (shape, docs, response schemas). */
  resources: ResourceDefinitions;
  /** Optional cost / recommended-frequency signal. */
  cost?: ConnectorCost;
}
