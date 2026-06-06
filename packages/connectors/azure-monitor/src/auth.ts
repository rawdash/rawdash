import {
  AuthError,
  type HttpResponse,
  TransientError,
  connectorUserAgent,
  request as sharedRequest,
} from '@rawdash/connector-shared';

// Azure AD client-credentials token caching, scoped to ARM
// (https://management.azure.com/.default). Both Monitor and Cost connectors
// share an identical flow against the Microsoft Entra ID token endpoint, so the
// helper is co-located in each package (rather than a shared sub-package, which
// would force consumers to install a second runtime dependency).

const TOKEN_HOST = 'login.microsoftonline.com';
const ARM_SCOPE = 'https://management.azure.com/.default';
const TOKEN_TTL_BUFFER_MS = 60_000;

export interface AzureAuthInput {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  connectorId: string;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
}

export interface TokenCacheEntry {
  token: string;
  expiresAt: number;
}

export async function fetchArmAccessToken(
  input: AzureAuthInput,
  signal?: AbortSignal,
): Promise<TokenCacheEntry> {
  const params = new URLSearchParams();
  params.set('grant_type', 'client_credentials');
  params.set('client_id', input.clientId);
  params.set('client_secret', input.clientSecret);
  params.set('scope', ARM_SCOPE);

  let res: HttpResponse<TokenResponse>;
  try {
    res = await sharedRequest<TokenResponse>(
      {
        url: `https://${TOKEN_HOST}/${encodeURIComponent(input.tenantId)}/oauth2/v2.0/token`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': connectorUserAgent(input.connectorId),
        },
        body: params.toString(),
        signal,
      },
      { resource: 'oauth_token' },
    );
  } catch (err) {
    throw classifyTokenError(err);
  }

  const access = res.body.access_token;
  const expiresIn = res.body.expires_in;
  if (typeof access !== 'string' || access.length === 0) {
    throw new AuthError(
      'Azure AD token response did not include an access_token',
    );
  }
  const ttlMs =
    typeof expiresIn === 'number' && Number.isFinite(expiresIn)
      ? expiresIn * 1000
      : 60 * 60 * 1000;
  return {
    token: access,
    expiresAt: Date.now() + ttlMs - TOKEN_TTL_BUFFER_MS,
  };
}

function classifyTokenError(err: unknown): unknown {
  if (!(err instanceof Error) || !('kind' in err)) {
    return err;
  }
  const httpErr = err as Error & { response?: HttpResponse };
  const status = httpErr.response?.status ?? 0;
  if (status === 400 || status === 401 || status === 403) {
    // Entra ID returns 400 for invalid_client / invalid_grant; treat all auth
    // failures as AuthError so the host stops retrying on a broken secret.
    return new AuthError(httpErr.message, httpErr.response);
  }
  if (status >= 500) {
    return new TransientError(httpErr.message, httpErr.response);
  }
  return err;
}

export function isTokenFresh(
  cache: TokenCacheEntry | null,
  now: number = Date.now(),
): boolean {
  return cache !== null && now < cache.expiresAt;
}
