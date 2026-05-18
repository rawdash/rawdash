import { HttpClientError, RateLimitError, TransientError } from './errors';

export interface RetryPolicy {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  retryOn?: (status: number | null, err?: Error) => boolean;
}

export const defaultRetryOn = (status: number | null, err?: Error): boolean => {
  if (err instanceof RateLimitError) {
    return true;
  }
  if (err instanceof TransientError) {
    return true;
  }
  if (status === null) {
    return err instanceof Error && !(err instanceof HttpClientError);
  }
  if (status === 408 || status === 429) {
    return true;
  }
  if (status >= 500) {
    return true;
  }
  return false;
};

export function backoffDelayMs(
  attempt: number,
  policy: Required<Pick<RetryPolicy, 'initialDelayMs' | 'maxDelayMs'>>,
): number {
  const base = policy.initialDelayMs * 2 ** attempt;
  const jitter = base * 0.25 * Math.random();
  return Math.min(base + jitter, policy.maxDelayMs);
}

export function parseRetryAfter(
  headerValue: string | null,
  now: Date = new Date(),
): Date | undefined {
  if (!headerValue) {
    return undefined;
  }
  const trimmed = headerValue.trim();
  if (/^\d+$/.test(trimmed)) {
    return new Date(now.getTime() + Number(trimmed) * 1000);
  }
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    return undefined;
  }
  return new Date(parsed);
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new Error('Aborted'));
  }
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason ?? new Error('Aborted'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
