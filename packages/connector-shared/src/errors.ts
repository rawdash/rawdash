import type { HttpResponse } from './types';

export type HttpErrorKind =
  | 'transient'
  | 'rate_limit'
  | 'auth'
  | 'upstream_bug'
  | 'client_bug';

export abstract class HttpClientError extends Error {
  abstract readonly kind: HttpErrorKind;
  readonly response?: HttpResponse;

  constructor(message: string, response?: HttpResponse) {
    super(message);
    this.name = new.target.name;
    this.response = response;
  }
}

export class TransientError extends HttpClientError {
  readonly kind = 'transient' as const;
}

export class RateLimitError extends HttpClientError {
  readonly kind = 'rate_limit' as const;
  readonly retryAfter?: Date;

  constructor(message: string, response?: HttpResponse, retryAfter?: Date) {
    super(message, response);
    this.retryAfter = retryAfter;
  }
}

export class AuthError extends HttpClientError {
  readonly kind = 'auth' as const;
}

export class UpstreamBugError extends HttpClientError {
  readonly kind = 'upstream_bug' as const;
}

export class ClientBugError extends HttpClientError {
  readonly kind = 'client_bug' as const;
}

export function classifyStatus(status: number): HttpErrorKind {
  if (status === 429) {
    return 'rate_limit';
  }
  if (status === 401 || status === 403) {
    return 'auth';
  }
  if (status === 408) {
    return 'transient';
  }
  if (status >= 500) {
    return 'upstream_bug';
  }
  if (status >= 400) {
    return 'client_bug';
  }
  return 'client_bug';
}

export function errorForStatus(
  message: string,
  response: HttpResponse,
  retryAfter?: Date,
): HttpClientError {
  const kind = classifyStatus(response.status);
  switch (kind) {
    case 'rate_limit':
      return new RateLimitError(message, response, retryAfter);
    case 'auth':
      return new AuthError(message, response);
    case 'transient':
      return new TransientError(message, response);
    case 'upstream_bug':
      return new UpstreamBugError(message, response);
    case 'client_bug':
      return new ClientBugError(message, response);
  }
}
