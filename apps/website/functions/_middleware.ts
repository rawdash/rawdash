const VISITOR_COOKIE = 'rd_vid';
const VISITOR_TTL_SECONDS = 60 * 60 * 24 * 365 * 2;
const DEFAULT_COOKIE_DOMAIN = '.rawdash.dev';
const DEFAULT_INTERNAL_TOKEN_HEADER = 'X-Internal-Token';
const ATTRIBUTION_TIMEOUT_MS = 3_000;
const STATIC_ASSET_EXTENSION =
  /\.(?:js|mjs|css|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|map|json|xml|txt|webmanifest)$/;

let loggedMissingAttributionConfig = false;

interface PagesFunctionEnv {
  ATTRIBUTION_ENDPOINT?: string;
  INTERNAL_API_TOKEN?: string;
  INTERNAL_TOKEN_HEADER?: string;
  COOKIE_DOMAIN?: string;
}

interface PagesFunctionContext {
  request: Request;
  env: PagesFunctionEnv;
  next: () => Promise<Response>;
  waitUntil: (promise: Promise<unknown>) => void;
}

interface UtmParams {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
}

interface AttributionEventPayload extends UtmParams {
  visitorId: string;
  landingPath?: string;
  referer?: string;
}

function parseUtmParams(params: URLSearchParams): UtmParams {
  const read = (key: string): string | undefined => {
    const value = params.get(key)?.trim();
    return value && value.length > 0 ? value : undefined;
  };
  return {
    utmSource: read('utm_source'),
    utmMedium: read('utm_medium'),
    utmCampaign: read('utm_campaign'),
    utmTerm: read('utm_term'),
    utmContent: read('utm_content'),
  };
}

function hasAnyUtm(utm: UtmParams): boolean {
  return Object.values(utm).some((value) => value !== undefined);
}

function isExternalReferer(
  referer: string | null,
  requestHost: string,
): boolean {
  if (!referer) {
    return false;
  }
  try {
    return new URL(referer).host !== requestHost;
  } catch (err) {
    console.warn('Ignoring unparseable referer:', err);
    return false;
  }
}

function isInterestingArrival(
  utm: UtmParams,
  referer: string | null,
  requestHost: string,
): boolean {
  return hasAnyUtm(utm) || isExternalReferer(referer, requestHost);
}

function isDocumentRequest(headers: Headers): boolean {
  const dest = headers.get('sec-fetch-dest');
  if (dest) {
    return dest === 'document';
  }
  return (headers.get('accept') ?? '').includes('text/html');
}

function shouldSkipPath(pathname: string): boolean {
  return (
    pathname.startsWith('/_astro/') ||
    pathname.startsWith('/_image') ||
    pathname === '/favicon.svg' ||
    pathname === '/robots.txt' ||
    pathname === '/sitemap.xml' ||
    pathname === '/sitemap-index.xml' ||
    STATIC_ASSET_EXTENSION.test(pathname)
  );
}

function readVisitorCookie(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === VISITOR_COOKIE) {
      return rest.join('=') || undefined;
    }
  }
  return undefined;
}

function buildVisitorCookie(visitorId: string, cookieDomain: string): string {
  return [
    `${VISITOR_COOKIE}=${visitorId}`,
    `Domain=${cookieDomain}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${VISITOR_TTL_SECONDS}`,
  ].join('; ');
}

function withVisitorCookie(
  response: Response,
  visitorId: string,
  cookieDomain: string,
): Response {
  const next = new Response(response.body, response);
  next.headers.append(
    'Set-Cookie',
    buildVisitorCookie(visitorId, cookieDomain),
  );
  return next;
}

async function recordAttributionEvent(
  endpoint: string,
  tokenHeader: string,
  token: string,
  payload: AttributionEventPayload,
): Promise<void> {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [tokenHeader]: token,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(ATTRIBUTION_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error(
        'Attribution event request returned non-OK status:',
        response.status,
      );
    }
  } catch (err) {
    console.error('Attribution event request failed:', err);
  }
}

export const onRequest = async (
  context: PagesFunctionContext,
): Promise<Response> => {
  const { request, env } = context;
  const url = new URL(request.url);

  if (!isDocumentRequest(request.headers) || shouldSkipPath(url.pathname)) {
    return context.next();
  }

  const upstream = await context.next();

  const cookieDomain = env.COOKIE_DOMAIN ?? DEFAULT_COOKIE_DOMAIN;
  const existingId = readVisitorCookie(request.headers.get('cookie'));
  const visitorId = existingId ?? crypto.randomUUID();
  const response = existingId
    ? upstream
    : withVisitorCookie(upstream, visitorId, cookieDomain);

  const utm = parseUtmParams(url.searchParams);
  const referer = request.headers.get('referer');
  if (!isInterestingArrival(utm, referer, url.host)) {
    return response;
  }

  const endpoint = env.ATTRIBUTION_ENDPOINT;
  const token = env.INTERNAL_API_TOKEN;
  if (!endpoint || !token) {
    if (!loggedMissingAttributionConfig) {
      loggedMissingAttributionConfig = true;
      console.warn(
        'ATTRIBUTION_ENDPOINT or INTERNAL_API_TOKEN is not set; skipping attribution event',
      );
    }
    return response;
  }

  const tokenHeader =
    env.INTERNAL_TOKEN_HEADER ?? DEFAULT_INTERNAL_TOKEN_HEADER;
  context.waitUntil(
    recordAttributionEvent(endpoint, tokenHeader, token, {
      visitorId,
      ...utm,
      landingPath: url.pathname,
      referer: referer ?? undefined,
    }),
  );

  return response;
};
