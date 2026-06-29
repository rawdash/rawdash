export { infer } from './infer';
export { merge } from './merge';
export { canonicalize, fingerprint, stableStringify } from './fingerprint';
export { diff } from './diff';
export { validateObserved } from './classify';
export type {
  DriftSeverity,
  ValidationError,
  ValidationErrorKind,
  ValidationResult,
} from './classify';
export type {
  ArraySchema,
  BooleanSchema,
  DiffEntry,
  DiffKind,
  JsonValue,
  NullSchema,
  NumberSchema,
  ObjectSchema,
  PrimitiveType,
  Schema,
  StringSchema,
  UnionSchema,
} from './types';
export { ENUM_CANDIDATE_CAP } from './types';
