export const ENUM_CANDIDATE_CAP = 32;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type PrimitiveType = 'string' | 'number' | 'boolean' | 'null';

export type StringSchema = {
  type: 'string';
  enum?: string[];
  freeform?: boolean;
};

export type NumberSchema = { type: 'number' };
export type BooleanSchema = { type: 'boolean' };
export type NullSchema = { type: 'null' };

export type ObjectSchema = {
  type: 'object';
  properties: Record<string, Schema>;
  required: string[];
};

export type ArraySchema = {
  type: 'array';
  items?: Schema;
};

export type UnionSchema = {
  type: 'union';
  anyOf: Schema[];
};

export type Schema =
  | StringSchema
  | NumberSchema
  | BooleanSchema
  | NullSchema
  | ObjectSchema
  | ArraySchema
  | UnionSchema;

export type DiffKind =
  | 'type-change'
  | 'new-field'
  | 'removed-field'
  | 'required-became-optional'
  | 'optional-became-required'
  | 'new-enum-value';

export type DiffEntry = {
  path: string;
  kind: DiffKind;
  detail: Record<string, unknown>;
};
