import { z } from 'zod';

export const connectorCategorySchema = z.enum([
  'engineering',
  'product',
  'analytics',
  'marketing',
  'sales',
  'support',
  'finance',
  'infrastructure',
  'security',
  'hr',
]);

export type ConnectorCategory = z.infer<typeof connectorCategorySchema>;

export const connectorDocSchema = z.object({
  displayName: z.string().min(1),
  category: connectorCategorySchema,
  tagline: z.string().min(1),
  brandColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  vendor: z.object({
    name: z.string().min(1),
    apiDocs: z.url().optional(),
    website: z.url().optional(),
  }),
  auth: z.object({
    summary: z.string().min(1),
    setup: z.array(z.string().min(1)),
  }),
  rateLimit: z.string().min(1).optional(),
  limitations: z.array(z.string().min(1)).optional(),
});

export type ConnectorDoc = z.infer<typeof connectorDocSchema>;

export function defineConnectorDoc(doc: ConnectorDoc): ConnectorDoc {
  return connectorDocSchema.parse(doc);
}
