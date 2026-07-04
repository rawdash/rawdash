import type {
  ComputedMetric,
  ConfiguredConnector,
  Dashboard,
  DashboardConfig,
  Widget,
} from './config';
import type { RetentionConfig } from './retention';
import { isSecret } from './secrets';

const VALID_IDENTIFIER_REGEX = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const RESERVED_KEYWORDS = new Set([
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'new',
  'null',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
  'let',
  'static',
  'await',
  'async',
]);

function isPlainIdentifier(key: string): boolean {
  return VALID_IDENTIFIER_REGEX.test(key) && !RESERVED_KEYWORDS.has(key);
}

function emitKey(key: string): string {
  return isPlainIdentifier(key) ? key : JSON.stringify(key);
}

function emitString(value: string): string {
  return JSON.stringify(value);
}

function emitValue(value: unknown, indent: string): string {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return 'undefined';
  }
  if (typeof value === 'string') {
    return emitString(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (isSecret(value)) {
    return `secret(${emitString(value.$secret)})`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }
    const next = indent + '  ';
    const items = value.map((v) => `${next}${emitValue(v, next)}`);
    return `[\n${items.join(',\n')},\n${indent}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => v !== undefined,
    );
    if (entries.length === 0) {
      return '{}';
    }
    const next = indent + '  ';
    const lines = entries.map(
      ([k, v]) => `${next}${emitKey(k)}: ${emitValue(v, next)}`,
    );
    return `{\n${lines.join(',\n')},\n${indent}}`;
  }
  return 'null';
}

function isComputedMetric(value: unknown): value is ComputedMetric {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return typeof obj.connectorId === 'string' && typeof obj.shape === 'string';
}

function emitMetric(metric: ComputedMetric, indent: string): string {
  const next = indent + '  ';
  const { connectorId, ...rest } = metric;
  const fields: string[] = [
    `${next}connector: { name: ${emitString(connectorId)} }`,
  ];
  for (const [k, v] of Object.entries(rest)) {
    if (v === undefined) {
      continue;
    }
    fields.push(`${next}${emitKey(k)}: ${emitValue(v, next)}`);
  }
  return `defineMetric({\n${fields.join(',\n')},\n${indent}})`;
}

function emitMetricValue(value: unknown, indent: string): string {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }
    const next = indent + '  ';
    const items = value.map(
      (v) =>
        `${next}${isComputedMetric(v) ? emitMetric(v, next) : emitValue(v, next)}`,
    );
    return `[\n${items.join(',\n')},\n${indent}]`;
  }
  if (isComputedMetric(value)) {
    return emitMetric(value, indent);
  }
  return emitValue(value, indent);
}

function emitWidget(widget: Widget, indent: string): string {
  const next = indent + '  ';
  const lines: string[] = [];
  for (const [k, v] of Object.entries(
    widget as unknown as Record<string, unknown>,
  )) {
    if (v === undefined) {
      continue;
    }
    if (k === 'metric') {
      lines.push(`${next}metric: ${emitMetricValue(v, next)}`);
    } else {
      lines.push(`${next}${emitKey(k)}: ${emitValue(v, next)}`);
    }
  }
  if (lines.length === 0) {
    return '{}';
  }
  return `{\n${lines.join(',\n')},\n${indent}}`;
}

function emitDashboard(dashboard: Dashboard, indent: string): string {
  const next = indent + '  ';
  const widgetEntries = Object.entries(dashboard.widgets ?? {});
  if (widgetEntries.length === 0) {
    return `defineDashboard({\n${next}widgets: {},\n${indent}})`;
  }
  const widgetsIndent = next + '  ';
  const widgetLines = widgetEntries.map(
    ([id, w]) =>
      `${widgetsIndent}${emitKey(id)}: ${emitWidget(w, widgetsIndent)}`,
  );
  return `defineDashboard({\n${next}widgets: {\n${widgetLines.join(',\n')},\n${next}},\n${indent}})`;
}

function emitConnector(connector: ConfiguredConnector, indent: string): string {
  return emitValue(connector, indent);
}

function emitRetention(retention: RetentionConfig, indent: string): string {
  return emitValue(retention, indent);
}

function hasSecretRef(value: unknown): boolean {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  if (isSecret(value)) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some(hasSecretRef);
  }
  return Object.values(value as Record<string, unknown>).some(hasSecretRef);
}

function dashboardsUseMetric(dashboards: Record<string, Dashboard>): boolean {
  return Object.values(dashboards).some((dashboard) =>
    Object.values(dashboard.widgets ?? {}).some((widget) => {
      const metric = (widget as unknown as Record<string, unknown>).metric;
      if (Array.isArray(metric)) {
        return metric.some(isComputedMetric);
      }
      return isComputedMetric(metric);
    }),
  );
}

export function renderConfigSource(config: DashboardConfig): string {
  const indent = '  ';
  const { connectors, dashboards, retention } = config;

  const dashboardEntries = Object.entries(dashboards ?? {});

  const usesSecret =
    hasSecretRef(connectors) ||
    hasSecretRef(dashboards) ||
    hasSecretRef(retention);
  const usesDefineDashboard = dashboardEntries.length > 0;
  const usesDefineMetric = dashboardsUseMetric(dashboards ?? {});

  const imports = ['defineConfig'];
  if (usesDefineDashboard) {
    imports.push('defineDashboard');
  }
  if (usesDefineMetric) {
    imports.push('defineMetric');
  }
  if (usesSecret) {
    imports.push('secret');
  }

  const lines: string[] = [];
  lines.push(`import { ${imports.join(', ')} } from '@rawdash/core';`);
  lines.push('');
  lines.push('export default defineConfig({');

  if ((connectors ?? []).length === 0) {
    lines.push(`${indent}connectors: [],`);
  } else {
    lines.push(`${indent}connectors: [`);
    for (const connector of connectors) {
      lines.push(
        `${indent}${indent}${emitConnector(connector, indent + indent)},`,
      );
    }
    lines.push(`${indent}],`);
  }

  if (dashboardEntries.length === 0) {
    lines.push(`${indent}dashboards: {},`);
  } else {
    lines.push(`${indent}dashboards: {`);
    for (const [key, dashboard] of dashboardEntries) {
      lines.push(
        `${indent}${indent}${emitKey(key)}: ${emitDashboard(dashboard, indent + indent)},`,
      );
    }
    lines.push(`${indent}},`);
  }

  if (retention !== undefined) {
    lines.push(`${indent}retention: ${emitRetention(retention, indent)},`);
  }

  lines.push('});');
  lines.push('');

  return lines.join('\n');
}
