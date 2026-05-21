import * as fc from 'fast-check';
import type { z } from 'zod';

interface ZodInternal {
  _zod: { def: ZodDef };
}

type ZodDef =
  | {
      type: 'string';
      format?: string | null;
      minLength?: number | null;
      maxLength?: number | null;
      checks?: Array<{
        _zod?: {
          def?: {
            check?: string;
            format?: string;
            minimum?: number;
            maximum?: number;
          };
        };
      }>;
    }
  | {
      type: 'number';
      format?: string | null;
      checks?: Array<{
        _zod?: {
          def?: {
            check?: string;
            format?: string;
            minimum?: number;
            maximum?: number;
            value?: number;
            inclusive?: boolean;
          };
        };
      }>;
    }
  | { type: 'int' }
  | { type: 'bigint' }
  | { type: 'boolean' }
  | { type: 'null' }
  | { type: 'undefined' }
  | { type: 'any' }
  | { type: 'unknown' }
  | { type: 'literal'; values: ReadonlyArray<string | number | boolean | null> }
  | { type: 'enum'; entries: Record<string, string | number> }
  | {
      type: 'array';
      element: ZodInternal;
      checks?: Array<{
        _zod?: {
          def?: { check?: string; minimum?: number; maximum?: number };
        };
      }>;
    }
  | { type: 'tuple'; items: ZodInternal[]; rest?: ZodInternal | null }
  | { type: 'object'; shape: Record<string, ZodInternal> }
  | { type: 'union'; options: ZodInternal[] }
  | { type: 'intersection'; left: ZodInternal; right: ZodInternal }
  | { type: 'optional'; innerType: ZodInternal }
  | { type: 'nullable'; innerType: ZodInternal }
  | { type: 'default'; innerType: ZodInternal; defaultValue: unknown }
  | { type: 'record'; keyType: ZodInternal; valueType: ZodInternal }
  | { type: 'nonoptional'; innerType: ZodInternal }
  | { type: 'readonly'; innerType: ZodInternal }
  | { type: 'pipe'; in: ZodInternal; out: ZodInternal }
  | { type: 'lazy'; getter: () => ZodInternal };

function getDef(schema: unknown): ZodDef {
  const internal = schema as ZodInternal;
  const def = internal?._zod?.def;
  if (!def || typeof def !== 'object' || !('type' in def)) {
    throw new Error(
      `zodToArbitrary: cannot read _zod.def from schema (got ${typeof schema}). Are you on zod >= 4?`,
    );
  }
  return def as ZodDef;
}

function stringFormatArb(
  format: string | undefined | null,
): fc.Arbitrary<string> {
  switch (format) {
    case 'datetime':
      return fc
        .date({
          min: new Date('1970-01-01T00:00:00.000Z'),
          max: new Date('2100-01-01T00:00:00.000Z'),
          noInvalidDate: true,
        })
        .map((d) => d.toISOString());
    case 'date':
      return fc
        .date({
          min: new Date('1970-01-01T00:00:00.000Z'),
          max: new Date('2100-01-01T00:00:00.000Z'),
          noInvalidDate: true,
        })
        .map((d) => d.toISOString().slice(0, 10));
    case 'email':
      return fc.emailAddress();
    case 'uuid':
      return fc.uuid();
    case 'url':
      return fc.webUrl();
    default:
      return fc.string({ minLength: 0, maxLength: 32 });
  }
}

function stringArb(
  def: Extract<ZodDef, { type: 'string' }>,
): fc.Arbitrary<string> {
  const formatCheck = def.checks?.find(
    (c) => c?._zod?.def?.check === 'string_format',
  );
  const format = formatCheck?._zod?.def?.format ?? def.format ?? null;
  if (format === 'regex') {
    const pattern = (formatCheck?._zod?.def as { pattern?: RegExp } | undefined)
      ?.pattern;
    if (pattern instanceof RegExp) {
      return fc.stringMatching(pattern);
    }
  }
  const minCheck = def.checks?.find(
    (c) => c?._zod?.def?.check === 'min_length',
  );
  const maxCheck = def.checks?.find(
    (c) => c?._zod?.def?.check === 'max_length',
  );
  const min = Math.max(def.minLength ?? 0, minCheck?._zod?.def?.minimum ?? 0);
  const max = Math.max(
    min,
    Math.min(def.maxLength ?? 32, maxCheck?._zod?.def?.maximum ?? 32),
  );
  if (format !== null) {
    return stringFormatArb(format);
  }
  return fc.string({ minLength: min, maxLength: Math.max(min, max) });
}

function numberArb(
  def: Extract<ZodDef, { type: 'number' }>,
): fc.Arbitrary<number> {
  const formatCheck = def.checks?.find(
    (c) => c?._zod?.def?.format !== undefined,
  );
  const format = formatCheck?._zod?.def?.format ?? def.format ?? null;
  let min = -1_000_000;
  let max = 1_000_000;
  for (const c of def.checks ?? []) {
    const cdef = c?._zod?.def as
      | {
          check?: string;
          value?: number;
          inclusive?: boolean;
        }
      | undefined;
    if (!cdef || typeof cdef.value !== 'number') {
      continue;
    }
    if (cdef.check === 'greater_than') {
      const candidate = cdef.inclusive ? cdef.value : cdef.value + 1;
      if (candidate > min) {
        min = candidate;
      }
    } else if (cdef.check === 'less_than') {
      const candidate = cdef.inclusive ? cdef.value : cdef.value - 1;
      if (candidate < max) {
        max = candidate;
      }
    }
  }
  if (max < min) {
    max = min;
  }
  if (format === 'safeint' || format === 'int32' || format === 'int') {
    return fc.integer({ min, max });
  }
  return fc.double({
    noNaN: true,
    noDefaultInfinity: true,
    min,
    max,
  });
}

export function zodToArbitrary<T>(schema: z.ZodType<T>): fc.Arbitrary<T> {
  return zodToArbitraryInternal(schema as unknown) as fc.Arbitrary<T>;
}

function zodToArbitraryInternal(schema: unknown): fc.Arbitrary<unknown> {
  const def = getDef(schema);
  switch (def.type) {
    case 'string':
      return stringArb(def);
    case 'number':
      return numberArb(def);
    case 'int':
      return fc.integer({ min: -1_000_000, max: 1_000_000 });
    case 'bigint':
      return fc.bigInt({ min: -1_000_000n, max: 1_000_000n });
    case 'boolean':
      return fc.boolean();
    case 'null':
      return fc.constant(null);
    case 'undefined':
      return fc.constant(undefined);
    case 'any':
    case 'unknown':
      return fc.anything();
    case 'literal':
      return fc.constantFrom(...(def.values as readonly unknown[]));
    case 'enum':
      return fc.constantFrom(...Object.values(def.entries));
    case 'array': {
      let arrMin = 0;
      let arrMax = 5;
      for (const c of def.checks ?? []) {
        const cdef = c?._zod?.def;
        if (cdef?.check === 'min_length' && typeof cdef.minimum === 'number') {
          arrMin = Math.max(arrMin, cdef.minimum);
        }
        if (cdef?.check === 'max_length' && typeof cdef.maximum === 'number') {
          arrMax = Math.min(arrMax, cdef.maximum);
        }
      }
      if (arrMax < arrMin) {
        arrMax = arrMin;
      }
      return fc.array(zodToArbitraryInternal(def.element), {
        minLength: arrMin,
        maxLength: Math.max(arrMin, arrMax),
      });
    }
    case 'tuple': {
      const itemArbs = def.items.map(zodToArbitraryInternal);
      return fc.tuple(...itemArbs);
    }
    case 'object': {
      const shape = def.shape;
      const entries = Object.entries(shape).map(
        ([k, v]) => [k, zodToArbitraryInternal(v)] as const,
      );
      const recordShape: Record<string, fc.Arbitrary<unknown>> = {};
      for (const [k, arb] of entries) {
        recordShape[k] = arb;
      }
      return fc.record(recordShape);
    }
    case 'union':
      return fc.oneof(...def.options.map(zodToArbitraryInternal));
    case 'optional':
      return fc.oneof(
        { weight: 3, arbitrary: zodToArbitraryInternal(def.innerType) },
        { weight: 1, arbitrary: fc.constant(undefined) },
      );
    case 'nullable':
      return fc.oneof(
        { weight: 3, arbitrary: zodToArbitraryInternal(def.innerType) },
        { weight: 1, arbitrary: fc.constant(null) },
      );
    case 'default':
    case 'nonoptional':
    case 'readonly':
      return zodToArbitraryInternal(def.innerType);
    case 'pipe':
      return zodToArbitraryInternal(def.out);
    case 'record':
      return fc.dictionary(
        zodToArbitraryInternal(def.keyType) as fc.Arbitrary<string>,
        zodToArbitraryInternal(def.valueType),
        { maxKeys: 4 },
      );
    case 'lazy':
      return fc.constant(undefined);
    case 'intersection': {
      const left = zodToArbitraryInternal(def.left);
      const right = zodToArbitraryInternal(def.right);
      return fc.tuple(left, right).map(([l, r]) => {
        if (
          typeof l === 'object' &&
          l !== null &&
          typeof r === 'object' &&
          r !== null
        ) {
          return { ...(l as object), ...(r as object) };
        }
        return r;
      });
    }
    default: {
      const exhaustive: never = def;
      throw new Error(
        `zodToArbitrary: unsupported zod type ${String((exhaustive as { type?: string }).type)}`,
      );
    }
  }
}
