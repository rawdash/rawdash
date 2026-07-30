import {
  AuthError,
  ClientBugError,
  HttpClientError,
  TransientError,
  UpstreamBugError,
} from '@rawdash/connector-shared';

const AUTH_CODES = new Set(['28000', '28P01', '42501', '3D000']);

const TRANSIENT_CODES = new Set([
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08P01',
  '53300',
  '53400',
  '57014',
  '57P01',
  '57P02',
  '57P03',
]);

const TRANSIENT_SYSTEM_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'EPIPE',
  'ETIMEDOUT',
]);

const CONFIG_SYSTEM_CODES = new Set(['ENOTFOUND', 'ERR_INVALID_URL']);

export function mapPostgresError(err: unknown, queryId: string): Error {
  if (err instanceof HttpClientError) {
    return err;
  }
  const error = err instanceof Error ? err : new Error(String(err));
  const code = (error as { code?: unknown }).code;
  const message = `PostgreSQL query "${queryId}" failed: ${error.message}`;

  if (typeof code === 'string') {
    if (AUTH_CODES.has(code)) {
      return new AuthError(message);
    }
    if (TRANSIENT_CODES.has(code) || TRANSIENT_SYSTEM_CODES.has(code)) {
      return new TransientError(message);
    }
    if (CONFIG_SYSTEM_CODES.has(code) || code === '25006') {
      return new ClientBugError(message);
    }
    if (code.startsWith('42') || code.startsWith('22')) {
      return new ClientBugError(message);
    }
  }

  return new UpstreamBugError(message);
}
