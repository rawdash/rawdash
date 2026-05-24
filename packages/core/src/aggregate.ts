import type { Widget } from './config';
import type {
  AggregateRequest,
  AggregateValue,
  Entity,
  JSONValue,
  StorageHandle,
} from './connector';

export const AGGREGATE_ENTITY_TYPE = '__widget_aggregate';

export interface AggregateClassification {
  via: 'aggregate' | 'entity-sync';
  request?: AggregateRequest;
}

export function classifyWidget(widget: Widget): AggregateClassification {
  if (widget.kind !== 'stat') {
    return { via: 'entity-sync' };
  }
  const metric = widget.metric;
  if (metric.fn !== 'count' && metric.fn !== 'latest') {
    return { via: 'entity-sync' };
  }
  if (metric.groupBy !== undefined) {
    return { via: 'entity-sync' };
  }
  if (metric.window !== undefined || widget.window !== undefined) {
    return { via: 'entity-sync' };
  }
  const resource = metric.name ?? metric.entityType;
  if (!resource) {
    return { via: 'entity-sync' };
  }
  if (metric.fn === 'latest' && metric.field === undefined) {
    return { via: 'entity-sync' };
  }
  return {
    via: 'aggregate',
    request: {
      fn: metric.fn,
      resource,
      field: metric.field,
      filter: metric.filter,
    },
  };
}

export async function writeAggregate(
  storage: StorageHandle,
  widgetId: string,
  value: AggregateValue,
): Promise<void> {
  const entity: Entity = {
    type: AGGREGATE_ENTITY_TYPE,
    id: widgetId,
    attributes: { value: value as JSONValue },
    updated_at: Date.now(),
  };
  await storage.entity(entity);
}

export async function readAggregate(
  storage: StorageHandle,
  widgetId: string,
): Promise<{ value: AggregateValue; updatedAt: number } | null> {
  const entity = await storage.getEntity(AGGREGATE_ENTITY_TYPE, widgetId);
  if (!entity) {
    return null;
  }
  return {
    value: (entity.attributes['value'] ?? null) as AggregateValue,
    updatedAt: entity.updated_at,
  };
}
