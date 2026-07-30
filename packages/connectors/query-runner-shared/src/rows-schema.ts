import { z } from 'zod';

export const queryRunnerRowsSchema = z.object({
  rows: z.array(
    z.object({
      ts: z.iso.datetime(),
      value: z.number(),
      series: z.string().nullish(),
    }),
  ),
});
