import {
  type HttpResponse,
  connectorUserAgent,
  parseEpoch,
} from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ChunkedSyncCursor,
  type ConnectorContext,
  type ConnectorDoc,
  type CredentialsSchema,
  type StorageHandle,
  type SyncOptions,
  type SyncResult,
  defineConfigFields,
  defineConnectorDoc,
  defineResources,
  makeChunkedCursorGuard,
  paginateChunked,
  schemasFromResources,
  selectActivePhases,
} from '@rawdash/core';
import { z } from 'zod';

export const configFields = defineConfigFields(
  z.object({
    clientId: z.string().min(1).meta({
      label: 'OAuth client ID',
      description:
        'Client ID of the Vanta OAuth application authorized for the Public API. Created under Settings -> Connect -> Public API in Vanta.',
      placeholder: 'vci_AbCdEf...',
    }),
    clientSecret: z.object({ $secret: z.string().min(1) }).meta({
      label: 'OAuth client secret',
      description:
        'Client secret of the Vanta OAuth application. Stored as a secret.',
      placeholder: 'VANTA_CLIENT_SECRET',
      secret: true,
    }),
    scope: z.string().trim().min(1).optional().meta({
      label: 'OAuth scopes',
      description:
        'Space-delimited OAuth scopes requested when minting a token. Defaults to "vanta-api.all:read", which covers every read endpoint this connector calls.',
      placeholder: 'vanta-api.all:read',
    }),
    resources: z
      .array(z.enum(['controls', 'tests', 'findings']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which Vanta resources to sync. Omit to sync all of them. The OAuth client only needs the read scope for the resources listed here.',
      }),
    findingsLookbackDays: z.number().int().positive().optional().meta({
      label: 'Findings lookback (days)',
      description:
        'How many days of test findings to refresh on each full sync. Defaults to 90. Incremental syncs use the run watermark and ignore this field.',
      placeholder: '90',
    }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Vanta',
  category: 'security',
  brandColor: '#45D5BB',
  tagline:
    'Sync controls, tests, and test findings from a Vanta workspace for audit-ready %, failing-test count, and open-finding compliance dashboards.',
  vendor: {
    name: 'Vanta',
    domain: 'vanta.com',
    apiDocs: 'https://developer.vanta.com/',
    website: 'https://www.vanta.com',
  },
  auth: {
    summary:
      'OAuth 2.0 client-credentials flow against a Vanta Public API application. Read-only scopes are sufficient.',
    setup: [
      'Sign in to Vanta as an admin and open Settings -> Connect -> Public API.',
      'Create a new application; grant it read access to the resources you intend to sync (controls, tests, findings).',
      'Copy the generated Client ID and Client Secret. Vanta only shows the secret once.',
      'Store the client secret as a rawdash secret and reference it from the connector config as `clientSecret: secret("VANTA_CLIENT_SECRET")`.',
    ],
  },
  rateLimit:
    'Vanta enforces a per-application quota (50 requests per minute on the default tier) and responds with 429 + Retry-After when exceeded; the shared HTTP client honors Retry-After when scheduling the next request.',
  limitations: [
    'Only controls, tests, and test findings are synced. Frameworks, risks, vendors, audits, people, and document-evidence resources are out of scope.',
    'Controls and tests are full-snapshot resources: every sync re-reads the whole list and rewrites the entity scope on the first page. Tenants with very large catalogs (10k+ controls/tests) should run the connector less often.',
    'Test findings before the configured lookback window (default 90 days) are not refreshed; they remain whatever the most recent sync that did see them wrote.',
  ],
});

export type VantaResource = 'controls' | 'tests' | 'findings';

export interface VantaSettings {
  resources?: readonly VantaResource[];
  scope?: string;
  findingsLookbackDays?: number;
}

const vantaCredentials = {
  clientId: {
    description: 'Vanta Public API OAuth client ID',
    auth: 'required' as const,
  },
  clientSecret: {
    description: 'Vanta Public API OAuth client secret',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type VantaCredentials = typeof vantaCredentials;

const PHASE_ORDER = ['controls', 'tests', 'findings'] as const;

type VantaPhase = (typeof PHASE_ORDER)[number];

type VantaSyncCursor = ChunkedSyncCursor<VantaPhase, string>;

const isVantaSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

const CONTROL_ENTITY = 'vanta_control';
const TEST_ENTITY = 'vanta_test';
const FINDING_EVENT = 'vanta_test_finding';

const API_HOST = 'https://api.vanta.com';
const TOKEN_URL = `${API_HOST}/oauth/token`;
const DEFAULT_SCOPE = 'vanta-api.all:read';
const PAGE_SIZE = 100;
const DEFAULT_FINDINGS_LOOKBACK_DAYS = 90;

const CONTROL_STATUSES = ['PASSING', 'FAILING', 'NEEDS_ATTENTION'] as const;
type ControlStatus = (typeof CONTROL_STATUSES)[number];

const TEST_STATUSES = [
  'OK',
  'NEEDS_ATTENTION',
  'DEACTIVATED',
  'IN_PROGRESS',
] as const;
type TestStatus = (typeof TEST_STATUSES)[number];

const FINDING_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

const idString = z.string().min(1);

const oauthTokenSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
  scope: z.string().optional(),
});

const pageInfoSchema = z
  .object({
    endCursor: z.string().nullish(),
    hasNextPage: z.boolean().nullish(),
  })
  .nullish();

const frameworkRefSchema = z.object({
  name: z.string().nullish(),
  matchingId: z.string().nullish(),
});

const controlSchema = z.object({
  id: idString,
  name: z.string().nullish(),
  description: z.string().nullish(),
  status: z.string().nullish(),
  frameworks: z.array(frameworkRefSchema).nullish(),
  lastEvaluatedAt: z.string().nullish(),
  updatedAt: z.string().nullish(),
  createdAt: z.string().nullish(),
});

const controlsResponseSchema = z.object({
  results: z.object({
    data: z.array(controlSchema),
    pageInfo: pageInfoSchema,
  }),
});

const testSchema = z.object({
  id: idString,
  name: z.string().nullish(),
  description: z.string().nullish(),
  status: z.string().nullish(),
  controlIds: z.array(z.string()).nullish(),
  controls: z.array(z.object({ id: z.string() })).nullish(),
  evidenceCount: z.number().nullish(),
  lastTestedAt: z.string().nullish(),
  updatedAt: z.string().nullish(),
  createdAt: z.string().nullish(),
});

const testsResponseSchema = z.object({
  results: z.object({
    data: z.array(testSchema),
    pageInfo: pageInfoSchema,
  }),
});

const findingSchema = z.object({
  id: idString,
  testId: z.string().nullish(),
  controlId: z.string().nullish(),
  severity: z.string().nullish(),
  status: z.string().nullish(),
  createdAt: z.string(),
  resolvedAt: z.string().nullish(),
  description: z.string().nullish(),
  resourceId: z.string().nullish(),
});

const findingsResponseSchema = z.object({
  results: z.object({
    data: z.array(findingSchema),
    pageInfo: pageInfoSchema,
  }),
});

export const vantaResources = defineResources({
  [CONTROL_ENTITY]: {
    shape: 'entity',
    filterable: [
      {
        field: 'status',
        ops: ['eq'],
        values: ['PASSING', 'FAILING', 'NEEDS_ATTENTION'],
      },
      { field: 'framework', ops: ['eq'] },
    ],
    description:
      'Vanta controls keyed by id. Each control belongs to one or more frameworks (SOC 2, HIPAA, ISO 27001, etc.) and has a roll-up status of PASSING, FAILING, or NEEDS_ATTENTION.',
    endpoint: 'GET /v1/controls',
    notes:
      'Cursor pagination via pageCursor / pageSize. Controls are a full-snapshot resource: a full sync rewrites the scope on first page.',
    fields: [
      { name: 'name', description: 'Human-readable control name.' },
      {
        name: 'status',
        description: 'Roll-up status (PASSING, FAILING, or NEEDS_ATTENTION).',
      },
      {
        name: 'framework',
        description:
          'Name of the first framework the control is mapped to (e.g. "SOC 2"). Use the framework dimension for distributions when a control maps to several frameworks.',
      },
      {
        name: 'frameworks',
        description:
          'Comma-separated list of every framework the control is mapped to.',
      },
      {
        name: 'lastEvaluated',
        description: 'When Vanta last evaluated the control (Unix ms).',
      },
    ],
    responses: {
      oauth_token: oauthTokenSchema,
      controls: controlsResponseSchema,
    },
  },
  [TEST_ENTITY]: {
    shape: 'entity',
    filterable: [
      {
        field: 'status',
        ops: ['eq'],
        values: ['OK', 'NEEDS_ATTENTION', 'DEACTIVATED', 'IN_PROGRESS'],
      },
    ],
    description:
      'Vanta tests keyed by id. A test is the smallest unit of evaluation in Vanta and may be mapped to multiple controls.',
    endpoint: 'GET /v1/tests',
    notes:
      'Cursor pagination via pageCursor / pageSize. Tests are a full-snapshot resource.',
    fields: [
      { name: 'name', description: 'Human-readable test name.' },
      {
        name: 'status',
        description:
          'Test status (OK, NEEDS_ATTENTION, DEACTIVATED, or IN_PROGRESS).',
      },
      {
        name: 'controlId',
        description:
          'First control id the test is mapped to (a test may be mapped to several controls).',
      },
      {
        name: 'controlCount',
        description: 'Number of controls the test is mapped to.',
      },
      {
        name: 'evidenceCount',
        description:
          'Number of distinct evidence rows backing the test (counter maintained by Vanta).',
      },
      {
        name: 'lastTested',
        description: 'When Vanta last ran the test (Unix ms).',
      },
    ],
    responses: { tests: testsResponseSchema },
  },
  [FINDING_EVENT]: {
    shape: 'event',
    filterable: [
      {
        field: 'severity',
        ops: ['eq'],
        values: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
      },
      {
        field: 'status',
        ops: ['eq'],
        values: ['OPEN', 'RESOLVED', 'DEFERRED', 'WONT_FIX'],
      },
    ],
    description:
      'Test findings (one event per finding row), with severity, the test it came from, and resolved-at when applicable. Useful for open-finding counts and MTTR-to-resolution timeseries.',
    endpoint: 'GET /v1/test-findings',
    notes:
      'Cursor pagination via pageCursor / pageSize. Full syncs walk back findingsLookbackDays days; incremental syncs use the sync `since` watermark.',
    fields: [
      { name: 'findingId', description: 'Vanta finding id.' },
      {
        name: 'severity',
        description: 'Finding severity (LOW, MEDIUM, HIGH, CRITICAL).',
      },
      {
        name: 'status',
        description: 'Finding status (OPEN, RESOLVED, DEFERRED, WONT_FIX).',
      },
      {
        name: 'testId',
        description: 'Id of the test that produced the finding.',
      },
      {
        name: 'controlId',
        description:
          'First control id the finding is mapped to (via its test).',
      },
      {
        name: 'resolvedAt',
        description: 'Resolution timestamp (Unix ms) when resolved.',
      },
    ],
    responses: { findings: findingsResponseSchema },
  },
});

export const id = 'vanta';

type ControlsResponse = z.infer<typeof controlsResponseSchema>;
type TestsResponse = z.infer<typeof testsResponseSchema>;
type FindingsResponse = z.infer<typeof findingsResponseSchema>;
type OauthTokenResponse = z.infer<typeof oauthTokenSchema>;
type VantaControl = z.infer<typeof controlSchema>;
type VantaTest = z.infer<typeof testSchema>;
type VantaFinding = z.infer<typeof findingSchema>;

function isControlStatus(value: string): value is ControlStatus {
  return (CONTROL_STATUSES as readonly string[]).includes(value);
}

function isTestStatus(value: string): value is TestStatus {
  return (TEST_STATUSES as readonly string[]).includes(value);
}

function isFindingSeverity(value: string): value is FindingSeverity {
  return (FINDING_SEVERITIES as readonly string[]).includes(value);
}

function normalizeFrameworks(control: VantaControl): {
  primary: string | null;
  list: string;
} {
  const frameworks = control.frameworks ?? [];
  const names: string[] = [];
  for (const f of frameworks) {
    if (typeof f.name === 'string' && f.name.length > 0) {
      names.push(f.name);
    }
  }
  if (names.length === 0) {
    return { primary: null, list: '' };
  }
  return { primary: names[0]!, list: names.join(',') };
}

function controlIdsForTest(test: VantaTest): string[] {
  if (Array.isArray(test.controlIds) && test.controlIds.length > 0) {
    return test.controlIds.filter((s) => typeof s === 'string' && s.length > 0);
  }
  if (Array.isArray(test.controls) && test.controls.length > 0) {
    return test.controls
      .map((c) => c.id)
      .filter((s) => typeof s === 'string' && s.length > 0);
  }
  return [];
}

export class VantaConnector extends BaseConnector<
  VantaSettings,
  VantaCredentials
> {
  static readonly id = id;

  static readonly resources = vantaResources;

  static readonly schemas = schemasFromResources(vantaResources);

  static create(input: unknown, ctx?: ConnectorContext): VantaConnector {
    const parsed = configFields.parse(input);
    return new VantaConnector(
      {
        resources: parsed.resources,
        scope: parsed.scope,
        findingsLookbackDays: parsed.findingsLookbackDays,
      },
      {
        clientId: parsed.clientId,
        clientSecret: parsed.clientSecret,
      },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = vantaCredentials;

  private accessToken: string | null = null;
  private accessTokenExpiry = 0;

  private scope(): string {
    return this.settings.scope ?? DEFAULT_SCOPE;
  }

  private async refreshAccessToken(signal?: AbortSignal): Promise<string> {
    const res = await this.post<OauthTokenResponse>(TOKEN_URL, {
      resource: 'oauth_token',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': connectorUserAgent('vanta'),
      },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: this.creds.clientId,
        client_secret: this.creds.clientSecret,
        scope: this.scope(),
      }),
      signal,
    });
    const token = res.body.access_token;
    const expiresIn = res.body.expires_in ?? 3600;
    this.accessToken = token;
    this.accessTokenExpiry = Date.now() + (expiresIn - 60) * 1000;
    return token;
  }

  private async getAccessToken(signal?: AbortSignal): Promise<string> {
    if (!this.accessToken || Date.now() >= this.accessTokenExpiry) {
      return this.refreshAccessToken(signal);
    }
    return this.accessToken;
  }

  private async apiGet<T>(
    url: string,
    resource: string,
    signal?: AbortSignal,
  ): Promise<HttpResponse<T>> {
    const token = await this.getAccessToken(signal);
    return this.get<T>(url, {
      resource,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'User-Agent': connectorUserAgent('vanta'),
      },
      signal,
    });
  }

  private buildListUrl(
    path: string,
    cursor: string | null,
    extra?: Record<string, string>,
  ): string {
    const u = new URL(`${API_HOST}${path}`);
    u.searchParams.set('pageSize', String(PAGE_SIZE));
    if (cursor) {
      u.searchParams.set('pageCursor', cursor);
    }
    if (extra) {
      for (const [k, v] of Object.entries(extra)) {
        u.searchParams.set(k, v);
      }
    }
    return u.toString();
  }

  private nextCursor(
    pageInfo:
      | { endCursor?: string | null; hasNextPage?: boolean | null }
      | null
      | undefined,
  ): string | null {
    if (!pageInfo) {
      return null;
    }
    if (pageInfo.hasNextPage === false) {
      return null;
    }
    return pageInfo.endCursor ?? null;
  }

  private async fetchControlsPage(
    cursor: string | null,
    signal: AbortSignal | undefined,
  ): Promise<{ items: VantaControl[]; next: string | null }> {
    const url = this.buildListUrl('/v1/controls', cursor);
    const res = await this.apiGet<ControlsResponse>(url, 'controls', signal);
    return {
      items: res.body.results.data,
      next: this.nextCursor(res.body.results.pageInfo),
    };
  }

  private async fetchTestsPage(
    cursor: string | null,
    signal: AbortSignal | undefined,
  ): Promise<{ items: VantaTest[]; next: string | null }> {
    const url = this.buildListUrl('/v1/tests', cursor);
    const res = await this.apiGet<TestsResponse>(url, 'tests', signal);
    return {
      items: res.body.results.data,
      next: this.nextCursor(res.body.results.pageInfo),
    };
  }

  private findingsSinceIso(options: SyncOptions): string {
    if (options.since) {
      return options.since;
    }
    const lookback =
      this.settings.findingsLookbackDays ?? DEFAULT_FINDINGS_LOOKBACK_DAYS;
    const since = new Date(Date.now() - lookback * 24 * 60 * 60 * 1000);
    return since.toISOString();
  }

  private async fetchFindingsPage(
    cursor: string | null,
    options: SyncOptions,
    signal: AbortSignal | undefined,
  ): Promise<{ items: VantaFinding[]; next: string | null }> {
    const url = this.buildListUrl('/v1/test-findings', cursor, {
      createdAfter: this.findingsSinceIso(options),
    });
    const res = await this.apiGet<FindingsResponse>(url, 'findings', signal);
    return {
      items: res.body.results.data,
      next: this.nextCursor(res.body.results.pageInfo),
    };
  }

  private async writeControls(
    storage: StorageHandle,
    items: VantaControl[],
  ): Promise<void> {
    for (const c of items) {
      const { primary, list } = normalizeFrameworks(c);
      const status =
        typeof c.status === 'string' && isControlStatus(c.status)
          ? c.status
          : (c.status ?? null);
      const updatedMs =
        parseEpoch(c.updatedAt ?? null, 'iso') ??
        parseEpoch(c.lastEvaluatedAt ?? null, 'iso') ??
        parseEpoch(c.createdAt ?? null, 'iso') ??
        0;
      await storage.entity({
        type: CONTROL_ENTITY,
        id: c.id,
        attributes: {
          name: c.name ?? null,
          status,
          framework: primary,
          frameworks: list,
          lastEvaluated: parseEpoch(c.lastEvaluatedAt ?? null, 'iso'),
        },
        updated_at: updatedMs,
      });
    }
  }

  private async writeTests(
    storage: StorageHandle,
    items: VantaTest[],
  ): Promise<void> {
    for (const t of items) {
      const controlIds = controlIdsForTest(t);
      const status =
        typeof t.status === 'string' && isTestStatus(t.status)
          ? t.status
          : (t.status ?? null);
      const updatedMs =
        parseEpoch(t.updatedAt ?? null, 'iso') ??
        parseEpoch(t.lastTestedAt ?? null, 'iso') ??
        parseEpoch(t.createdAt ?? null, 'iso') ??
        0;
      await storage.entity({
        type: TEST_ENTITY,
        id: t.id,
        attributes: {
          name: t.name ?? null,
          status,
          controlId: controlIds[0] ?? null,
          controlCount: controlIds.length,
          evidenceCount: t.evidenceCount ?? null,
          lastTested: parseEpoch(t.lastTestedAt ?? null, 'iso'),
        },
        updated_at: updatedMs,
      });
    }
  }

  private async writeFindings(
    storage: StorageHandle,
    items: VantaFinding[],
    sinceMs: number | null,
  ): Promise<void> {
    for (const f of items) {
      const ts = parseEpoch(f.createdAt, 'iso');
      if (ts === null) {
        continue;
      }
      if (sinceMs !== null && ts < sinceMs) {
        continue;
      }
      const severity =
        typeof f.severity === 'string' && isFindingSeverity(f.severity)
          ? f.severity
          : (f.severity ?? null);
      const resolvedMs = parseEpoch(f.resolvedAt ?? null, 'iso');
      await storage.event({
        name: FINDING_EVENT,
        start_ts: ts,
        end_ts: resolvedMs,
        attributes: {
          findingId: f.id,
          severity,
          status: f.status ?? null,
          testId: f.testId ?? null,
          controlId: f.controlId ?? null,
          resolvedAt: resolvedMs,
        },
      });
    }
  }

  private async writePhase(
    storage: StorageHandle,
    phase: VantaPhase,
    items: unknown[],
    sinceMs: number | null,
  ): Promise<void> {
    switch (phase) {
      case 'controls':
        return this.writeControls(storage, items as VantaControl[]);
      case 'tests':
        return this.writeTests(storage, items as VantaTest[]);
      case 'findings':
        return this.writeFindings(storage, items as VantaFinding[], sinceMs);
    }
  }

  private async clearScopeOnFirstPage(
    storage: StorageHandle,
    phase: VantaPhase,
    isFull: boolean,
  ): Promise<void> {
    switch (phase) {
      case 'controls':
        await storage.entities([], { types: [CONTROL_ENTITY] });
        return;
      case 'tests':
        await storage.entities([], { types: [TEST_ENTITY] });
        return;
      case 'findings':
        if (isFull) {
          await storage.events([], { names: [FINDING_EVENT] });
        }
        return;
    }
  }

  private resolveCursor(cursor: unknown): VantaSyncCursor | undefined {
    return isVantaSyncCursor(cursor) ? cursor : undefined;
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor = this.resolveCursor(options.cursor);
    const isFull = options.mode === 'full';

    const phases = selectActivePhases<VantaResource, VantaPhase>(
      (r) => r,
      PHASE_ORDER,
      this.settings.resources,
    );

    const sinceMs = options.since ? Date.parse(options.since) : null;

    return paginateChunked<VantaPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: async (phase, page, sig) => {
        switch (phase) {
          case 'controls':
            return this.fetchControlsPage(page, sig);
          case 'tests':
            return this.fetchTestsPage(page, sig);
          case 'findings':
            return this.fetchFindingsPage(page, options, sig);
        }
      },
      writeBatch: async (phase, items, page) => {
        if (page === null) {
          await this.clearScopeOnFirstPage(storage, phase, isFull);
        }
        await this.writePhase(
          storage,
          phase,
          items,
          phase === 'findings' ? sinceMs : null,
        );
      },
    });
  }
}
