import { z } from 'zod';

export const widgetFormatSchema = z.object({
  kind: z.enum(['currency', 'number', 'percent', 'duration', 'bytes']),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  decimals: z.number().int().min(0).max(20).optional(),
  compact: z.boolean().optional(),
});

export const shapeSchema = z.enum([
  'event',
  'entity',
  'metric',
  'edge',
  'distribution',
]);

export const aggFnSchema = z.enum([
  'count',
  'sum',
  'avg',
  'min',
  'max',
  'latest',
  'first',
]);

export const filterOperatorSchema = z.enum([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
]);

export const filterConditionSchema = z.object({
  field: z.string(),
  op: filterOperatorSchema,
  value: z.union([z.string(), z.number(), z.boolean()]),
});

export const filterClauseSchema = z.union([
  filterConditionSchema,
  z.object({ or: z.array(filterConditionSchema) }),
]);

export const groupBySchema = z.object({
  field: z.string(),
  granularity: z.enum(['hour', 'day', 'week', 'month']),
});

export const computedMetricSchema = z
  .object({
    connectorId: z.string(),
    shape: shapeSchema,
    name: z.string().optional(),
    entityType: z.string().optional(),
    field: z.string().optional(),
    fn: aggFnSchema,
    window: z.string().optional(),
    filter: z.array(filterClauseSchema).optional(),
    groupBy: groupBySchema.optional(),
    label: z.string().optional(),
  })
  .refine((m) => m.fn === 'count' || m.field !== undefined, {
    message: 'field is required unless fn is "count"',
    path: ['field'],
  })
  .refine((m) => m.name !== undefined || m.entityType !== undefined, {
    message: 'either name or entityType is required to identify the data',
    path: ['name'],
  });

export const metricOrMetricsSchema = z.union([
  computedMetricSchema,
  z.array(computedMetricSchema).min(1),
]);

export const mergeFnSchema = z.enum(['count', 'sum', 'avg', 'min', 'max']);

export const metricAggregateSchema = z.object({
  fn: mergeFnSchema,
  label: z.string().optional(),
});

const titleField = z
  .string()
  .meta({ label: 'Title', description: 'Widget title.' });

const metricField = metricOrMetricsSchema.meta({
  label: 'Metric',
  description:
    'One computed metric, or an array of metrics (one per connector) for a multi-connector widget.',
});

const aggregateField = metricAggregateSchema.optional().meta({
  label: 'Aggregate',
  description:
    'Optional server-side merge of the per-connector series into a single combined value placed in data.',
});

export const statWidgetSchema = z.object({
  kind: z.literal('stat'),
  title: titleField,
  metric: metricField,
  aggregate: aggregateField,
  window: z
    .string()
    .optional()
    .meta({ label: 'Window', description: "Time window, e.g. '7d'." }),
  compare: z
    .enum(['none', 'previous-period'])
    .default('none')
    .meta({ label: 'Compare', description: 'Comparison mode.' }),
  format: widgetFormatSchema
    .optional()
    .meta({ label: 'Format', description: 'Display format for the value.' }),
});

export const statusWidgetSchema = z.object({
  kind: z.literal('status'),
  title: titleField,
  source: z.union([z.string(), z.array(z.string()).min(1)]).meta({
    label: 'Source',
    description:
      'A connector reference, or an array of connectors for a combined health badge.',
  }),
});

export const timeseriesWidgetSchema = z.object({
  kind: z.literal('timeseries'),
  title: titleField,
  metric: metricField,
  aggregate: aggregateField,
  window: z
    .string()
    .meta({ label: 'Window', description: "Time window, e.g. '30d'." }),
  granularity: z
    .enum(['hour', 'day', 'week'])
    .default('day')
    .meta({ label: 'Granularity', description: 'Time bucket size.' }),
  format: widgetFormatSchema
    .optional()
    .meta({ label: 'Format', description: 'Display format for the value.' }),
});

export const distributionWidgetSchema = z.object({
  kind: z.literal('distribution'),
  title: titleField,
  metric: metricField,
  aggregate: aggregateField,
  window: z
    .string()
    .meta({ label: 'Window', description: "Time window, e.g. '7d'." }),
  format: widgetFormatSchema
    .optional()
    .meta({ label: 'Format', description: 'Display format for the value.' }),
});

export const widgetSchemas = {
  stat: statWidgetSchema,
  status: statusWidgetSchema,
  timeseries: timeseriesWidgetSchema,
  distribution: distributionWidgetSchema,
} as const;

export const widgetSchema = z.discriminatedUnion('kind', [
  statWidgetSchema,
  statusWidgetSchema,
  timeseriesWidgetSchema,
  distributionWidgetSchema,
]);

export type WidgetKind = keyof typeof widgetSchemas;

export function getWidgetSchema(kind: WidgetKind) {
  return widgetSchemas[kind];
}
