import type { FilterClause, FilterCondition } from './filters';

export function matchesCondition(
  record: Record<string, unknown>,
  cond: FilterCondition,
): boolean {
  const val = record[cond.field];
  switch (cond.op) {
    case 'eq':
      return val === cond.value;
    case 'neq':
      return val !== cond.value;
    case 'gt':
      if (typeof val !== 'number' || typeof cond.value !== 'number') {
        return false;
      }
      return val > cond.value;
    case 'gte':
      if (typeof val !== 'number' || typeof cond.value !== 'number') {
        return false;
      }
      return val >= cond.value;
    case 'lt':
      if (typeof val !== 'number' || typeof cond.value !== 'number') {
        return false;
      }
      return val < cond.value;
    case 'lte':
      if (typeof val !== 'number' || typeof cond.value !== 'number') {
        return false;
      }
      return val <= cond.value;
    case 'contains':
      if (val === undefined || val === null) {
        return false;
      }
      return String(val).includes(String(cond.value));
    default:
      return false;
  }
}

export function applyFilter(
  record: Record<string, unknown>,
  filter: FilterClause[] | undefined,
): boolean {
  if (!filter) {
    return true;
  }
  for (const clause of filter) {
    if ('or' in clause) {
      if (!clause.or.some((cond) => matchesCondition(record, cond))) {
        return false;
      }
    } else {
      if (!matchesCondition(record, clause)) {
        return false;
      }
    }
  }
  return true;
}
