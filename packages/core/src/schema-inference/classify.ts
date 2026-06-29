import type { Schema } from './types';

export type DriftSeverity = 'breaking' | 'noise';

export type ValidationErrorKind =
  | 'type-mismatch'
  | 'missing-required-field'
  | 'value-not-in-enum';

export interface ValidationError {
  path: string;
  kind: ValidationErrorKind;
  detail: Record<string, unknown>;
}

export interface ValidationResult {
  severity: DriftSeverity;
  errors: ValidationError[];
}

export function validateObserved(
  baseline: Schema,
  observed: Schema,
): ValidationResult {
  const errors: ValidationError[] = [];
  check(baseline, observed, '$', errors);
  return { severity: errors.length > 0 ? 'breaking' : 'noise', errors };
}

function check(
  baseline: Schema,
  observed: Schema,
  path: string,
  errors: ValidationError[],
): void {
  if (observed.type === 'union') {
    for (const member of observed.anyOf) {
      check(baseline, member, path, errors);
    }
    return;
  }

  if (baseline.type === 'union') {
    const candidates = baseline.anyOf.filter((b) => b.type === observed.type);
    if (candidates.length === 0) {
      errors.push({
        path,
        kind: 'type-mismatch',
        detail: { expected: kindOf(baseline), observed: kindOf(observed) },
      });
      return;
    }
    let fewestErrors: ValidationError[] | null = null;
    for (const candidate of candidates) {
      const candidateErrors: ValidationError[] = [];
      check(candidate, observed, path, candidateErrors);
      if (candidateErrors.length === 0) {
        return;
      }
      if (
        fewestErrors === null ||
        candidateErrors.length < fewestErrors.length
      ) {
        fewestErrors = candidateErrors;
      }
    }
    if (fewestErrors !== null) {
      errors.push(...fewestErrors);
    }
    return;
  }

  if (baseline.type !== observed.type) {
    errors.push({
      path,
      kind: 'type-mismatch',
      detail: { expected: kindOf(baseline), observed: kindOf(observed) },
    });
    return;
  }

  if (baseline.type === 'object' && observed.type === 'object') {
    checkObject(baseline, observed, path, errors);
    return;
  }
  if (baseline.type === 'array' && observed.type === 'array') {
    if (baseline.items !== undefined && observed.items !== undefined) {
      check(baseline.items, observed.items, `${path}[*]`, errors);
    }
    return;
  }
  if (baseline.type === 'string' && observed.type === 'string') {
    checkEnum(baseline, observed, path, errors);
  }
}

function checkObject(
  baseline: Extract<Schema, { type: 'object' }>,
  observed: Extract<Schema, { type: 'object' }>,
  path: string,
  errors: ValidationError[],
): void {
  const baseRequired = new Set(baseline.required);
  for (const [key, baseChild] of Object.entries(baseline.properties)) {
    const childPath = joinPath(path, key);
    const obsChild = observed.properties[key];
    if (obsChild === undefined) {
      if (baseRequired.has(key)) {
        errors.push({
          path: childPath,
          kind: 'missing-required-field',
          detail: {},
        });
      }
      continue;
    }
    check(baseChild, obsChild, childPath, errors);
  }
}

function checkEnum(
  baseline: Extract<Schema, { type: 'string' }>,
  observed: Extract<Schema, { type: 'string' }>,
  path: string,
  errors: ValidationError[],
): void {
  if (baseline.freeform || baseline.enum === undefined) {
    return;
  }
  if (observed.freeform || observed.enum === undefined) {
    return;
  }
  const allowed = new Set(baseline.enum);
  const unexpected = observed.enum.filter((v) => !allowed.has(v));
  if (unexpected.length > 0) {
    errors.push({
      path,
      kind: 'value-not-in-enum',
      detail: { values: [...unexpected].sort(), allowed: [...baseline.enum] },
    });
  }
}

function kindOf(schema: Schema): string {
  if (schema.type === 'union') {
    const inner = schema.anyOf.map(kindOf).sort();
    return `union(${inner.join('|')})`;
  }
  return schema.type;
}

function joinPath(parent: string, key: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return `${parent}.${key}`;
  }
  return `${parent}[${JSON.stringify(key)}]`;
}
