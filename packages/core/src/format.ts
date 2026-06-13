import type { ComputedMetric } from './config';
import type { ResourceDefinition, ResourceDefinitions } from './resource';

export const MINOR_CURRENCY_UNITS: ReadonlySet<string> = new Set([
  'cent',
  'cents',
  'pence',
  'penny',
]);

export interface WidgetFormat {
  kind: 'currency' | 'number' | 'percent' | 'duration' | 'bytes';
  currency?: string;
  decimals?: number;
  compact?: boolean;
}

export interface ResolvedWidgetFormat extends WidgetFormat {
  scale?: number;
}

export function currencyScaleFromUnit(unit: string | undefined): number {
  if (!unit) {return 1;}
  if (MINOR_CURRENCY_UNITS.has(unit.trim().toLowerCase())) {
    return 100;
  }
  return 1;
}

function fieldUnitFromResource(
  resource: ResourceDefinition,
  fieldName: string | undefined,
): string | undefined {
  if (resource.shape === 'metric') {
    if (fieldName === undefined || fieldName === 'value') {
      return resource.unit;
    }
    return resource.dimensions?.find((d) => d.name === fieldName)?.unit;
  }
  if (resource.shape === 'entity' || resource.shape === 'event') {
    return resource.fields?.find((f) => f.name === fieldName)?.unit;
  }
  return undefined;
}

export function lookupFieldUnit(
  metric: ComputedMetric,
  resourcesByConnectorId:
    | Readonly<Partial<Record<string, ResourceDefinitions>>>
    | undefined,
): string | undefined {
  if (!resourcesByConnectorId) {return undefined;}
  const resourceDefs = resourcesByConnectorId[metric.connectorId];
  if (!resourceDefs) {return undefined;}
  const resourceName = metric.name ?? metric.entityType;
  if (!resourceName) {return undefined;}
  const resource = resourceDefs[resourceName];
  if (!resource) {return undefined;}
  return fieldUnitFromResource(resource, metric.field);
}

export function resolveWidgetFormat(
  format: WidgetFormat,
  metric: ComputedMetric,
  resourcesByConnectorId:
    | Readonly<Partial<Record<string, ResourceDefinitions>>>
    | undefined,
): ResolvedWidgetFormat {
  if (format.kind !== 'currency') {
    return format;
  }
  const unit = lookupFieldUnit(metric, resourcesByConnectorId);
  const scale = currencyScaleFromUnit(unit);
  return { ...format, scale };
}
