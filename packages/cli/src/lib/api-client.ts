import type { DashboardConfig } from '@rawdash/core';

import { toCloudConfig } from './cloud-config';
import { getEnv } from './env';

const DEFAULT_TIMEOUT_MS = 10_000;

export interface DeploySuccess {
  ok: true;
  version: number;
  diff: {
    added: string[];
    removed: string[];
    modified: string[];
  };
}

export interface DeployFailure {
  ok: false;
  error: string;
  status: number;
  conflicts?: string[];
}

export type DeployResult = DeploySuccess | DeployFailure;

export interface SecretEntry {
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
      body: JSON.stringify(toCloudConfig(config)),
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
    return res.json() as Promise<DeploySuccess>;
  }

  return buildDeployFailure(res);
}

async function buildDeployFailure(res: Response): Promise<DeployFailure> {
  const { body, text } = await readErrorBody(res);
  const rawMessage = body.error ?? body.message ?? (text || res.statusText);

  let error: string;
  if (res.status === 401) {
    error = `API key invalid or revoked. Check RAWDASH_API_KEY. (${rawMessage})`;
  } else if (res.status === 403) {
    error = `Key lacks config:write scope. Get a new key with broader scope. (${rawMessage})`;
  } else if (res.status === 409) {
    error = `Org is in ui source-of-truth mode. Switch to git mode in cloud settings, or push UI changes back into your config first.`;
  } else if (res.status === 422) {
    error = `Validation failed: ${rawMessage}`;
  } else {
    error = `Request failed (${res.status}): ${rawMessage}`;
  }

  return { ok: false, error, status: res.status, conflicts: body.conflicts };
}

export async function setSecret(name: string, value: string): Promise<void> {
  const { url, apiKey } = getEnv();

  let res: Response;
  try {
    res = await fetch(`${url}/secrets`, {
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
    await throwApiError(res);
  }
}

export async function listSecrets(): Promise<SecretEntry[]> {
  const { url, apiKey } = getEnv();

  let res: Response;
  try {
    res = await fetch(`${url}/secrets`, {
      headers: { Authorization: `Bearer ${apiKey ?? ''}` },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    throw new ApiError(wrapFetchError(err), 0);
  }

  if (!res.ok) {
    await throwApiError(res);
  }
  return res.json() as Promise<SecretEntry[]>;
}

export async function removeSecret(name: string): Promise<void> {
  const { url, apiKey } = getEnv();

  let res: Response;
  try {
    res = await fetch(`${url}/secrets/${encodeURIComponent(name)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${apiKey ?? ''}` },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    throw new ApiError(wrapFetchError(err), 0);
  }

  if (!res.ok) {
    await throwApiError(res);
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

async function throwApiError(res: Response): Promise<never> {
  const { body, text } = await readErrorBody(res);
  const message = body.error ?? body.message ?? (text || res.statusText);
  throw new ApiError(`API error (${res.status}): ${message}`, res.status);
}

async function readErrorBody(res: Response): Promise<{
  body: { error?: string; message?: string; conflicts?: string[] };
  text: string;
}> {
  const text = await res.text();
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      return {
        body: JSON.parse(text) as {
          error?: string;
          message?: string;
          conflicts?: string[];
        },
        text,
      };
    } catch {
      // body claimed JSON but wasn't — fall through to text
    }
  }
  return { body: {}, text };
}
