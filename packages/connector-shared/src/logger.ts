export type LogFields = Record<string, unknown>;

export interface ConnectorLogger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
}

export interface ConnectorLoggerOptions {
  scope: string;
}

const MAX_VALUE_LEN = 120;

function truncate(s: string, max = MAX_VALUE_LEN): string {
  if (s.length <= max) {
    return s;
  }
  return `${s.slice(0, max - 1)}…`;
}

function formatValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return '';
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'string') {
    const t = truncate(value);
    if (/[\s"=]/.test(t)) {
      return JSON.stringify(t);
    }
    return t;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    json = undefined;
  }
  return truncate(json ?? String(value));
}

export function formatLogFields(fields?: LogFields): string {
  if (!fields) {
    return '';
  }
  const parts: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) {
      continue;
    }
    parts.push(`${k}=${formatValue(v)}`);
  }
  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

export function formatLogLine(
  scope: string,
  event: string,
  fields?: LogFields,
): string {
  return `[${scope}] ${event}${formatLogFields(fields)}`;
}

export function createDefaultConnectorLogger(
  opts: ConnectorLoggerOptions,
): ConnectorLogger {
  return {
    info(event, fields) {
      console.info(formatLogLine(opts.scope, event, fields));
    },
    warn(event, fields) {
      console.warn(formatLogLine(opts.scope, event, fields));
    },
  };
}

const NOOP_LOGGER: ConnectorLogger = {
  info() {},
  warn() {},
};

export function noopConnectorLogger(): ConnectorLogger {
  return NOOP_LOGGER;
}
