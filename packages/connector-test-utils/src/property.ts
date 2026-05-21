import { InMemoryStorage } from '@rawdash/core';
import * as fc from 'fast-check';
import type { z } from 'zod';

import {
  type InvariantViolation,
  checkUniversalInvariants,
  formatViolations,
} from './invariants';
import { zodToArbitrary } from './zod-to-arbitrary';

export interface PropertySyncTestOptions<T> {
  schema: z.ZodType<T>;
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

export async function runPropertySyncTest<T>(
  opts: PropertySyncTestOptions<T>,
): Promise<void> {
  const arb = zodToArbitrary(opts.schema);
  const extras = opts.extraInvariants ?? [];

  await fc.assert(
    fc.asyncProperty(arb, async (sample) => {
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
