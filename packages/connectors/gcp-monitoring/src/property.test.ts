import {
  type InvariantViolation,
  connectorResourceShapeViolations,
  mockJsonResponse,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';

import { GcpMonitoringConnector } from './gcp-monitoring';

const CONNECTOR_ID = 'gcp-monitoring';
const METRIC_TYPE = 'compute.googleapis.com/instance/cpu/utilization';

// A valid service-account JSON whose JWT is exchanged for the fuzzed token.
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

const TEST_SA_JSON = JSON.stringify({
  client_email: 'sa@test.iam.gserviceaccount.com',
  private_key: TEST_PRIVATE_KEY,
  token_uri: 'https://oauth2.googleapis.com/token',
});

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    GcpMonitoringConnector.resources,
    storage,
    connectorId,
  );

function makeConnector(): GcpMonitoringConnector {
  return new GcpMonitoringConnector(
    {
      projectId: 'my-project',
      metricQueries: [
        {
          id: 'cpu',
          metricType: METRIC_TYPE,
          alignmentPeriod: '300s',
          perSeriesAligner: 'ALIGN_MEAN',
        },
      ],
    },
    { serviceAccountJson: TEST_SA_JSON },
  );
}

// Return the fuzzed time_series payload (with nextPageToken stripped so
// pagination terminates), but force every series under the configured query's
// metric type so connector.sync can match by name without filtering.
function installMock(sample: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.startsWith('https://oauth2.googleapis.com/token')) {
        return Promise.resolve(
          mockJsonResponse({ access_token: 'tok', expires_in: 3600 }),
        );
      }
      const body = { ...(sample as Record<string, unknown>) };
      delete body['nextPageToken'];
      const series = (body['timeSeries'] as unknown[] | undefined) ?? [];
      body['timeSeries'] = series.map((s) => ({
        ...(s as Record<string, unknown>),
        metric: {
          ...(((s as Record<string, unknown>).metric as Record<
            string,
            unknown
          >) ?? {}),
          type: METRIC_TYPE,
        },
      }));
      return Promise.resolve(mockJsonResponse(body));
    }),
  );
}

describe('GcpMonitoringConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('time_series: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest({
      connectorClass: GcpMonitoringConnector,
      resource: 'time_series',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [docShapeExtra],
      run: async (sample, storage) => {
        installMock(sample);
        await makeConnector().sync(
          { mode: 'full', since: '2024-01-01T00:00:00Z' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });
});
