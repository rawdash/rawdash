import { z } from 'zod';

import { readOnlySqlIssues } from './sql-guard';

export const QUERY_SHAPES = [
  'stat',
  'timeseries',
  'distribution',
  'entities',
] as const;

export type QueryShape = (typeof QUERY_SHAPES)[number];

export const DEFAULT_STATEMENT_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_ROWS_PER_QUERY = 5_000;
export const DEFAULT_LOOKBACK_DAYS = 30;
export const MAX_STATEMENT_TIMEOUT_MS = 300_000;
export const MAX_ROWS_CEILING = 100_000;

const columnsSchema = z
  .object({
    value: z.string().min(1).optional(),
    ts: z.string().min(1).optional(),
    series: z.string().min(1).optional(),
    id: z.string().min(1).optional(),
    updatedAt: z.string().min(1).optional(),
  })
  .optional();

export const queryDefinitionSchema = z.object({
  id: z
    .string()
    .regex(
      /^[a-z][a-z0-9_]*$/,
      'Query id must start with a lowercase letter and contain only lowercase letters, digits, and underscores',
    ),
  sql: z
    .string()
    .min(1)
    .superRefine((sql, ctx) => {
      for (const message of readOnlySqlIssues(sql)) {
        ctx.addIssue({ code: 'custom', message });
      }
    }),
  shape: z.enum(QUERY_SHAPES),
  name: z.string().min(1).optional(),
  columns: columnsSchema,
  statementTimeoutMs: z
    .number()
    .int()
    .positive()
    .max(MAX_STATEMENT_TIMEOUT_MS)
    .optional(),
  maxRows: z.number().int().positive().max(MAX_ROWS_CEILING).optional(),
});

export type QueryDefinition = z.infer<typeof queryDefinitionSchema>;

export const queryRunnerConfigShape = {
  queries: z.array(queryDefinitionSchema).nonempty().meta({
    label: 'Queries',
    description:
      'The SQL to run on every sync. Each entry needs an id, a read-only single-statement SQL query, and a shape (`stat`, `timeseries`, `distribution`, or `entities`) that decides how the result rows are projected into storage. Optional `columns` remaps the expected column names, and `name` overrides the metric name / entity type (defaults to the query id).',
  }),
  statementTimeoutMs: z
    .number()
    .int()
    .positive()
    .max(MAX_STATEMENT_TIMEOUT_MS)
    .optional()
    .meta({
      label: 'Statement timeout (ms)',
      description: `Server-side statement timeout applied to every query. Defaults to ${DEFAULT_STATEMENT_TIMEOUT_MS}. A per-query \`statementTimeoutMs\` overrides it.`,
      placeholder: String(DEFAULT_STATEMENT_TIMEOUT_MS),
    }),
  maxRowsPerQuery: z
    .number()
    .int()
    .positive()
    .max(MAX_ROWS_CEILING)
    .optional()
    .meta({
      label: 'Max rows per query',
      description: `Row ceiling per query; a query returning more rows fails instead of silently truncating. Defaults to ${DEFAULT_MAX_ROWS_PER_QUERY}. A per-query \`maxRows\` overrides it.`,
      placeholder: String(DEFAULT_MAX_ROWS_PER_QUERY),
    }),
  lookbackDays: z
    .number()
    .int()
    .positive()
    .optional()
    .meta({
      label: 'Lookback days',
      description: `How far back the sync window starts when the host does not supply a since bound, for queries that reference the $1 window-start placeholder. Defaults to ${DEFAULT_LOOKBACK_DAYS}.`,
      placeholder: String(DEFAULT_LOOKBACK_DAYS),
    }),
} as const;

export const uniqueQueryIdsRefine = {
  predicate: (cfg: { queries: readonly QueryDefinition[] }): boolean =>
    new Set(cfg.queries.map((q) => q.id)).size === cfg.queries.length,
  message: 'Each query id must be unique',
};

export const uniqueQueryNamesRefine = {
  predicate: (cfg: { queries: readonly QueryDefinition[] }): boolean => {
    const names = cfg.queries.map((q) => resourceNameOf(q));
    return new Set(names).size === names.length;
  },
  message:
    'Each query must write to a distinct resource name; two queries resolve to the same name (set `name` explicitly to disambiguate)',
};

export function resourceNameOf(query: QueryDefinition): string {
  return query.name ?? query.id;
}

export interface QueryRunnerSettings {
  queries: QueryDefinition[];
  statementTimeoutMs?: number;
  maxRowsPerQuery?: number;
  lookbackDays?: number;
}
