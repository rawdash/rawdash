import type { ComputedMetric, DashboardConfig, Shape, Widget } from './config';
import type { FilterClause } from './filters';
import { MINOR_CURRENCY_UNITS } from './format';
import type { ConnectorRegistry } from './registry';
import type {
  ResourceDefinition,
  ResourceDefinitions,
  ResourceField,
} from './resource';

export type MetricIssueSeverity = 'error' | 'warning';

export interface MetricValidationIssue {
  ref: string;
  severity: MetricIssueSeverity;
  message: string;
}

export interface MetricValidationResult {
  errors: MetricValidationIssue[];
  warnings: MetricValidationIssue[];
}

export type ResourcesByConnectorId = Readonly<
  Partial<Record<string, ResourceDefinitions>>
>;

export function resourcesByConnectorIdFromRegistry(
  registry: ConnectorRegistry,
): ResourcesByConnectorId {
  const out: Record<string, ResourceDefinitions> = {};
  for (const [connectorId, Cls] of Object.entries(registry)) {
    if (Cls.resources) {
      out[connectorId] = Cls.resources;
    }
  }
  return out;
}

const IMPLICIT_FIELDS: Record<Shape, readonly string[]> = {
  event: ['name', 'start_ts', 'end_ts'],
  entity: ['id', 'type', 'updated_at'],
  metric: ['name', 'ts', 'value'],
  distribution: [],
  edge: [],
};

const WINDOW_HINT_RE =
  /(^|[^a-z0-9])(\d+)\s*(d|days?|h|hours?|w|weeks?)([^a-z0-9]|$)/i;

function isMinorCurrencyUnit(unit: string | undefined): boolean {
  return (
    unit !== undefined && MINOR_CURRENCY_UNITS.has(unit.trim().toLowerCase())
  );
}

function declaredFields(
  resource: ResourceDefinition,
): readonly ResourceField[] | undefined {
  if (resource.shape === 'entity' || resource.shape === 'event') {
    return resource.fields;
  }
  if (resource.shape === 'metric') {
    return resource.dimensions;
  }
  return undefined;
}

function fieldUnit(
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

function resourceNameFor(metric: ComputedMetric): string | undefined {
  if (metric.shape === 'entity') {
    return metric.entityType ?? metric.name;
  }
  return metric.name ?? metric.entityType;
}

function effectiveWindow(
  widget: Widget,
  metric: ComputedMetric,
): string | undefined {
  if (metric.window) {
    return metric.window;
  }
  if ('window' in widget && widget.window) {
    return widget.window;
  }
  return undefined;
}

function filterFields(filter: FilterClause[] | undefined): string[] {
  const fields: string[] = [];
  for (const clause of filter ?? []) {
    if ('or' in clause) {
      for (const c of clause.or) {
        fields.push(c.field);
      }
    } else {
      fields.push(clause.field);
    }
  }
  return fields;
}

function validateMetric(
  metric: ComputedMetric,
  widget: Widget,
  widgetKey: string,
  ref: string,
  config: DashboardConfig,
  resourcesByConnectorId: ResourcesByConnectorId,
  errors: MetricValidationIssue[],
  warnings: MetricValidationIssue[],
): void {
  const entry = config.connectors.find((c) => c.name === metric.connectorId);
  const connectorTypeId = entry?.connectorId;
  const resources = connectorTypeId
    ? resourcesByConnectorId[connectorTypeId]
    : undefined;

  const windowHint = [widget.title, widgetKey, metric.name].find(
    (s): s is string => typeof s === 'string' && WINDOW_HINT_RE.test(s),
  );
  if (windowHint !== undefined && !effectiveWindow(widget, metric)) {
    warnings.push({
      ref,
      severity: 'warning',
      message: `"${windowHint}" implies a time window but the metric has no "window" — it aggregates over all time. Add a window (e.g. window: '30d') or rename to drop the period.`,
    });
  }

  if (!resources) {
    return;
  }

  const resourceName = resourceNameFor(metric);
  if (resourceName === undefined) {
    return;
  }

  const resource = resources[resourceName];
  if (!resource) {
    const valid = Object.entries(resources)
      .filter(([, def]) => def.shape === metric.shape)
      .map(([name]) => name)
      .sort();
    const validList = valid.length > 0 ? valid.join(', ') : '(none)';
    errors.push({
      ref,
      severity: 'error',
      message: `references unknown ${metric.shape} "${resourceName}" on connector "${connectorTypeId}". Valid ${metric.shape} resources: ${validList}.`,
    });
    return;
  }

  if (resource.shape !== metric.shape) {
    errors.push({
      ref,
      severity: 'error',
      message: `declares shape "${metric.shape}" but resource "${resourceName}" on connector "${connectorTypeId}" is a "${resource.shape}".`,
    });
    return;
  }

  const fields = declaredFields(resource);
  if (fields) {
    const valid = new Set<string>([
      ...fields.map((f) => f.name),
      ...IMPLICIT_FIELDS[metric.shape],
    ]);
    const validList = [...valid].sort().join(', ');
    const checkField = (field: string | undefined, label: string): void => {
      if (field !== undefined && !valid.has(field)) {
        errors.push({
          ref,
          severity: 'error',
          message: `${label} "${field}" is not a field of ${metric.shape} "${resourceName}" on connector "${connectorTypeId}". Valid fields: ${validList}.`,
        });
      }
    };
    checkField(metric.field, 'field');
    for (const field of filterFields(metric.filter)) {
      checkField(field, 'filter field');
    }
    if (metric.groupBy) {
      checkField(metric.groupBy.field, 'groupBy field');
    }
  }

  if (metric.fn !== 'count') {
    const unit = fieldUnit(resource, metric.field);
    const hasCurrencyFormat =
      'format' in widget && widget.format?.kind === 'currency';
    if (isMinorCurrencyUnit(unit)) {
      const fieldLabel = metric.field ?? 'value';
      if (!hasCurrencyFormat) {
        warnings.push({
          ref,
          severity: 'warning',
          message: `${metric.fn}s "${fieldLabel}" which connector "${connectorTypeId}" declares in ${unit} (a minor currency unit). Raw ${unit} values are 100× the major-unit figure; set format: { kind: 'currency' } on the widget to display correctly.`,
        });
      }
    } else if (hasCurrencyFormat && !unit) {
      const fieldLabel = metric.field ?? 'value';
      warnings.push({
        ref,
        severity: 'warning',
        message: `has format: { kind: 'currency' } but field "${fieldLabel}" on connector "${connectorTypeId}" has no declared currency unit. Verify the field stores monetary values in a minor currency unit (e.g. cents) and add the appropriate unit declaration.`,
      });
    }
  }
}

export function validateConfigMetrics(
  config: DashboardConfig,
  resourcesByConnectorId: ResourcesByConnectorId,
): MetricValidationResult {
  const errors: MetricValidationIssue[] = [];
  const warnings: MetricValidationIssue[] = [];

  for (const [dashboardKey, dashboard] of Object.entries(config.dashboards)) {
    for (const [widgetKey, widget] of Object.entries(dashboard.widgets)) {
      if (widget.kind === 'status') {
        continue;
      }
      const ref = `Dashboard "${dashboardKey}", widget "${widgetKey}"`;
      validateMetric(
        widget.metric,
        widget,
        widgetKey,
        ref,
        config,
        resourcesByConnectorId,
        errors,
        warnings,
      );
    }
  }

  return { errors, warnings };
}

export function formatMetricIssues(issues: MetricValidationIssue[]): string {
  return issues.map((i) => `  ${i.ref}: ${i.message}`).join('\n');
}
