import { z } from 'zod';

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

export const resolvedMetricSchema = z.object({
  connectorId: z.string(),
  shape: shapeSchema,
  name: z.string().optional(),
  entityType: z.string().optional(),
  field: z.string().optional(),
  fn: aggFnSchema,
  window: z.string().optional(),
  filter: z.array(filterClauseSchema).optional(),
  groupBy: groupBySchema.optional(),
});

const titleField = z
  .string()
  .meta({ label: 'Title', description: 'Widget title.' });

export const statWidgetSchema = z.object({
  kind: z.literal('stat'),
  title: titleField,
  metric: resolvedMetricSchema.meta({
    label: 'Metric',
    description: 'Resolved metric definition.',
  }),
  window: z
    .string()
    .optional()
    .meta({ label: 'Window', description: "Time window, e.g. '7d'." }),
  compare: z
    .enum(['none', 'previous-period'])
    .default('none')
    .meta({ label: 'Compare', description: 'Comparison mode.' }),
});

export const statusWidgetSchema = z.object({
  kind: z.literal('status'),
  title: titleField,
  source: z.string().meta({
    label: 'Source',
    description: 'Connector or data source reference.',
  }),
});

export const timeseriesWidgetSchema = z.object({
  kind: z.literal('timeseries'),
  title: titleField,
  metric: resolvedMetricSchema.meta({
    label: 'Metric',
    description: 'Resolved metric definition.',
  }),
  window: z
    .string()
    .meta({ label: 'Window', description: "Time window, e.g. '30d'." }),
  granularity: z
    .enum(['hour', 'day', 'week'])
    .default('day')
    .meta({ label: 'Granularity', description: 'Time bucket size.' }),
});

export const distributionWidgetSchema = z.object({
  kind: z.literal('distribution'),
  title: titleField,
  metric: resolvedMetricSchema.meta({
    label: 'Metric',
    description: 'Resolved metric definition.',
  }),
  window: z
    .string()
    .meta({ label: 'Window', description: "Time window, e.g. '7d'." }),
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
