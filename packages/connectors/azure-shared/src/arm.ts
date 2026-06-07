import {
  AuthError,
  type HttpResponse,
  RateLimitError,
  TransientError,
} from '@rawdash/connector-shared';

export const ARM_HOST = 'https://management.azure.com';

// nextLink can be a fully-qualified URL Azure hands back; sanitize before reuse
// so a corrupted cursor cannot exfiltrate the bearer token to an attacker host.
export function isAllowedArmUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && u.host === 'management.azure.com';
  } catch {
    return false;
  }
}

// Re-map ARM transport errors onto the connector-shared error taxonomy so the
// host retries (or stops retrying) appropriately.
export function mapArmError(err: unknown): unknown {
  if (!(err instanceof Error) || !('kind' in err)) {
    return err;
  }
  const httpErr = err as Error & { response?: HttpResponse };
  const status = httpErr.response?.status ?? 0;
  if (status === 401 || status === 403) {
    return new AuthError(httpErr.message, httpErr.response);
  }
  if (status === 429) {
    return new RateLimitError(httpErr.message, httpErr.response);
  }
  if (status >= 500) {
    return new TransientError(httpErr.message, httpErr.response);
  }
  return err;
}
