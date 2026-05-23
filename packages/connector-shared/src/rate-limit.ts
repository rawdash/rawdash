export interface RateLimitState {
  remaining: number;
  resetAt: Date;
}

export interface RateLimitPolicy {
  parse(headers: Headers): RateLimitState | null;
}

export interface StandardRateLimitPolicyConfig {
  remainingHeader: string;
  resetHeader: string;
  resetUnit: 's' | 'ms';
  resetFallbackMs?: number;
}

export function standardRateLimitPolicy(
  config: StandardRateLimitPolicyConfig,
): RateLimitPolicy {
  const { remainingHeader, resetHeader, resetUnit, resetFallbackMs } = config;
  const multiplier = resetUnit === 's' ? 1000 : 1;
  return {
    parse(h) {
      const remainingRaw = h.get(remainingHeader);
      if (remainingRaw === null || remainingRaw.trim() === '') {
        return null;
      }
      const remaining = Number(remainingRaw);
      if (!Number.isFinite(remaining)) {
        return null;
      }
      const resetRaw = h.get(resetHeader);
      if (resetRaw === null) {
        if (resetFallbackMs === undefined) {
          return null;
        }
        return {
          remaining,
          resetAt: new Date(Date.now() + resetFallbackMs),
        };
      }
      if (resetRaw.trim() === '') {
        return null;
      }
      const reset = Number(resetRaw);
      if (!Number.isFinite(reset) || reset < 0) {
        return null;
      }
      const resetMs = reset * multiplier;
      if (!Number.isFinite(resetMs)) {
        return null;
      }
      return { remaining, resetAt: new Date(resetMs) };
    },
  };
}
