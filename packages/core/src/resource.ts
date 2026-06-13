import type { z } from 'zod';

import type { Shape } from './config';
import type { FilterOperator } from './filters';
import type { ConnectorSchemas } from './registry';

export interface ResourceField {
  name: string;
  description: string;
  unit?: string;
}

export interface ResourceFilterField {
  field: string;
  ops: FilterOperator[];
  values?: (string | number)[];
}

interface ResourceDefBase {
  description: string;
  endpoint?: string;
  notes?: string;
  dynamic?: boolean;
  responses?: Readonly<Record<string, z.ZodType>>;
}

export type ResourceDefinition =
  | (ResourceDefBase & {
      shape: 'entity';
      fields?: ResourceField[];
      filterable: ResourceFilterField[];
    })
  | (ResourceDefBase & {
      shape: 'event';
      fields?: ResourceField[];
      filterable: ResourceFilterField[];
    })
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
    if (def.shape === 'entity' || def.shape === 'event') {
      if (!Array.isArray(def.filterable)) {
        throw new Error(
          `Resource "${name}" must declare a "filterable" array (use [] for no server-side filters).`,
        );
      }
      for (const entry of def.filterable) {
        if (!entry.field || entry.field.trim().length === 0) {
          throw new Error(
            `Resource "${name}" has a filterable entry with an empty "field".`,
          );
        }
        if (!Array.isArray(entry.ops) || entry.ops.length === 0) {
          throw new Error(
            `Resource "${name}" filterable field "${entry.field}" must declare at least one operator.`,
          );
        }
      }
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
