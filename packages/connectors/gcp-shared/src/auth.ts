import { z } from 'zod';

export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
  project_id?: string;
}

const serviceAccountKeySchema = z.object({
  client_email: z.string().min(1),
  private_key: z.string().min(1),
  token_uri: z.string().url().optional(),
  project_id: z.string().optional(),
});

export interface TokenResponse {
  access_token: string;
  expires_in?: number;
}

export const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive().optional(),
});

function base64urlFromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlFromString(str: string): string {
  return base64urlFromBytes(new TextEncoder().encode(str));
}

async function signRS256JWT(
  payload: Record<string, unknown>,
  privateKeyPem: string,
): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT' };
  const headerB64 = base64urlFromString(JSON.stringify(header));
  const payloadB64 = base64urlFromString(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const pemContent = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
  const der = Uint8Array.from(atob(pemContent), (c) => c.charCodeAt(0));

  const key = await globalThis.crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await globalThis.crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${base64urlFromBytes(new Uint8Array(signature))}`;
}

export function parseServiceAccountJson(value: string): ServiceAccountKey {
  const trimmed = value.trim();
  if (trimmed.startsWith('{')) {
    return serviceAccountKeySchema.parse(JSON.parse(trimmed));
  }
  const binary = atob(trimmed);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const decoded = new TextDecoder().decode(bytes);
  return serviceAccountKeySchema.parse(JSON.parse(decoded));
}

export async function buildServiceAccountJwt(
  serviceAccountJson: string,
  scope: string,
): Promise<{ url: string; body: string }> {
  const sa = parseServiceAccountJson(serviceAccountJson);
  const now = Math.floor(Date.now() / 1000);
  const jwt = await signRS256JWT(
    {
      iss: sa.client_email,
      scope,
      aud: sa.token_uri ?? 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    },
    sa.private_key,
  );

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
  }).toString();

  return {
    url: sa.token_uri ?? 'https://oauth2.googleapis.com/token',
    body,
  };
}
