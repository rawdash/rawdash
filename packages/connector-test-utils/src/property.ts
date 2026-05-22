import { InMemoryStorage } from '@rawdash/core';
import * as fc from 'fast-check';
import type { z } from 'zod';

import {
  type InvariantViolation,
  checkUniversalInvariants,
  formatViolations,
} from './invariants';
import { zodToArbitrary } from './zod-to-arbitrary';

interface ConnectorClassWithSchemas {
  readonly name?: string;
  readonly schemas: Readonly<Record<string, z.ZodType>>;
}

interface BasePropertySyncTestOptions<T> {
  connectorId: string;
  run: (sample: T, storage: InMemoryStorage) => Promise<void>;
  runs?: number;
  seed?: number;
  extraInvariants?: Array<
    (
      storage: InMemoryStorage,
      connectorId: string,
      sample: T,
    ) => InvariantViolation[] | Promise<InvariantViolation[]>
  >;
}

export type PropertySyncTestOptions<T> = BasePropertySyncTestOptions<T> &
  (
    | { schema: z.ZodType<T>; connectorClass?: never; resource?: never }
    | {
        connectorClass: ConnectorClassWithSchemas;
        resource: string;
        schema?: never;
      }
  );

function resolveSchema<T>(opts: PropertySyncTestOptions<T>): z.ZodType<T> {
  if ('schema' in opts && opts.schema) {
    return opts.schema;
  }
  const { connectorClass, resource } = opts as {
    connectorClass: ConnectorClassWithSchemas;
    resource: string;
  };
  const schema = connectorClass.schemas[resource];
  if (!schema) {
    const available =
      Object.keys(connectorClass.schemas).join(', ') || '<none>';
    throw new Error(
      `${connectorClass.name ?? 'connector'}.schemas has no entry for resource "${resource}". Available: ${available}`,
    );
  }
  return schema as z.ZodType<T>;
}

export async function runPropertySyncTest<T>(
  opts: PropertySyncTestOptions<T>,
): Promise<void> {
  const schema = resolveSchema(opts);
  const arb = zodToArbitrary(schema);
  const extras = opts.extraInvariants ?? [];

  await fc.assert(
    fc.asyncProperty(arb, async (rawSample) => {
      const parsed = schema.safeParse(rawSample);
      if (!parsed.success) {
        throw new Error(
          `zodToArbitrary generated a value rejected by its own schema (this is a bug in zodToArbitrary's coverage of the schema's constraints): ${parsed.error.message}\nsample=${JSON.stringify(rawSample).slice(0, 500)}`,
        );
      }
      const sample = parsed.data as T;
      const storage = new InMemoryStorage();
      try {
        await opts.run(sample, storage);
      } catch (err) {
        throw new Error(
          `connector.sync threw on a valid sample (invariant: does not throw on any valid instance): ${err instanceof Error ? err.message : String(err)}\nsample=${JSON.stringify(sample).slice(0, 500)}`,
          { cause: err },
        );
      }
      const violations = checkUniversalInvariants(storage, opts.connectorId);
      for (const extra of extras) {
        violations.push(...(await extra(storage, opts.connectorId, sample)));
      }
      if (violations.length > 0) {
        throw new Error(
          `sync invariants violated (${violations.length}):\n${formatViolations(violations)}\nsample=${JSON.stringify(sample).slice(0, 500)}`,
        );
      }
    }),
    {
      numRuns: opts.runs ?? 100,
      seed: opts.seed,
      verbose: true,
    },
  );
}

export { fc };
