import { z } from 'zod';

export type ConfigFieldsSchema = z.ZodObject<z.ZodRawShape>;

export function defineConfigFields<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
): z.ZodObject<T> {
  if (!(schema instanceof z.ZodObject)) {
    throw new Error(
      `configFields must be a Zod object schema (z.object({...})). Received: ${Object.prototype.toString.call(schema)}`,
    );
  }
  return schema;
}
