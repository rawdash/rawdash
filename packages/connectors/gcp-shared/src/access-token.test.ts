import { describe, expect, it, vi } from 'vitest';

import { GcpAccessTokenProvider } from './access-token';

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

const validSa = JSON.stringify({
  client_email: 'sa@test.iam.gserviceaccount.com',
  private_key: TEST_PRIVATE_KEY,
  token_uri: 'https://oauth2.googleapis.com/token',
});

function makePost(captured: { body?: string }) {
  return vi.fn(
    async (
      _url: string,
      opts: { body: string },
    ): Promise<{ body: { access_token: string; expires_in?: number } }> => {
      captured.body = opts.body;
      return { body: { access_token: 'token-123', expires_in: 3600 } };
    },
  );
}

describe('GcpAccessTokenProvider', () => {
  it('exchanges a service-account JWT when serviceAccountJson is present', async () => {
    const captured: { body?: string } = {};
    const post = makePost(captured);
    const provider = new GcpAccessTokenProvider({
      connectorId: 'test',
      scope: 'https://www.googleapis.com/auth/analytics.readonly',
      getServiceAccountJson: () => validSa,
      post,
    });
    expect(await provider.getToken()).toBe('token-123');
    expect(new URLSearchParams(captured.body).get('grant_type')).toBe(
      'urn:ietf:params:oauth:grant-type:jwt-bearer',
    );
  });

  it('falls back to a refresh-token grant when no serviceAccountJson is present', async () => {
    const captured: { body?: string } = {};
    const post = makePost(captured);
    const provider = new GcpAccessTokenProvider({
      connectorId: 'test',
      scope: 'https://www.googleapis.com/auth/analytics.readonly',
      getServiceAccountJson: () => undefined,
      getRefreshTokenCredentials: () => ({
        refreshToken: 'refresh-123',
        clientId: 'client-abc',
        clientSecret: 'secret-xyz',
      }),
      post,
    });
    expect(await provider.getToken()).toBe('token-123');
    const params = new URLSearchParams(captured.body);
    expect(params.get('grant_type')).toBe('refresh_token');
    expect(params.get('refresh_token')).toBe('refresh-123');
  });

  it('caches the token across calls', async () => {
    const post = makePost({});
    const provider = new GcpAccessTokenProvider({
      connectorId: 'test',
      scope: 'https://www.googleapis.com/auth/analytics.readonly',
      getServiceAccountJson: () => validSa,
      post,
    });
    await provider.getToken();
    await provider.getToken();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('throws when no credentials are available', async () => {
    const provider = new GcpAccessTokenProvider({
      connectorId: 'test',
      scope: 'https://www.googleapis.com/auth/analytics.readonly',
      getServiceAccountJson: () => undefined,
      post: makePost({}),
    });
    await expect(provider.getToken()).rejects.toThrow(
      /missing serviceAccountJson or refresh-token credentials/,
    );
  });
});
