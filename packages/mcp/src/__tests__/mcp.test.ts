import { Client } from '@modelcontextprotocol/sdk/client/index';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory';
import type { ConnectorRegistry } from '@rawdash/core';
import { InMemoryStorage } from '@rawdash/core';
import { describe, expect, it } from 'vitest';

import { createMcpServer } from '../server';

const CONNECTOR_ID = 'test';

const config = {
  connectors: [{ name: CONNECTOR_ID, connectorId: 'test', config: {} }],
  dashboards: {
    main: {
      widgets: {
        runs: {
          kind: 'stat' as const,
          title: 'Total Runs',
          metric: {
            connectorId: CONNECTOR_ID,
            shape: 'event' as const,
            name: 'workflow_run',
            field: 'start_ts',
            fn: 'count' as const,
          },
        },
        trend: {
          kind: 'timeseries' as const,
          title: 'Runs Over Time',
          metric: {
            connectorId: CONNECTOR_ID,
            shape: 'event' as const,
            name: 'workflow_run',
            field: 'start_ts',
            fn: 'count' as const,
          },
          window: '7d',
          granularity: 'day' as const,
        },
        ci_status: {
          kind: 'status' as const,
          title: 'CI Status',
          source: CONNECTOR_ID,
        },
      },
    },
  },
};

async function makeClient(
  storage: InMemoryStorage,
  extraOptions?: Partial<Parameters<typeof createMcpServer>[0]>,
) {
  const server = createMcpServer({ config, storage, ...extraOptions });
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

function parseResult(result: {
  content: Array<{ type: string; text?: string }>;
}) {
  const block = result.content[0];
  if (!block || block.type !== 'text' || !block.text) {
    throw new Error('Expected text content');
  }
  return JSON.parse(block.text) as unknown;
}

describe('list_dashboards', () => {
  it('returns all dashboards with widget counts', async () => {
    const client = await makeClient(new InMemoryStorage());
    const result = await client.callTool({
      name: 'list_dashboards',
      arguments: {},
    });
    const data = parseResult(result as Parameters<typeof parseResult>[0]) as {
      dashboards: Array<{
        id: string;
        widgetCount: number;
        widgetIds: string[];
      }>;
    };
    expect(data.dashboards).toHaveLength(1);
    expect(data.dashboards[0]!.id).toBe('main');
    expect(data.dashboards[0]!.widgetCount).toBe(3);
  });
});

describe('list_widgets', () => {
  it('returns widgets for a valid dashboard', async () => {
    const client = await makeClient(new InMemoryStorage());
    const result = await client.callTool({
      name: 'list_widgets',
      arguments: { dashboard_id: 'main' },
    });
    const data = parseResult(result as Parameters<typeof parseResult>[0]) as {
      widgets: Array<{ id: string; kind: string; title: string }>;
    };
    expect(data.widgets).toHaveLength(3);
    const ids = data.widgets.map((w) => w.id).sort();
    expect(ids).toEqual(['ci_status', 'runs', 'trend']);
  });

  it('returns error for unknown dashboard', async () => {
    const client = await makeClient(new InMemoryStorage());
    const result = await client.callTool({
      name: 'list_widgets',
      arguments: { dashboard_id: 'nope' },
    });
    const data = parseResult(result as Parameters<typeof parseResult>[0]) as {
      error: { code: string };
    };
    expect(data.error.code).toBe('NOT_FOUND');
  });
});

describe('read_widget', () => {
  it('returns stat widget data with count 0 when no events', async () => {
    const client = await makeClient(new InMemoryStorage());
    const result = await client.callTool({
      name: 'read_widget',
      arguments: { dashboard_id: 'main', widget_id: 'runs' },
    });
    const data = parseResult(result as Parameters<typeof parseResult>[0]) as {
      id: string;
      data: number;
      cachedAt: string | null;
    };
    expect(data.id).toBe('runs');
    expect(data.data).toBe(0);
    expect(data.cachedAt).toBeNull();
  });

  it('returns status widget data', async () => {
    const client = await makeClient(new InMemoryStorage());
    const result = await client.callTool({
      name: 'read_widget',
      arguments: { dashboard_id: 'main', widget_id: 'ci_status' },
    });
    const data = parseResult(result as Parameters<typeof parseResult>[0]) as {
      connectorId: string;
      data: null;
    };
    expect(data.connectorId).toBe(CONNECTOR_ID);
    expect(data.data).toBeNull();
  });

  it('returns error for unknown widget', async () => {
    const client = await makeClient(new InMemoryStorage());
    const result = await client.callTool({
      name: 'read_widget',
      arguments: { dashboard_id: 'main', widget_id: 'ghost' },
    });
    const data = parseResult(result as Parameters<typeof parseResult>[0]) as {
      error: { code: string };
    };
    expect(data.error.code).toBe('NOT_FOUND');
  });
});

describe('render_widget', () => {
  it('returns formatted markdown for a stat widget', async () => {
    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle(CONNECTOR_ID);
    await handle.event({
      name: 'workflow_run',
      start_ts: Date.now(),
      end_ts: null,
      attributes: {},
    });
    const client = await makeClient(storage);
    const result = await client.callTool({
      name: 'render_widget',
      arguments: { dashboard_id: 'main', widget_id: 'runs' },
    });
    const block = (
      result as { content: Array<{ type: string; text?: string }> }
    ).content[0];
    expect(block?.type).toBe('text');
    expect(block?.text).toContain('Total Runs');
    expect(block?.text).toContain('1');
  });

  it('returns formatted markdown for a status widget', async () => {
    const client = await makeClient(new InMemoryStorage());
    const result = await client.callTool({
      name: 'render_widget',
      arguments: { dashboard_id: 'main', widget_id: 'ci_status' },
    });
    const block = (
      result as { content: Array<{ type: string; text?: string }> }
    ).content[0];
    expect(block?.type).toBe('text');
    expect(block?.text).toContain('CI Status');
  });
});

describe('list_connectors', () => {
  it('returns all connectors with sync status', async () => {
    const client = await makeClient(new InMemoryStorage());
    const result = await client.callTool({
      name: 'list_connectors',
      arguments: {},
    });
    const data = parseResult(result as Parameters<typeof parseResult>[0]) as {
      connectors: Array<{ id: string; syncStatus: string }>;
    };
    expect(data.connectors).toHaveLength(1);
    expect(data.connectors[0]!.id).toBe(CONNECTOR_ID);
    expect(data.connectors[0]!.syncStatus).toBe('idle');
  });
});

describe('set_secret / list_secrets', () => {
  it('set_secret calls onSetSecret with name and value', async () => {
    const captured: Record<string, string> = {};
    const client = await makeClient(new InMemoryStorage(), {
      onSetSecret: async (name, value) => {
        captured[name] = value;
      },
    });
    const result = await client.callTool({
      name: 'set_secret',
      arguments: { name: 'TEST_TOKEN', value: 'abc123' },
    });
    const data = parseResult(result as Parameters<typeof parseResult>[0]) as {
      set: string;
    };
    expect(data.set).toBe('TEST_TOKEN');
    expect(captured['TEST_TOKEN']).toBe('abc123');
  });

  it('set_secret rejects invalid names', async () => {
    const client = await makeClient(new InMemoryStorage());
    const result = await client.callTool({
      name: 'set_secret',
      arguments: { name: 'lower_case', value: 'x' },
    });
    const data = parseResult(result as Parameters<typeof parseResult>[0]) as {
      error: { code: string };
    };
    expect(data.error.code).toBe('INVALID_NAME');
  });

  it('list_secrets returns names set in this session', async () => {
    const client = await makeClient(new InMemoryStorage());
    await client.callTool({
      name: 'set_secret',
      arguments: { name: 'MY_SECRET', value: 'val' },
    });
    const result = await client.callTool({
      name: 'list_secrets',
      arguments: {},
    });
    const data = parseResult(result as Parameters<typeof parseResult>[0]) as {
      secrets: string[];
    };
    expect(data.secrets).toContain('MY_SECRET');
  });

  it('set_secret returns structured error when onSetSecret throws', async () => {
    const client = await makeClient(new InMemoryStorage(), {
      onSetSecret: async () => {
        throw new Error('backend unavailable');
      },
    });
    const result = await client.callTool({
      name: 'set_secret',
      arguments: { name: 'FAIL_SECRET', value: 'x' },
    });
    const data = parseResult(result as Parameters<typeof parseResult>[0]) as {
      error: { code: string };
    };
    expect(data.error.code).toBe('SET_SECRET_FAILED');
  });

  it('list_secrets returns structured error when listSecrets throws', async () => {
    const client = await makeClient(new InMemoryStorage(), {
      listSecrets: async () => {
        throw new Error('vault unreachable');
      },
    });
    const result = await client.callTool({
      name: 'list_secrets',
      arguments: {},
    });
    const data = parseResult(result as Parameters<typeof parseResult>[0]) as {
      error: { code: string };
    };
    expect(data.error.code).toBe('LIST_SECRETS_FAILED');
  });
});

describe('remove_connector', () => {
  it('removes an existing connector', async () => {
    const client = await makeClient(new InMemoryStorage());
    const result = await client.callTool({
      name: 'remove_connector',
      arguments: { connector_id: CONNECTOR_ID },
    });
    const data = parseResult(result as Parameters<typeof parseResult>[0]) as {
      removed: string;
    };
    expect(data.removed).toBe(CONNECTOR_ID);

    const listResult = await client.callTool({
      name: 'list_connectors',
      arguments: {},
    });
    const listData = parseResult(
      listResult as Parameters<typeof parseResult>[0],
    ) as {
      connectors: unknown[];
    };
    expect(listData.connectors).toHaveLength(0);
  });

  it('is idempotent — returns success for non-existent connector', async () => {
    const client = await makeClient(new InMemoryStorage());
    const result = await client.callTool({
      name: 'remove_connector',
      arguments: { connector_id: 'nope' },
    });
    const data = parseResult(result as Parameters<typeof parseResult>[0]) as {
      removed: string;
      existed: boolean;
    };
    expect(data.removed).toBe('nope');
    expect(data.existed).toBe(false);
  });
});

class StubConnector {
  static readonly credentials = undefined;
  readonly id = 'test';
  constructor(
    _settings: Record<string, unknown>,
    _creds?: Record<string, unknown>,
  ) {}
  serializeConfig(): Record<string, unknown> {
    return {};
  }
  async sync(): Promise<{ done: boolean }> {
    return { done: true };
  }
}

const stubRegistry: ConnectorRegistry = {
  test: StubConnector as unknown as ConnectorRegistry[string],
};

describe('trigger_sync', () => {
  it('triggers sync for all connectors', async () => {
    const client = await makeClient(new InMemoryStorage(), {
      connectorRegistry: stubRegistry,
    });
    const result = await client.callTool({
      name: 'trigger_sync',
      arguments: {},
    });
    const data = parseResult(result as Parameters<typeof parseResult>[0]) as {
      triggered: boolean;
      connectors: string[];
    };
    expect(data.triggered).toBe(true);
    expect(data.connectors).toContain(CONNECTOR_ID);
  });

  it('returns error for unknown connector', async () => {
    const client = await makeClient(new InMemoryStorage(), {
      connectorRegistry: stubRegistry,
    });
    const result = await client.callTool({
      name: 'trigger_sync',
      arguments: { connector_id: 'ghost' },
    });
    const data = parseResult(result as Parameters<typeof parseResult>[0]) as {
      error: { code: string };
    };
    expect(data.error.code).toBe('NOT_FOUND');
  });
});
