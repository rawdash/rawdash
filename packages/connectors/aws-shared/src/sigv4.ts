// AWS Signature Version 4 signing, implemented against the Web Crypto API so
// the connector carries no AWS SDK dependency. See
// https://docs.aws.amazon.com/general/latest/gr/sigv4_signing.html.

const encoder = new TextEncoder();

const ALGORITHM = 'AWS4-HMAC-SHA256';

// Encode to a fresh ArrayBuffer-backed view so the result is a valid
// `BufferSource` for the Web Crypto APIs under TypeScript's generic typing.
function u8(data: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(encoder.encode(data));
}

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

export async function sha256Hex(data: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', u8(data));
  return toHex(digest);
}

async function hmac(key: BufferSource, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return globalThis.crypto.subtle.sign('HMAC', cryptoKey, u8(data));
}

async function deriveSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Promise<ArrayBuffer> {
  const kDate = await hmac(u8(`AWS4${secretAccessKey}`), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

export interface AmzDate {
  amzDate: string;
  dateStamp: string;
}

// "2015-08-30T12:36:00.000Z" -> { amzDate: "20150830T123600Z", dateStamp: "20150830" }
export function formatAmzDate(date: Date): AmzDate {
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

export interface SignParams {
  method: string;
  host: string;
  path: string;
  query: string;
  headers: Record<string, string>;
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
  amzDate: string;
  dateStamp: string;
}

// Returns the value for the `Authorization` header. The `headers` map must
// contain every header that is part of the signature (at minimum `host` and
// `x-amz-date`); extra unsigned headers sent on the wire are allowed.
export async function createAuthorizationHeader(
  params: SignParams,
): Promise<string> {
  const lowerHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(params.headers)) {
    lowerHeaders[key.toLowerCase()] = value.trim().replace(/\s+/g, ' ');
  }
  const sortedNames = Object.keys(lowerHeaders).sort();

  const canonicalHeaders = sortedNames
    .map((name) => `${name}:${lowerHeaders[name]}\n`)
    .join('');
  const signedHeaders = sortedNames.join(';');

  const canonicalRequest = [
    params.method,
    params.path,
    params.query,
    canonicalHeaders,
    signedHeaders,
    params.payloadHash,
  ].join('\n');

  const credentialScope = `${params.dateStamp}/${params.region}/${params.service}/aws4_request`;
  const stringToSign = [
    ALGORITHM,
    params.amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = await deriveSigningKey(
    params.secretAccessKey,
    params.dateStamp,
    params.region,
    params.service,
  );
  const signature = toHex(await hmac(signingKey, stringToSign));

  return (
    `${ALGORITHM} Credential=${params.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`
  );
}
