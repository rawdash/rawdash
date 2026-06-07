import { z } from 'zod';

// ---------------------------------------------------------------------------
// Connector documentation metadata
// ---------------------------------------------------------------------------
//
// `defineConnectorDoc` declares the connector-level, human-facing parts of a
// connector that cannot be derived from code (`configFields`, `schemas`,
// `credentials`). A single generator renders this metadata, merged with the
// derived parts and the connector's per-resource definitions (see
// `defineResources` in `./resource`), into both the package README and the
// Cloud docs site, so the docs can never be hand-written out of sync.
//
// Per-resource documentation lives with each resource in `static resources`
// on the connector class, not here. The runnable example lives in a
// type-checked `examples/<id>.config.ts` file, not here.

export const connectorCategorySchema = z.enum([
  'engineering',
  'product',
  'analytics',
  'marketing',
  'sales',
  'support',
  'finance',
  'infrastructure',
  'security',
  'hr',
]);

export type ConnectorCategory = z.infer<typeof connectorCategorySchema>;

export const connectorDocSchema = z.object({
  displayName: z.string().min(1),
  category: connectorCategorySchema,
  tagline: z.string().min(1),
  // Brand accent color (hex) for the connector's docs/landing card. The icon
  // itself is a committed `icon.svg` co-located in the connector package.
  brandColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  vendor: z.object({
    name: z.string().min(1),
    apiDocs: z.url().optional(),
    website: z.url().optional(),
  }),
  auth: z.object({
    summary: z.string().min(1),
    setup: z.array(z.string().min(1)),
  }),
  // Upstream API rate-limit / quota notes worth surfacing (e.g. "GA4 Data API:
  // 200k tokens/day per property"). Free text, rendered in docs.
  rateLimit: z.string().min(1).optional(),
  // Operational caveats / out-of-scope notes (API ceilings, sampling, Cloud-only,
  // data revision windows, etc.).
  limitations: z.array(z.string().min(1)).optional(),
});

export type ConnectorDoc = z.infer<typeof connectorDocSchema>;

/**
 * Declare a connector's documentation metadata. Validates the shape at module
 * load so a malformed `doc` fails fast (and fails the package's tests), and
 * returns the typed object for the generator to consume.
 */
export function defineConnectorDoc(doc: ConnectorDoc): ConnectorDoc {
  return connectorDocSchema.parse(doc);
}
