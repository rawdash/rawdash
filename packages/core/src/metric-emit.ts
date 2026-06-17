import type { JSONValue, MetricSample } from './connector';
import type { ResourceDefinition, ResourceDefinitions } from './resource';

type FieldNames<F> = F extends readonly { name: infer N extends string }[]
  ? N
  : never;

export type MetricAttributeKeys<R extends ResourceDefinition> = R extends {
  shape: 'metric';
}
  ?
      | FieldNames<R extends { dimensions?: infer D } ? D : never>
      | FieldNames<R extends { measures?: infer M } ? M : never>
  : never;

export type MetricAttributes<R extends ResourceDefinition> = [
  MetricAttributeKeys<R>,
] extends [never]
  ? Record<string, never>
  : Partial<Record<MetricAttributeKeys<R>, JSONValue>>;

export type MetricSampleInput<R extends ResourceDefinition> = {
  ts: number;
  value: number;
  attributes?: MetricAttributes<R>;
};

export function metricSample<
  const T extends ResourceDefinitions,
  K extends keyof T & string,
>(resources: T, name: K, sample: MetricSampleInput<T[K]>): MetricSample {
  return {
    name,
    ts: sample.ts,
    value: sample.value,
    attributes: (sample.attributes ?? {}) as Record<string, JSONValue>,
  };
}
