import {
  AuthError,
  ClientBugError,
  HttpClientError,
  RateLimitError,
  TransientError,
  UpstreamBugError,
  errorForStatus,
} from './errors';
import { defaultRetryOn, parseRetryAfter, sleep } from './retry';
import type { FetchLike, HttpMethod, HttpRequest, HttpResponse } from './types';
import { DEFAULT_USER_AGENT } from './version';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_INITIAL_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 60_000;
const OBSERVER_TIMEOUT_MS = 250;

export interface RequestObservation {
  url: string;
  method: HttpMethod;
  status: number;
  resource: string;
  requestId: string;
  body: unknown;
}

export type RequestObserver = (
  event: RequestObservation,
) => void | Promise<void>;

export interface RequestOptions {
  fetch?: FetchLike;
  observer?: RequestObserver;
  resource: string;
  requestId?: string;
}

async function notifyObserver(
  observer: RequestObserver,
  event: RequestObservation,
): Promise<void> {
  let result: void | Promise<void>;
  try {
    result = observer(event);
  } catch (err) {
    console.warn('[connector-shared] request observer threw:', err);
    return;
  }
  if (!(result instanceof Promise)) {
    return;
  }
  const guarded = result.catch((err) => {
    console.warn('[connector-shared] request observer rejected:', err);
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, OBSERVER_TIMEOUT_MS);
  });
  try {
    await Promise.race([guarded, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function newRequestId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) {
    return c.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function mergeHeaders(
  defaults: Record<string, string>,
  overrides: Record<string, string> | undefined,
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries(defaults)) {
    merged[k.toLowerCase()] = v;
  }
  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) {
      merged[k.toLowerCase()] = v;
    }
  }
  return merged;
}

function linkTimeoutSignal(
  parent: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const onParentAbort = () => {
    controller.abort(parent?.reason);
  };
  if (parent) {
    if (parent.aborted) {
      controller.abort(parent.reason);
    } else {
      parent.addEventListener('abort', onParentAbort, { once: true });
    }
  }
  const timer = setTimeout(() => {
    controller.abort(new Error(`Request timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timer);
      if (parent) {
        parent.removeEventListener('abort', onParentAbort);
      }
    },
  };
}

async function readBody(
  res: Response,
  parseJson: boolean,
  binary: boolean,
): Promise<unknown> {
  if (res.status === 204 || res.status === 205) {
    return null;
  }
  if (binary) {
    return new Uint8Array(await res.arrayBuffer());
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (parseJson && contentType.includes('application/json')) {
    const text = await res.text();
    if (text.length === 0) {
      return null;
    }
    return JSON.parse(text);
  }
  return res.text();
}

export async function request<T = unknown>(
  req: HttpRequest,
  options: RequestOptions,
): Promise<HttpResponse<T>> {
  const fetchImpl: FetchLike = options.fetch ?? (globalThis.fetch as FetchLike);
  const retry = req.retry ?? {};
  const maxAttempts = retry.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const initialDelayMs = retry.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const maxDelayMs = retry.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const retryOn = retry.retryOn ?? defaultRetryOn;
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const parseJson = req.parseJson ?? true;
  const binary = req.binary ?? false;

  const headers = mergeHeaders(
    {
      'User-Agent': DEFAULT_USER_AGENT,
      Accept: 'application/json',
    },
    req.headers,
  );

  let lastErr: Error | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    req.signal?.throwIfAborted();

    const { signal, cancel } = linkTimeoutSignal(req.signal, timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(req.url, {
        method: req.method ?? 'GET',
        headers,
        body: req.body as RequestInit['body'],
        signal,
      });
    } catch (err) {
      cancel();
      if (req.signal?.aborted) {
        throw req.signal.reason ?? err;
      }
      const error = err instanceof Error ? err : new Error(String(err));
      lastErr = error;
      if (attempt < maxAttempts - 1 && retryOn(null, error)) {
        const delay = computeDelay(attempt, initialDelayMs, maxDelayMs);
        await sleep(delay, req.signal);
        continue;
      }
      throw new TransientError(error.message);
    }
    cancel();

    const body = await readBody(res, parseJson, binary);
    const httpResponse: HttpResponse<T> = {
      status: res.status,
      headers: res.headers,
      body: body as T,
    };
    if (req.rateLimit) {
      const state = req.rateLimit.parse(res.headers);
      if (state) {
        httpResponse.rateLimitState = state;
      }
    }

    if (options.observer) {
      await notifyObserver(options.observer, {
        url: req.url,
        method: req.method ?? 'GET',
        status: res.status,
        resource: options.resource,
        requestId: options.requestId ?? newRequestId(),
        body,
      });
    }

    if (res.ok) {
      return httpResponse;
    }

    const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
    const message = `HTTP ${res.status} ${res.statusText} for ${req.method ?? 'GET'} ${req.url}`;
    const err = errorForStatus(message, httpResponse, retryAfter);

    if (
      attempt < maxAttempts - 1 &&
      retryOn(res.status, err) &&
      !(err instanceof AuthError) &&
      !(err instanceof ClientBugError)
    ) {
      lastErr = err;
      let delay = computeDelay(attempt, initialDelayMs, maxDelayMs);
      if (err instanceof RateLimitError && retryAfter) {
        const wait = retryAfter.getTime() - Date.now();
        if (wait > 0) {
          delay = Math.min(wait, maxDelayMs);
        }
      }
      await sleep(delay, req.signal);
      continue;
    }

    throw err;
  }

  throw lastErr ?? new UpstreamBugError('Exhausted retry attempts');
}

function computeDelay(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
): number {
  const base = initialDelayMs * 2 ** attempt;
  const jitter = base * 0.25 * Math.random();
  return Math.min(base + jitter, maxDelayMs);
}

export { HttpClientError };
