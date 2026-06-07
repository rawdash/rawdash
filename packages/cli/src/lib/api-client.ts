import { type DashboardConfig, toWireConfig } from '@rawdash/core';

import { getEnv } from './env';

const DEFAULT_TIMEOUT_MS = 10_000;

export interface Diff<T> {
  added: T[];
  removed: T[];
  modified: T[];
}

export interface CloudConnectorRecord {
  name: string;
  connectorId: string;
  displayName?: string | null;
  config: Record<string, unknown>;
  syncIntervalSeconds?: number;
  enabled?: boolean;
}

export interface CloudDashboardRecord {
  id: string;
  name: string;
  slug: string;
  config: Record<string, unknown>;
}

export interface ConfigDiff {
  connectors: Diff<CloudConnectorRecord>;
  dashboards: Diff<CloudDashboardRecord>;
}

export interface DeploySuccess {
  ok: true;
  diff: ConfigDiff;
}

export interface DeployFailure {
  ok: false;
  error: string;
  status: number;
  conflicts?: string[];
}

export type DeployResult = DeploySuccess | DeployFailure;

export interface CloudSecret {
  name: string;
  lastRotatedAt: string | null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorBody {
  error?: string;
  message?: string;
  code?: string;
  required?: string;
  conflicts?: string[];
}

export async function postConfig(
  config: DashboardConfig,
  dryRun: boolean,
): Promise<DeployResult> {
  const { url, apiKey } = getEnv();
  const endpoint = `${url}/config${dryRun ? '?dryRun=true' : ''}`;

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey ?? ''}`,
      },
      body: JSON.stringify(toWireConfig(config)),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    const isTimeout =
      err instanceof Error &&
      (err.name === 'AbortError' || err.name === 'TimeoutError');
    return {
      ok: false,
      error: isTimeout
        ? 'Request timed out'
        : `Network error: ${err instanceof Error ? err.message : String(err)}`,
      status: 0,
    };
  }

  if (res.ok) {
    const diff = (await res.json()) as ConfigDiff;
    return { ok: true, diff };
  }

  return buildDeployFailure(res, url, endpoint);
}

async function buildDeployFailure(
  res: Response,
  baseUrl: string,
  endpoint: string,
): Promise<DeployFailure> {
  const { body, text } = await readErrorBody(res);
  const rawMessage = body.error ?? body.message ?? (text || res.statusText);

  let error: string;
  if (res.status === 401) {
    error = `API key invalid or revoked. Check RAWDASH_API_KEY. (${rawMessage})`;
  } else if (res.status === 403) {
    error = buildForbiddenMessage(body, rawMessage, baseUrl, endpoint);
  } else if (res.status === 409) {
    error = `Org is in ui source-of-truth mode. Switch to git mode in cloud settings, or push UI changes back into your config first.`;
  } else if (res.status === 422) {
    error = `Validation failed: ${rawMessage}`;
  } else {
    error = `Request failed (${res.status}): ${rawMessage}${requestContext(res.status, baseUrl, endpoint)}`;
  }

  return { ok: false, error, status: res.status, conflicts: body.conflicts };
}

function buildForbiddenMessage(
  body: ErrorBody,
  rawMessage: string,
  baseUrl: string,
  endpoint: string,
): string {
  if (body.code === 'insufficient_scope') {
    const scope = body.required ?? 'config:write';
    return `Key lacks the "${scope}" scope. Get a new key with broader scope. (${rawMessage})`;
  }
  const code = body.code ? ` [${body.code}]` : '';
  return `Forbidden (403): ${rawMessage}${code}${requestContext(403, baseUrl, endpoint)}`;
}

function requestContext(
  status: number,
  baseUrl: string,
  endpoint: string,
): string {
  let context = `\n  Request URL: ${endpoint}`;
  if ((status === 403 || status === 404) && isSluglessUrl(baseUrl)) {
    context +=
      `\n  RAWDASH_URL has no org slug. The hosted service expects ` +
      `https://api.rawdash.dev/<org-slug>; a slug-less URL is rejected with 403.`;
  }
  return context;
}

function isSluglessUrl(baseUrl: string): boolean {
  try {
    const { pathname } = new URL(baseUrl);
    return pathname === '' || pathname === '/';
  } catch {
    return false;
  }
}

export async function setSecret(name: string, value: string): Promise<void> {
  const { url, apiKey } = getEnv();
  const endpoint = `${url}/secrets`;

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey ?? ''}`,
      },
      body: JSON.stringify({ name, value }),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    throw new ApiError(wrapFetchError(err), 0);
  }

  if (!res.ok) {
    await throwApiError(res, url, endpoint);
  }
}

export async function listSecrets(): Promise<CloudSecret[]> {
  const { url, apiKey } = getEnv();
  const endpoint = `${url}/secrets`;

  let res: Response;
  try {
    res = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${apiKey ?? ''}` },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    throw new ApiError(wrapFetchError(err), 0);
  }

  if (!res.ok) {
    await throwApiError(res, url, endpoint);
  }
  const body = (await res.json()) as { secrets: CloudSecret[] };
  return body.secrets;
}

export async function removeSecret(name: string): Promise<void> {
  const { url, apiKey } = getEnv();
  const endpoint = `${url}/secrets/${encodeURIComponent(name)}`;

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${apiKey ?? ''}` },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    throw new ApiError(wrapFetchError(err), 0);
  }

  if (!res.ok) {
    await throwApiError(res, url, endpoint);
  }
}

function wrapFetchError(err: unknown): string {
  if (
    err instanceof Error &&
    (err.name === 'AbortError' || err.name === 'TimeoutError')
  ) {
    return 'Request timed out';
  }
  return `Network error: ${err instanceof Error ? err.message : String(err)}`;
}

async function throwApiError(
  res: Response,
  baseUrl: string,
  endpoint: string,
): Promise<never> {
  const { body, text } = await readErrorBody(res);
  const message = body.error ?? body.message ?? (text || res.statusText);
  const code = body.code ? ` [${body.code}]` : '';
  throw new ApiError(
    `API error (${res.status}): ${message}${code}${requestContext(res.status, baseUrl, endpoint)}`,
    res.status,
  );
}

async function readErrorBody(res: Response): Promise<{
  body: ErrorBody;
  text: string;
}> {
  const text = await res.text();
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      return {
        body: JSON.parse(text) as ErrorBody,
        text,
      };
    } catch {
      // body claimed JSON but wasn't — fall through to text
    }
  }
  return { body: {}, text };
}
