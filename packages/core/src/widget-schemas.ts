import { z } from 'zod';

export const widgetSchemas = {
  stat: z.object({
    title: z.string().meta({ label: 'Title', description: 'Widget title.' }),
    metric: z
      .string()
      .meta({ label: 'Metric', description: 'Metric reference.' }),
    window: z
      .string()
      .optional()
      .meta({ label: 'Window', description: "Time window, e.g. '7d'." }),
    compare: z
      .enum(['none', 'previous-period'])
      .default('none')
      .meta({ label: 'Compare', description: 'Comparison mode.' }),
  }),
  status: z.object({
    title: z.string().meta({ label: 'Title', description: 'Widget title.' }),
    source: z.string().meta({
      label: 'Source',
      description: 'Connector or data source reference.',
    }),
  }),
  timeseries: z.object({
    title: z.string().meta({ label: 'Title', description: 'Widget title.' }),
    metric: z
      .string()
      .meta({ label: 'Metric', description: 'Metric reference.' }),
    window: z
      .string()
      .meta({ label: 'Window', description: "Time window, e.g. '30d'." }),
    granularity: z
      .enum(['hour', 'day', 'week'])
      .default('day')
      .meta({ label: 'Granularity', description: 'Time bucket size.' }),
  }),
  distribution: z.object({
    title: z.string().meta({ label: 'Title', description: 'Widget title.' }),
    metric: z
      .string()
      .meta({ label: 'Metric', description: 'Metric reference.' }),
    window: z
      .string()
      .meta({ label: 'Window', description: "Time window, e.g. '7d'." }),
  }),
} as const;

export type WidgetKind = keyof typeof widgetSchemas;

export function getWidgetSchema(kind: WidgetKind) {
  return widgetSchemas[kind];
}
