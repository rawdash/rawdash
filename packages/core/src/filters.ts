export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains';

export interface FilterCondition {
  field: string;
  op: FilterOperator;
  value: string | number | boolean;
}

export type FilterClause = FilterCondition | { or: FilterCondition[] };
