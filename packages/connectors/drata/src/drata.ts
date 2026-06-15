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
    apiKey: z.object({ $secret: z.string().min(1) }).meta({
      label: 'Drata API key',
      description:
        'Drata Public API key. Generated under Settings -> Integrations -> Public API. Treated as a bearer token. Stored as a secret.',
      placeholder: 'DRATA_API_KEY',
      secret: true,
    }),
    baseUrl: z
      .string()
      .trim()
      .url()
      .optional()
      .refine((u) => u === undefined || !u.endsWith('/'), {
        message: 'baseUrl must not end with a trailing slash.',
      })
      .meta({
        label: 'Base URL',
        description:
          'Override the Drata Public API base URL. Defaults to "https://public-api.drata.com". Useful for sandbox / region-specific tenants.',
        placeholder: 'https://public-api.drata.com',
      }),
    resources: z
      .array(z.enum(['controls', 'tests', 'personnel', 'findings']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which Drata resources to sync. Omit to sync all of them. The API key only needs read access to the resources listed here.',
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
  displayName: 'Drata',
  category: 'security',
  brandColor: '#6D2BFF',
  tagline:
    'Sync controls, tests, personnel, and test findings from Drata for audit-ready %, failing-test count, training-completion, and open-finding compliance dashboards.',
  vendor: {
    name: 'Drata',
    domain: 'drata.com',
    apiDocs: 'https://developers.drata.com/',
    website: 'https://drata.com',
  },
  auth: {
    summary:
      'Bearer-token auth with a Drata Public API key. Read access to the resources you sync is sufficient.',
    setup: [
      'Sign in to Drata as an admin and open Settings -> Integrations -> Public API.',
      'Create a new API key; grant it read access to the resources you intend to sync (controls, tests, personnel, findings).',
      'Copy the generated key. Drata only shows the key once.',
      'Store the key as a rawdash secret and reference it from the connector config as `apiKey: secret("DRATA_API_KEY")`.',
    ],
  },
  rateLimit:
    'Drata enforces a per-tenant quota and responds with 429 + Retry-After when exceeded; the shared HTTP client honors Retry-After when scheduling the next request.',
  limitations: [
    'Only controls, tests, personnel, and test findings are synced. Frameworks, risks, vendors, audits, and document-evidence resources are out of scope.',
    'Controls, tests, and personnel are full-snapshot resources: every sync re-reads the whole list and rewrites the entity scope on the first page. Tenants with very large catalogs (10k+ controls/tests) should run the connector less often.',
    'Test findings before the configured lookback window (default 90 days) are not refreshed; they remain whatever the most recent sync that did see them wrote.',
  ],
});

export type DrataResource = 'controls' | 'tests' | 'personnel' | 'findings';

export interface DrataSettings {
  baseUrl?: string;
  resources?: readonly DrataResource[];
  findingsLookbackDays?: number;
}

const drataCredentials = {
  apiKey: {
    description: 'Drata Public API key',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type DrataCredentials = typeof drataCredentials;

const PHASE_ORDER = ['controls', 'tests', 'personnel', 'findings'] as const;

type DrataPhase = (typeof PHASE_ORDER)[number];

type DrataSyncCursor = ChunkedSyncCursor<DrataPhase, string>;

const isDrataSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

const CONTROL_ENTITY = 'drata_control';
const TEST_ENTITY = 'drata_test';
const PERSONNEL_ENTITY = 'drata_personnel';
const FINDING_EVENT = 'drata_test_finding';

const DEFAULT_BASE_URL = 'https://public-api.drata.com';
const PAGE_SIZE = 100;
const DEFAULT_FINDINGS_LOOKBACK_DAYS = 90;

const CONTROL_STATUSES = [
  'PASSING',
  'FAILING',
  'NEEDS_ATTENTION',
  'DEACTIVATED',
] as const;
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

const paginationSchema = z
  .object({
    nextCursor: z.string().nullish(),
    hasMore: z.boolean().nullish(),
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
  data: z.array(controlSchema),
  pagination: paginationSchema,
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
  data: z.array(testSchema),
  pagination: paginationSchema,
});

const personnelSchema = z.object({
  id: idString,
  email: z.string().nullish(),
  firstName: z.string().nullish(),
  lastName: z.string().nullish(),
  role: z.string().nullish(),
  employmentStatus: z.string().nullish(),
  startDate: z.string().nullish(),
  trainingStatus: z.string().nullish(),
  trainingCompletedAt: z.string().nullish(),
  updatedAt: z.string().nullish(),
  createdAt: z.string().nullish(),
});

const personnelResponseSchema = z.object({
  data: z.array(personnelSchema),
  pagination: paginationSchema,
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
  data: z.array(findingSchema),
  pagination: paginationSchema,
});

export const drataResources = defineResources({
  [CONTROL_ENTITY]: {
    shape: 'entity',
    filterable: [
      {
        field: 'status',
        ops: ['eq'],
        values: ['PASSING', 'FAILING', 'NEEDS_ATTENTION', 'DEACTIVATED'],
      },
      { field: 'framework', ops: ['eq'] },
    ],
    description:
      'Drata controls keyed by id. Each control belongs to one or more frameworks (SOC 2, HIPAA, ISO 27001, etc.) and has a roll-up status of PASSING, FAILING, or NEEDS_ATTENTION.',
    endpoint: 'GET /v1/controls',
    notes:
      'Cursor pagination via cursor / limit. Controls are a full-snapshot resource: a full sync rewrites the scope on first page.',
    fields: [
      { name: 'name', description: 'Human-readable control name.' },
      {
        name: 'status',
        description:
          'Roll-up status (PASSING, FAILING, NEEDS_ATTENTION, or DEACTIVATED).',
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
        description: 'When Drata last evaluated the control (Unix ms).',
      },
    ],
    responses: {
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
      'Drata tests keyed by id. A test is the smallest unit of evaluation in Drata and may be mapped to multiple controls.',
    endpoint: 'GET /v1/tests',
    notes:
      'Cursor pagination via cursor / limit. Tests are a full-snapshot resource.',
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
          'Number of distinct evidence rows backing the test (counter maintained by Drata).',
      },
      {
        name: 'lastTested',
        description: 'When Drata last ran the test (Unix ms).',
      },
    ],
    responses: { tests: testsResponseSchema },
  },
  [PERSONNEL_ENTITY]: {
    shape: 'entity',
    filterable: [
      {
        field: 'employmentStatus',
        ops: ['eq'],
      },
      {
        field: 'trainingStatus',
        ops: ['eq'],
      },
    ],
    description:
      'Drata personnel records keyed by id. Surfaces employment status, role, training completion, and training-completed timestamp for compliance-training dashboards.',
    endpoint: 'GET /v1/personnel',
    notes:
      'Cursor pagination via cursor / limit. Personnel is a full-snapshot resource.',
    fields: [
      { name: 'email', description: 'Work email address.' },
      { name: 'name', description: 'Full name ("firstName lastName").' },
      { name: 'role', description: 'Reported role / job title.' },
      {
        name: 'employmentStatus',
        description:
          'Reported employment status (e.g. ACTIVE, ONBOARDING, OFFBOARDED).',
      },
      {
        name: 'trainingStatus',
        description:
          'Reported security-training status (e.g. COMPLETED, IN_PROGRESS, NOT_STARTED, OVERDUE).',
      },
      {
        name: 'trainingCompleted',
        description:
          'When the most recent training was marked completed (Unix ms).',
      },
      {
        name: 'startDate',
        description: 'Reported employment start date (Unix ms).',
      },
    ],
    responses: { personnel: personnelResponseSchema },
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
    endpoint: 'GET /v1/findings',
    notes:
      'Cursor pagination via cursor / limit. Full syncs walk back findingsLookbackDays days; incremental syncs use the sync `since` watermark.',
    fields: [
      { name: 'findingId', description: 'Drata finding id.' },
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

export const id = 'drata';

type ControlsResponse = z.infer<typeof controlsResponseSchema>;
type TestsResponse = z.infer<typeof testsResponseSchema>;
type PersonnelResponse = z.infer<typeof personnelResponseSchema>;
type FindingsResponse = z.infer<typeof findingsResponseSchema>;
type DrataControl = z.infer<typeof controlSchema>;
type DrataTest = z.infer<typeof testSchema>;
type DrataPersonnel = z.infer<typeof personnelSchema>;
type DrataFinding = z.infer<typeof findingSchema>;

function isControlStatus(value: string): value is ControlStatus {
  return (CONTROL_STATUSES as readonly string[]).includes(value);
}

function isTestStatus(value: string): value is TestStatus {
  return (TEST_STATUSES as readonly string[]).includes(value);
}

function isFindingSeverity(value: string): value is FindingSeverity {
  return (FINDING_SEVERITIES as readonly string[]).includes(value);
}

function normalizeFrameworks(control: DrataControl): {
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

function controlIdsForTest(test: DrataTest): string[] {
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

function personnelFullName(p: DrataPersonnel): string | null {
  const parts = [p.firstName, p.lastName]
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) {
    return null;
  }
  return parts.join(' ');
}

export class DrataConnector extends BaseConnector<
  DrataSettings,
  DrataCredentials
> {
  static readonly id = id;

  static readonly resources = drataResources;

  static readonly schemas = schemasFromResources(drataResources);

  static create(input: unknown, ctx?: ConnectorContext): DrataConnector {
    const parsed = configFields.parse(input);
    return new DrataConnector(
      {
        baseUrl: parsed.baseUrl,
        resources: parsed.resources,
        findingsLookbackDays: parsed.findingsLookbackDays,
      },
      {
        apiKey: parsed.apiKey,
      },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = drataCredentials;

  private baseUrl(): string {
    return this.settings.baseUrl ?? DEFAULT_BASE_URL;
  }

  private async apiGet<T>(
    url: string,
    resource: string,
    signal?: AbortSignal,
  ): Promise<HttpResponse<T>> {
    return this.get<T>(url, {
      resource,
      headers: {
        Authorization: `Bearer ${this.creds.apiKey}`,
        Accept: 'application/json',
        'User-Agent': connectorUserAgent('drata'),
      },
      signal,
    });
  }

  private buildListUrl(
    path: string,
    cursor: string | null,
    extra?: Record<string, string>,
  ): string {
    const u = new URL(`${this.baseUrl()}${path}`);
    u.searchParams.set('limit', String(PAGE_SIZE));
    if (cursor) {
      u.searchParams.set('cursor', cursor);
    }
    if (extra) {
      for (const [k, v] of Object.entries(extra)) {
        u.searchParams.set(k, v);
      }
    }
    return u.toString();
  }

  private nextCursor(
    pagination:
      | { nextCursor?: string | null; hasMore?: boolean | null }
      | null
      | undefined,
  ): string | null {
    if (!pagination) {
      return null;
    }
    if (pagination.hasMore === false) {
      return null;
    }
    return pagination.nextCursor ?? null;
  }

  private async fetchControlsPage(
    cursor: string | null,
    signal: AbortSignal | undefined,
  ): Promise<{ items: DrataControl[]; next: string | null }> {
    const url = this.buildListUrl('/v1/controls', cursor);
    const res = await this.apiGet<ControlsResponse>(url, 'controls', signal);
    return {
      items: res.body.data,
      next: this.nextCursor(res.body.pagination),
    };
  }

  private async fetchTestsPage(
    cursor: string | null,
    signal: AbortSignal | undefined,
  ): Promise<{ items: DrataTest[]; next: string | null }> {
    const url = this.buildListUrl('/v1/tests', cursor);
    const res = await this.apiGet<TestsResponse>(url, 'tests', signal);
    return {
      items: res.body.data,
      next: this.nextCursor(res.body.pagination),
    };
  }

  private async fetchPersonnelPage(
    cursor: string | null,
    signal: AbortSignal | undefined,
  ): Promise<{ items: DrataPersonnel[]; next: string | null }> {
    const url = this.buildListUrl('/v1/personnel', cursor);
    const res = await this.apiGet<PersonnelResponse>(url, 'personnel', signal);
    return {
      items: res.body.data,
      next: this.nextCursor(res.body.pagination),
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
  ): Promise<{ items: DrataFinding[]; next: string | null }> {
    const url = this.buildListUrl('/v1/findings', cursor, {
      createdAfter: this.findingsSinceIso(options),
    });
    const res = await this.apiGet<FindingsResponse>(url, 'findings', signal);
    return {
      items: res.body.data,
      next: this.nextCursor(res.body.pagination),
    };
  }

  private async writeControls(
    storage: StorageHandle,
    items: DrataControl[],
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
    items: DrataTest[],
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

  private async writePersonnel(
    storage: StorageHandle,
    items: DrataPersonnel[],
  ): Promise<void> {
    for (const p of items) {
      const updatedMs =
        parseEpoch(p.updatedAt ?? null, 'iso') ??
        parseEpoch(p.trainingCompletedAt ?? null, 'iso') ??
        parseEpoch(p.createdAt ?? null, 'iso') ??
        0;
      await storage.entity({
        type: PERSONNEL_ENTITY,
        id: p.id,
        attributes: {
          email: p.email ?? null,
          name: personnelFullName(p),
          role: p.role ?? null,
          employmentStatus: p.employmentStatus ?? null,
          trainingStatus: p.trainingStatus ?? null,
          trainingCompleted: parseEpoch(p.trainingCompletedAt ?? null, 'iso'),
          startDate: parseEpoch(p.startDate ?? null, 'iso'),
        },
        updated_at: updatedMs,
      });
    }
  }

  private async writeFindings(
    storage: StorageHandle,
    items: DrataFinding[],
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
    phase: DrataPhase,
    items: unknown[],
    sinceMs: number | null,
  ): Promise<void> {
    switch (phase) {
      case 'controls':
        return this.writeControls(storage, items as DrataControl[]);
      case 'tests':
        return this.writeTests(storage, items as DrataTest[]);
      case 'personnel':
        return this.writePersonnel(storage, items as DrataPersonnel[]);
      case 'findings':
        return this.writeFindings(storage, items as DrataFinding[], sinceMs);
    }
  }

  private async clearScopeOnFirstPage(
    storage: StorageHandle,
    phase: DrataPhase,
    isFull: boolean,
  ): Promise<void> {
    switch (phase) {
      case 'controls':
        await storage.entities([], { types: [CONTROL_ENTITY] });
        return;
      case 'tests':
        await storage.entities([], { types: [TEST_ENTITY] });
        return;
      case 'personnel':
        await storage.entities([], { types: [PERSONNEL_ENTITY] });
        return;
      case 'findings':
        if (isFull) {
          await storage.events([], { names: [FINDING_EVENT] });
        }
        return;
    }
  }

  private resolveCursor(cursor: unknown): DrataSyncCursor | undefined {
    return isDrataSyncCursor(cursor) ? cursor : undefined;
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor = this.resolveCursor(options.cursor);
    const isFull = options.mode === 'full';

    const phases = selectActivePhases<DrataResource, DrataPhase>(
      (r) => r,
      PHASE_ORDER,
      this.settings.resources,
    );

    const sinceMs = options.since ? Date.parse(options.since) : null;

    return paginateChunked<DrataPhase, string>({
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
          case 'personnel':
            return this.fetchPersonnelPage(page, sig);
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
