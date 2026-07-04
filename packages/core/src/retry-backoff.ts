export interface RetryBackoffOptions {
  baseMs: number;
  ceilingMs: number;
}

export function computeRetryBackoffMs(
  consecutiveErrors: number,
  opts: RetryBackoffOptions,
): number {
  const exponent = Math.max(0, Math.floor(consecutiveErrors) - 1);
  const scaled = opts.baseMs * 2 ** Math.min(exponent, 30);
  return Math.min(scaled, opts.ceilingMs);
}

export function normalizeRetryAfter(
  retryAfter: Date | undefined,
  now: Date,
  maxSeconds: number,
): number {
  if (!(retryAfter instanceof Date)) {
    return 1;
  }
  const requestedSeconds = Math.ceil(
    (retryAfter.getTime() - now.getTime()) / 1000,
  );
  return Math.min(Math.max(1, requestedSeconds), maxSeconds);
}
