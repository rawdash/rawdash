import type { RateLimitPolicy, RateLimitState } from './rate-limit';
import type { RetryPolicy } from './retry';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD';

export interface HttpRequest {
  url: string;
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: string | Uint8Array | undefined;
  signal?: AbortSignal;
  timeoutMs?: number;
  retry?: RetryPolicy;
  rateLimit?: RateLimitPolicy;
  parseJson?: boolean;
  binary?: boolean;
}

export interface HttpResponse<T = unknown> {
  status: number;
  headers: Headers;
  body: T;
  rateLimitState?: RateLimitState;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
