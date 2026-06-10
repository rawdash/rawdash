import { describe, expect, it } from 'vitest';

import {
  buildRefreshTokenGrant,
  buildServiceAccountJwt,
  parseServiceAccountJson,
} from './auth';

const TEST_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDFvX2hX9MZqaQz
G0nVHkBcLG8K7AaH7SkB1tJ7w7K3M7ICX/dQOX4xs0Ja/Cn1nMSgPHWGEDsq3qDV
SLZbX7l4PgTzaLZqYG1f0aSV52L4cmDhfP3T9TLcXY3WIuhJpsyEr2QnPzKuY7y4
yzM4DAuD2Wg4lwOIyXX6r1L3RWAnZj1J7K0pwGcVabVhV/U3hk1cBhrJlVRz8oig
b/SgXr5hHbA8e2zRSnZbOTHEZcVcd2dnUFG6hLwO1Tlc0n0HoEvg1AaXdz/3LhqW
4lOX7Bys9MIgQyJZIbDvX0+xJZ0p4S9aXcHgnTw/F8RYxQyTfTdYz1cF4iVPmW0z
J0eVQrTjAgMBAAECggEAUlqMyKt0wWWcg5L9k3CkPzhFxBxJoF6X0jvfqzPHc+I8
sx/L6yu6vTNTQCqWBxQy+x9KX4qVe93h8DTrYdyKzKR1yYXqVxV6V5gKVtZ4iySV
ZQEz0BexcZGu5+UmTSqLs7DZpZ4l9OmM4mxF9N1tQEKZAYjGzG1+OBHTQ7zaCv6X
SnyHo3pjJyKAhsmkA0jYZ4rwwYZP0VzqyD3PxFcXJ8YqV5MgPV3LZGsBTb2DfDuh
M9JLNVN/W3iwLDcWoq5xWNJL4tVw6mIQDmUSZQ1ZuvtCb/Vz4ahKaqDOJzHs7sLD
S0YrIfWXC9Q1lLkxR5cMZRhYpr0JOzJzTKZGcjsLAQKBgQDi/eHrkXxc0KPlGtT9
SAJ/MR7ucC5RIZSLqQYJ7yHJOyW7yk5HrG3VqK9z7qbqJh9NwwY7d8sIuvJv3Z7E
RGqJ0+SfYDPVRcq7TZ1WkV0qGc8VxR5DSCfMrAyzqMdJyGfX+jVxlh+r6yK7TLNB
F4HHRMTQyZuS3xCN3SP1nq3PgQKBgQDfBmqkBJBV6yLZ3DkVCi5fX1cZc/r2dDZH
oWZSm4G6+s5lJ4rGxOLY4yMR8aNCv4n3wKyo7BAS9pkKVL5RtkdY8XYpwQEKfYS+
W3Ks1iDk0Js9HRkVB1y0HzwSfx0M8oCwGc7Pj4q1mhqlMNG7BpJXz0nF7yBkP0Ld
qaInZ6tOgwKBgC9wdj6pV3IhrqcZpr0PnAhmMfMZuwsKmkBy0lH7DfvgVe5J0aHQ
LCBWdrRXBRxJYK4yYdJYBL1jR4w6c92qFu2W3yWMqOgD3SY+B+yX8m9o0c2sBl3I
9ALzpRl8j5LVPZl7vNT0lFlcZ0jOlS8z9oP6/A5oUOcS6rRcfYUWuxKBAoGBAJTC
fL0jr5pYAaP3Ow3KFsCQrjA0OxKnSpfm66JFRDH4hCT2KdJtFnK4z8c9jZNlMnFy
xBYqLZJ7XdL2dQXTpKDFvU/W2N6ZRBgFG/yWiVZjsiAYsRz0w0YwRyZxnVlSP4vS
NEcG+gAIaIaiRGw3J/sZHmh7uIZ+JN7Xz6JEKgyTAoGBANLOLJ9MNQTUKtOyA/sw
qCEZ8sBVfQGmJWELRBNcc/zwa3z6jr/lASS2VBhsyExSAQE0LcXX9C6Pog+UEHJ4
RmEYx5G8nFXrm0L7CCY1FdJh+1WiOyQ7Q9V9ID0+1uFmS4owmtZTPNTpd5jPTPMR
HJC2BqGwSGRPDx9bPo8Bd6Mq
-----END PRIVATE KEY-----`;

const validSa = {
  client_email: 'sa@test.iam.gserviceaccount.com',
  private_key: TEST_PRIVATE_KEY,
  token_uri: 'https://oauth2.googleapis.com/token',
};

describe('parseServiceAccountJson', () => {
  it('parses a raw JSON service-account key', () => {
    const parsed = parseServiceAccountJson(JSON.stringify(validSa));
    expect(parsed.client_email).toBe(validSa.client_email);
  });

  it('parses a base64-encoded service-account key', () => {
    const encoded = btoa(JSON.stringify(validSa));
    const parsed = parseServiceAccountJson(encoded);
    expect(parsed.client_email).toBe(validSa.client_email);
  });

  it('strips whitespace before deciding raw vs base64', () => {
    const encoded = `   ${btoa(JSON.stringify(validSa))}   `;
    expect(parseServiceAccountJson(encoded).client_email).toBe(
      validSa.client_email,
    );
  });
});

describe('buildServiceAccountJwt', () => {
  it('produces a token-exchange body with the requested scope', async () => {
    const result = await buildServiceAccountJwt(
      JSON.stringify(validSa),
      'https://www.googleapis.com/auth/monitoring.read',
    );
    expect(result.url).toBe('https://oauth2.googleapis.com/token');
    const params = new URLSearchParams(result.body);
    expect(params.get('grant_type')).toBe(
      'urn:ietf:params:oauth:grant-type:jwt-bearer',
    );
    const assertion = params.get('assertion');
    expect(assertion).toBeTruthy();
    const segments = assertion!.split('.');
    expect(segments).toHaveLength(3);
    const decode = (b64u: string): string =>
      atob(b64u.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(decode(segments[1]!)) as {
      iss: string;
      scope: string;
      aud: string;
    };
    expect(payload.iss).toBe(validSa.client_email);
    expect(payload.scope).toBe(
      'https://www.googleapis.com/auth/monitoring.read',
    );
    expect(payload.aud).toBe('https://oauth2.googleapis.com/token');
  });
});

describe('buildRefreshTokenGrant', () => {
  it('builds a refresh_token grant request', () => {
    const result = buildRefreshTokenGrant({
      refreshToken: 'refresh-123',
      clientId: 'client-abc',
      clientSecret: 'secret-xyz',
    });
    expect(result.url).toBe('https://oauth2.googleapis.com/token');
    const params = new URLSearchParams(result.body);
    expect(params.get('grant_type')).toBe('refresh_token');
    expect(params.get('refresh_token')).toBe('refresh-123');
    expect(params.get('client_id')).toBe('client-abc');
    expect(params.get('client_secret')).toBe('secret-xyz');
  });
});
