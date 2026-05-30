import type { z } from 'zod';

import type { Shape } from './config';
import type { ConnectorSchemas } from './registry';

// ---------------------------------------------------------------------------
// Resource definitions
// ---------------------------------------------------------------------------
//
// A connector declares each stored resource once, co-located, via
// `defineResources`. A resource definition carries everything about that
// resource in one place:
//   - its storage `shape` and a human description (for the generated docs)
//   - shape-specific doc fields (entity/event `fields`, metric `dimensions` +
//     `unit`/`granularity`, etc.)
//   - the raw API-response Zod schema(s) it is built from, under `responses`
//
// Stored resources and API responses are 1:N — e.g. a GitHub `pull_request`
// entity is assembled from the `pull_requests` and `pull_request_reviews`
// responses. `schemasFromResources` flattens every resource's `responses` into
// the flat `{ tag -> schema }` map the shape-drift pipeline and property tests
// consume (`ConnectorClass.schemas`), so the schema lives with its resource
// instead of in a second central map.

export interface ResourceField {
  name: string;
  description: string;
}

interface ResourceDefBase {
  description: string;
  endpoint?: string;
  notes?: string;
  // When true, the stored resource name(s) are user-defined (e.g. a CloudWatch
  // series named after the user's namespace/metric config), so docs/shape
  // enforcement treat this as a family rather than a fixed name.
  dynamic?: boolean;
  // Raw API-response schemas this resource is built from, keyed by the
  // `resource` tag passed to `request()` / `paginateChunked`. Merged into
  // `ConnectorClass.schemas`.
  responses?: Readonly<Record<string, z.ZodType>>;
}

export type ResourceDefinition =
  | (ResourceDefBase & { shape: 'entity'; fields?: ResourceField[] })
  | (ResourceDefBase & { shape: 'event'; fields?: ResourceField[] })
  | (ResourceDefBase & {
      shape: 'metric';
      unit?: string;
      granularity?: string;
      dimensions?: ResourceField[];
    })
  | (ResourceDefBase & {
      shape: 'distribution';
      kind?: 'buckets' | 'quantiles';
      unit?: string;
    })
  | (ResourceDefBase & { shape: 'edge'; from?: string; to?: string });

export type ResourceDefinitions = Readonly<Record<string, ResourceDefinition>>;

const SHAPES: ReadonlySet<Shape> = new Set([
  'entity',
  'event',
  'metric',
  'edge',
  'distribution',
]);

/**
 * Validate and return a connector's resource definitions. Call it once at
 * module scope and reference the result from both `static resources` and
 * `static schemas` on the connector class.
 */
export function defineResources<const T extends ResourceDefinitions>(
  defs: T,
): T {
  for (const [name, def] of Object.entries(defs)) {
    if (!name) {
      throw new Error('Resource name must be a non-empty string.');
    }
    if (!SHAPES.has(def.shape)) {
      throw new Error(
        `Resource "${name}" has invalid shape "${def.shape}". Expected one of: ${[...SHAPES].join(', ')}.`,
      );
    }
    if (!def.description || def.description.trim().length === 0) {
      throw new Error(`Resource "${name}" must have a non-empty description.`);
    }
  }
  return defs;
}

type UnionToIntersection<U> = (
  U extends unknown ? (x: U) => void : never
) extends (x: infer I) => void
  ? I
  : never;

type ResponsesOf<T extends ResourceDefinitions> = UnionToIntersection<
  {
    [K in keyof T]: T[K] extends { responses: infer R }
      ? R extends Readonly<Record<string, z.ZodType>>
        ? R
        : object
      : object;
  }[keyof T]
>;

/**
 * Flatten every resource definition's `responses` into the flat
 * `{ responseTag -> Zod schema }` map that `ConnectorClass.schemas` exposes for
 * the shape-drift baseline generator and property tests. The return type keeps
 * the exact per-tag schema types, so `z.infer<typeof schemas.<tag>>` works.
 */
export function schemasFromResources<const T extends ResourceDefinitions>(
  defs: T,
): ResponsesOf<T> & ConnectorSchemas {
  const out: Record<string, z.ZodType> = {};
  for (const [name, def] of Object.entries(defs)) {
    if (!def.responses) {
      continue;
    }
    for (const [tag, schema] of Object.entries(def.responses)) {
      if (out[tag]) {
        throw new Error(
          `Duplicate response schema tag "${tag}" (declared again on resource "${name}").`,
        );
      }
      out[tag] = schema;
    }
  }
  return out as ResponsesOf<T> & ConnectorSchemas;
}
