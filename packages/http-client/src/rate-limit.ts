export interface RateLimitState {
  remaining: number;
  resetAt: Date;
}

export interface RateLimitPolicy {
  parse(headers: Headers): RateLimitState | null;
}

export const githubRateLimit: RateLimitPolicy = {
  parse(h) {
    const remainingRaw = h.get('x-ratelimit-remaining');
    const resetRaw = h.get('x-ratelimit-reset');
    if (remainingRaw === null || resetRaw === null) {
      return null;
    }
    const remaining = Number(remainingRaw);
    const reset = Number(resetRaw);
    if (!Number.isFinite(remaining) || !Number.isFinite(reset) || reset < 0) {
      return null;
    }
    return { remaining, resetAt: new Date(reset * 1000) };
  },
};

export const sentryRateLimit: RateLimitPolicy = {
  parse(h) {
    const concurrent = h.get('x-sentry-rate-limit-remaining');
    const reset = h.get('x-sentry-rate-limit-reset');
    if (concurrent === null || reset === null) {
      return null;
    }
    const remaining = Number(concurrent);
    const resetSec = Number(reset);
    if (
      !Number.isFinite(remaining) ||
      !Number.isFinite(resetSec) ||
      resetSec < 0
    ) {
      return null;
    }
    return { remaining, resetAt: new Date(resetSec * 1000) };
  },
};

export const linearRateLimit: RateLimitPolicy = {
  parse(h) {
    const remainingRaw = h.get('x-ratelimit-requests-remaining');
    const resetRaw = h.get('x-ratelimit-requests-reset');
    if (remainingRaw === null) {
      return null;
    }
    const remaining = Number(remainingRaw);
    if (!Number.isFinite(remaining)) {
      return null;
    }
    let resetAt: Date;
    if (resetRaw !== null) {
      const reset = Number(resetRaw);
      if (!Number.isFinite(reset) || reset < 0) {
        return null;
      }
      resetAt = new Date(reset);
    } else {
      resetAt = new Date(Date.now() + 60_000);
    }
    return { remaining, resetAt };
  },
};
