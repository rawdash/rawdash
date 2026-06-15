import {
  type HttpResponse,
  connectorUserAgent,
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
    apiEndpoint: z
      .string()
      .url()
      .regex(
        /^https:\/\/api\.[a-z0-9-]+\.app\.wiz\.io\/graphql$/i,
        'Wiz GraphQL endpoint, e.g. "https://api.us1.app.wiz.io/graphql".',
      )
      .meta({
        label: 'GraphQL API endpoint',
        description:
          'Tenant-specific Wiz GraphQL endpoint shown on the Wiz service-account page (e.g. "https://api.us1.app.wiz.io/graphql"). The region segment changes per data residency.',
        placeholder: 'https://api.us1.app.wiz.io/graphql',
      }),
    clientId: z.string().min(1).meta({
      label: 'Service-account client ID',
      description:
        'Client ID of the Wiz service account authorized for the API.',
      placeholder: 'aaaa-bbbb-cccc-dddd',
    }),
    clientSecret: z.object({ $secret: z.string().min(1) }).meta({
      label: 'Service-account client secret',
      description:
        'Client secret of the Wiz service account. Stored as a secret.',
      placeholder: 'WIZ_CLIENT_SECRET',
      secret: true,
    }),
    tokenEndpoint: z.string().url().optional().meta({
      label: 'OAuth token endpoint (optional)',
      description:
        'Override the OAuth 2.0 token endpoint. Defaults to https://auth.app.wiz.io/oauth/token; use the gov / fed equivalent for non-commercial deployments.',
      placeholder: 'https://auth.app.wiz.io/oauth/token',
    }),
    audience: z.string().min(1).optional().meta({
      label: 'OAuth audience (optional)',
      description:
        'OAuth audience claim requested when minting the access token. Defaults to "wiz-api"; some legacy tenants require "beyond-api".',
      placeholder: 'wiz-api',
    }),
    resources: z
      .array(z.enum(['issues', 'issue_events', 'vulnerabilities']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which Wiz resources to sync. Omit to sync all of them. The issues and issue_events resources share the same underlying GraphQL query.',
      }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Wiz',
  category: 'security',
  brandColor: '#11253E',
  tagline:
    'Sync cloud-security issues, issue lifecycle events, and vulnerability findings from a Wiz tenant for open-critical, MTTR, and posture dashboards.',
  vendor: {
    name: 'Wiz',
    domain: 'wiz.io',
    apiDocs: 'https://win.wiz.io/reference/welcome',
    website: 'https://wiz.io',
  },
  auth: {
    summary:
      'OAuth 2.0 client-credentials flow against a Wiz service account. The connector mints an access token, refreshes it on expiry, and sends it as a Bearer header on every GraphQL request.',
    setup: [
      'In the Wiz portal, open Settings -> Service Accounts and create a new service account.',
      'Grant it the read scopes for the resources you intend to sync (typically read:issues and read:vulnerabilities).',
      'Copy the Client ID, Client Secret, and Token Endpoint shown on the service-account page.',
      'Copy the GraphQL API endpoint shown on the same page (e.g. "https://api.us1.app.wiz.io/graphql"); the region segment is tenant-specific.',
      'Store the client secret as a rawdash secret and reference it from the connector config as `clientSecret: secret("WIZ_CLIENT_SECRET")`.',
    ],
  },
  limitations: [
    "Issue lifecycle events are derived from each issue's createdAt / resolvedAt timestamps, not from a dedicated audit-log endpoint, so administrative reopen / re-resolve transitions inside the same sync window are collapsed to the latest state.",
    'Service-account auth only; per-user OAuth is out of scope.',
    'Cloud-configuration and threat-detection issues are returned by the same /issues query and are not segmented at the connector layer; filter on the `issueType` attribute downstream.',
  ],
});

export type WizResource = 'issues' | 'issue_events' | 'vulnerabilities';

export interface WizSettings {
  apiEndpoint: string;
  tokenEndpoint?: string;
  audience?: string;
  resources?: readonly WizResource[];
}

const wizCredentials = {
  clientId: {
    description: 'Wiz service-account client ID',
    auth: 'required' as const,
  },
  clientSecret: {
    description: 'Wiz service-account client secret',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type WizCredentials = typeof wizCredentials;

const PHASE_ORDER = ['issues', 'vulnerabilities'] as const;

type WizPhase = (typeof PHASE_ORDER)[number];

type WizSyncCursor = ChunkedSyncCursor<WizPhase, string>;

const isWizSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

const ISSUE_ENTITY = 'wiz_issue';
const ISSUE_EVENT = 'wiz_issue_event';
const VULNERABILITY_ENTITY = 'wiz_vulnerability';

const DEFAULT_TOKEN_ENDPOINT = 'https://auth.app.wiz.io/oauth/token';
const DEFAULT_AUDIENCE = 'wiz-api';
const PAGE_SIZE = 100;
const TOKEN_EXPIRY_GRACE_S = 60;

const SEVERITIES = [
  'CRITICAL',
  'HIGH',
  'MEDIUM',
  'LOW',
  'INFORMATIONAL',
] as const;
type Severity = (typeof SEVERITIES)[number];

const ISSUE_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED'] as const;
type IssueStatus = (typeof ISSUE_STATUSES)[number];

const VULN_STATUSES = ['OPEN', 'RESOLVED', 'IGNORED', 'IN_PROGRESS'] as const;
type VulnStatus = (typeof VULN_STATUSES)[number];

const ISSUE_EVENT_KINDS = ['opened', 'resolved'] as const;
type IssueEventKind = (typeof ISSUE_EVENT_KINDS)[number];

const idString = z.string().min(1);
const isoString = z.string().min(1);

const oauthTokenSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
});

const entitySnapshotSchema = z.object({
  id: idString.nullable().optional(),
  name: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
  cloudProvider: z.string().nullable().optional(),
  externalId: z.string().nullable().optional(),
});

const sourceRuleSchema = z.object({
  id: idString.nullable().optional(),
  name: z.string().nullable().optional(),
});

const issueSchema = z.object({
  id: idString,
  severity: z.string(),
  status: z.string(),
  type: z.string().nullable().optional(),
  resolutionReason: z.string().nullable().optional(),
  createdAt: isoString,
  updatedAt: isoString.nullable().optional(),
  resolvedAt: isoString.nullable().optional(),
  dueAt: isoString.nullable().optional(),
  sourceRule: sourceRuleSchema.nullable().optional(),
  entitySnapshot: entitySnapshotSchema.nullable().optional(),
});

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

const issuesArraySchema = z.array(issueSchema);

interface IssuesResponse {
  data?: {
    issues?: {
      nodes?: z.infer<typeof issueSchema>[];
      pageInfo?: PageInfo;
    };
  };
  errors?: Array<{ message: string }>;
}

const vulnerableAssetSchema = z.object({
  id: idString.nullable().optional(),
  name: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
  cloudPlatform: z.string().nullable().optional(),
});

const vulnerabilitySchema = z.object({
  id: idString,
  name: z.string().nullable().optional(),
  severity: z.string(),
  status: z.string(),
  vulnerabilityExternalId: z.string().nullable().optional(),
  firstDetectedAt: isoString.nullable().optional(),
  lastDetectedAt: isoString.nullable().optional(),
  resolvedAt: isoString.nullable().optional(),
  vulnerableAsset: vulnerableAssetSchema.nullable().optional(),
});

const vulnerabilitiesArraySchema = z.array(vulnerabilitySchema);

interface VulnerabilitiesResponse {
  data?: {
    vulnerabilityFindings?: {
      nodes?: z.infer<typeof vulnerabilitySchema>[];
      pageInfo?: PageInfo;
    };
  };
  errors?: Array<{ message: string }>;
}

export const wizResources = defineResources({
  [ISSUE_ENTITY]: {
    shape: 'entity',
    filterable: [
      {
        field: 'severity',
        ops: ['eq'],
        values: [...SEVERITIES],
      },
      {
        field: 'status',
        ops: ['eq'],
        values: [...ISSUE_STATUSES],
      },
      { field: 'cloudProvider', ops: ['eq'] },
      { field: 'resourceType', ops: ['eq'] },
    ],
    description:
      'Wiz issues (cloud-configuration, toxic-combination, and threat-detection findings) keyed by issue id, with severity, status, the offending entity snapshot, and lifecycle timestamps.',
    endpoint: 'GraphQL query: issues { nodes { ... } }',
    notes:
      'Paginated via the GraphQL connection cursor; incremental syncs filter on updatedAt.after and stop once a page is entirely older than options.since.',
    fields: [
      {
        name: 'severity',
        description: 'CRITICAL, HIGH, MEDIUM, LOW, or INFORMATIONAL.',
      },
      { name: 'status', description: 'OPEN, IN_PROGRESS, RESOLVED, REJECTED.' },
      {
        name: 'issueType',
        description:
          'Issue category (e.g. CLOUD_CONFIGURATION, TOXIC_COMBINATION).',
      },
      {
        name: 'ruleName',
        description: 'Name of the source rule that produced the issue.',
      },
      {
        name: 'resourceName',
        description: 'Name of the cloud resource the issue applies to.',
      },
      {
        name: 'resourceType',
        description:
          'Type of the cloud resource (e.g. EC2_INSTANCE, S3_BUCKET).',
      },
      {
        name: 'cloudProvider',
        description: 'AWS, GCP, AZURE, etc.',
      },
      {
        name: 'createdAt',
        description: 'When Wiz first opened the issue (Unix ms).',
      },
      {
        name: 'resolvedAt',
        description: 'When the issue was resolved (Unix ms; null if open).',
      },
      {
        name: 'dueAt',
        description: 'Remediation due date as configured by SLA (Unix ms).',
      },
    ],
    responses: {
      oauth_token: oauthTokenSchema,
      issues: issuesArraySchema,
    },
  },
  [ISSUE_EVENT]: {
    shape: 'event',
    filterable: [
      {
        field: 'kind',
        ops: ['eq'],
        values: [...ISSUE_EVENT_KINDS],
      },
      {
        field: 'severity',
        ops: ['eq'],
        values: [...SEVERITIES],
      },
    ],
    description:
      'Issue lifecycle events derived from each Wiz issue: one event at createdAt (kind="opened") and, when present, one at resolvedAt (kind="resolved"). Used to build open-rate, resolution-rate, and MTTR widgets.',
    endpoint: 'GraphQL query: issues { nodes { ... } } (derived)',
    notes:
      'Events are derived from the same issues GraphQL query; enabling issue_events without issues still triggers the query but skips the entity write.',
    fields: [
      {
        name: 'kind',
        description: '"opened" or "resolved".',
      },
      {
        name: 'issueId',
        description: 'The Wiz issue id this lifecycle event belongs to.',
      },
      {
        name: 'severity',
        description: 'Severity of the originating issue at sync time.',
      },
      {
        name: 'cloudProvider',
        description: 'Cloud provider of the affected resource.',
      },
    ],
  },
  [VULNERABILITY_ENTITY]: {
    shape: 'entity',
    filterable: [
      {
        field: 'severity',
        ops: ['eq'],
        values: [...SEVERITIES],
      },
      {
        field: 'status',
        ops: ['eq'],
        values: [...VULN_STATUSES],
      },
      { field: 'cloudPlatform', ops: ['eq'] },
    ],
    description:
      'Wiz vulnerability findings keyed by finding id, with CVE id, severity, status, first / last detection timestamps, and the affected asset.',
    endpoint: 'GraphQL query: vulnerabilityFindings { nodes { ... } }',
    notes:
      'Paginated via the GraphQL connection cursor; incremental syncs filter on lastDetectedAt.after.',
    fields: [
      {
        name: 'severity',
        description: 'CRITICAL, HIGH, MEDIUM, LOW, or INFORMATIONAL.',
      },
      { name: 'status', description: 'OPEN, RESOLVED, IGNORED, IN_PROGRESS.' },
      {
        name: 'name',
        description: 'Vulnerability name as reported by Wiz.',
      },
      {
        name: 'cve',
        description: 'Vulnerability external id, typically a CVE identifier.',
      },
      {
        name: 'assetName',
        description: 'Name of the affected asset.',
      },
      {
        name: 'assetType',
        description: 'Type of the affected asset.',
      },
      {
        name: 'cloudPlatform',
        description: 'Cloud platform hosting the affected asset.',
      },
      {
        name: 'firstDetectedAt',
        description: 'When the vulnerability was first detected (Unix ms).',
      },
      {
        name: 'lastDetectedAt',
        description: 'When the vulnerability was last detected (Unix ms).',
      },
      {
        name: 'resolvedAt',
        description:
          'When the vulnerability was resolved (Unix ms; null if open).',
      },
    ],
    responses: {
      vulnerabilities: vulnerabilitiesArraySchema,
    },
  },
});

export const id = 'wiz';

type OauthTokenResponse = z.infer<typeof oauthTokenSchema>;
type WizIssue = z.infer<typeof issueSchema>;
type WizVulnerability = z.infer<typeof vulnerabilitySchema>;

const ISSUES_QUERY = `
  query Issues($first: Int!, $after: String, $filterBy: IssueFilters, $orderBy: IssueOrder) {
    issues(first: $first, after: $after, filterBy: $filterBy, orderBy: $orderBy) {
      nodes {
        id
        severity
        status
        type
        resolutionReason
        createdAt
        updatedAt
        resolvedAt
        dueAt
        sourceRule { id name }
        entitySnapshot { id name type cloudProvider externalId }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const VULNERABILITIES_QUERY = `
  query VulnerabilityFindings(
    $first: Int!
    $after: String
    $filterBy: VulnerabilityFindingFilters
  ) {
    vulnerabilityFindings(first: $first, after: $after, filterBy: $filterBy) {
      nodes {
        id
        name
        severity
        status
        vulnerabilityExternalId
        firstDetectedAt
        lastDetectedAt
        resolvedAt
        vulnerableAsset { id name type cloudPlatform }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

function parseIsoMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function normalizeSeverity(value: string): Severity | string {
  const upper = value.toUpperCase();
  return (SEVERITIES as readonly string[]).includes(upper) ? upper : value;
}

function normalizeIssueStatus(value: string): IssueStatus | string {
  const upper = value.toUpperCase();
  return (ISSUE_STATUSES as readonly string[]).includes(upper) ? upper : value;
}

function normalizeVulnStatus(value: string): VulnStatus | string {
  const upper = value.toUpperCase();
  return (VULN_STATUSES as readonly string[]).includes(upper) ? upper : value;
}

export class WizConnector extends BaseConnector<WizSettings, WizCredentials> {
  static readonly id = id;

  static readonly resources = wizResources;

  static readonly schemas = schemasFromResources(wizResources);

  static create(input: unknown, ctx?: ConnectorContext): WizConnector {
    const parsed = configFields.parse(input);
    return new WizConnector(
      {
        apiEndpoint: parsed.apiEndpoint,
        tokenEndpoint: parsed.tokenEndpoint,
        audience: parsed.audience,
        resources: parsed.resources,
      },
      {
        clientId: parsed.clientId,
        clientSecret: parsed.clientSecret,
      },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = wizCredentials;

  private accessToken: string | null = null;
  private accessTokenExpiry = 0;

  private tokenEndpoint(): string {
    return this.settings.tokenEndpoint ?? DEFAULT_TOKEN_ENDPOINT;
  }

  private audience(): string {
    return this.settings.audience ?? DEFAULT_AUDIENCE;
  }

  private resourceAllowed(resource: WizResource): boolean {
    const enabled = this.settings.resources;
    if (!enabled || enabled.length === 0) {
      return true;
    }
    return enabled.includes(resource);
  }

  private async refreshAccessToken(signal?: AbortSignal): Promise<string> {
    const form = new URLSearchParams({
      grant_type: 'client_credentials',
      audience: this.audience(),
      client_id: this.creds.clientId,
      client_secret: this.creds.clientSecret,
    });
    const res = await this.post<OauthTokenResponse>(this.tokenEndpoint(), {
      resource: 'oauth_token',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'User-Agent': connectorUserAgent('wiz'),
      },
      body: form.toString(),
      signal,
    });
    const token = res.body.access_token;
    const expiresIn = res.body.expires_in ?? 3600;
    this.accessToken = token;
    this.accessTokenExpiry =
      Date.now() + Math.max(0, expiresIn - TOKEN_EXPIRY_GRACE_S) * 1000;
    return token;
  }

  private async getAccessToken(signal?: AbortSignal): Promise<string> {
    if (!this.accessToken || Date.now() >= this.accessTokenExpiry) {
      return this.refreshAccessToken(signal);
    }
    return this.accessToken;
  }

  private async graphql<T>(
    query: string,
    variables: Record<string, unknown>,
    resource: string,
    signal?: AbortSignal,
    retried = false,
  ): Promise<HttpResponse<T>> {
    const token = await this.getAccessToken(signal);
    const res = await this.post<T>(this.settings.apiEndpoint, {
      resource,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': connectorUserAgent('wiz'),
      },
      body: JSON.stringify({ query, variables }),
      signal,
    });
    if (res.status === 401 && !retried) {
      this.accessToken = null;
      this.accessTokenExpiry = 0;
      return this.graphql<T>(query, variables, resource, signal, true);
    }
    const body = res.body as {
      data?: unknown;
      errors?: Array<{ message: string }>;
    };
    if (body.errors && body.errors.length > 0) {
      const messages = body.errors.map((e) => e.message).join('; ');
      throw new Error(`Wiz GraphQL error: ${messages}`);
    }
    if (!body.data) {
      throw new Error(
        `Wiz GraphQL response missing data for resource '${resource}'`,
      );
    }
    return res;
  }

  private issuesFilter(
    options: SyncOptions,
  ): Record<string, unknown> | undefined {
    if (!options.since) {
      return undefined;
    }
    return { updatedAt: { after: options.since } };
  }

  private vulnerabilitiesFilter(
    options: SyncOptions,
  ): Record<string, unknown> | undefined {
    if (!options.since) {
      return undefined;
    }
    return { lastDetectedAt: { after: options.since } };
  }

  private isPageAllOlderThan(
    items: WizIssue[],
    sinceMs: number | null,
  ): boolean {
    if (sinceMs === null || items.length === 0) {
      return false;
    }
    for (const i of items) {
      const ts = parseIsoMs(i.updatedAt ?? i.createdAt);
      if (ts !== null && ts >= sinceMs) {
        return false;
      }
    }
    return true;
  }

  private async fetchIssuesPage(
    page: string | null,
    options: SyncOptions,
    sinceMs: number | null,
    signal: AbortSignal | undefined,
  ): Promise<{ items: WizIssue[]; next: string | null }> {
    const res = await this.graphql<IssuesResponse>(
      ISSUES_QUERY,
      {
        first: PAGE_SIZE,
        after: page,
        filterBy: this.issuesFilter(options),
        orderBy: { field: 'UPDATED_AT', direction: 'DESC' },
      },
      'issues',
      signal,
    );
    const conn = res.body.data?.issues;
    if (!conn?.nodes || !conn.pageInfo) {
      throw new Error("Wiz GraphQL response missing 'issues' connection");
    }
    const nodes = conn.nodes;
    const next = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
    if (this.isPageAllOlderThan(nodes, sinceMs)) {
      return { items: nodes, next: null };
    }
    return { items: nodes, next };
  }

  private async fetchVulnerabilitiesPage(
    page: string | null,
    options: SyncOptions,
    signal: AbortSignal | undefined,
  ): Promise<{ items: WizVulnerability[]; next: string | null }> {
    const res = await this.graphql<VulnerabilitiesResponse>(
      VULNERABILITIES_QUERY,
      {
        first: PAGE_SIZE,
        after: page,
        filterBy: this.vulnerabilitiesFilter(options),
      },
      'vulnerabilities',
      signal,
    );
    const conn = res.body.data?.vulnerabilityFindings;
    if (!conn?.nodes || !conn.pageInfo) {
      throw new Error(
        "Wiz GraphQL response missing 'vulnerabilityFindings' connection",
      );
    }
    const nodes = conn.nodes;
    const next = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
    return { items: nodes, next };
  }

  private async writeIssues(
    storage: StorageHandle,
    items: WizIssue[],
    sinceMs: number | null,
  ): Promise<void> {
    const writeEntity = this.resourceAllowed('issues');
    const writeEvent = this.resourceAllowed('issue_events');

    for (const issue of items) {
      const severity = normalizeSeverity(issue.severity);
      const status = normalizeIssueStatus(issue.status);
      const createdMs = parseIsoMs(issue.createdAt);
      const updatedMs = parseIsoMs(issue.updatedAt ?? null) ?? createdMs;
      const resolvedMs = parseIsoMs(issue.resolvedAt ?? null);
      const dueMs = parseIsoMs(issue.dueAt ?? null);
      const snap = issue.entitySnapshot ?? null;
      const cloudProvider = snap?.cloudProvider ?? null;
      const resourceType = snap?.type ?? null;
      const resourceName = snap?.name ?? null;
      const resourceExternalId = snap?.externalId ?? null;
      const ruleId = issue.sourceRule?.id ?? null;
      const ruleName = issue.sourceRule?.name ?? null;

      if (writeEntity) {
        await storage.entity({
          type: ISSUE_ENTITY,
          id: issue.id,
          attributes: {
            severity,
            status,
            issueType: issue.type ?? null,
            resolutionReason: issue.resolutionReason ?? null,
            ruleId,
            ruleName,
            resourceId: snap?.id ?? null,
            resourceName,
            resourceType,
            resourceExternalId,
            cloudProvider,
            createdAt: createdMs,
            resolvedAt: resolvedMs,
            dueAt: dueMs,
          },
          updated_at: updatedMs ?? createdMs ?? 0,
        });
      }

      if (writeEvent) {
        if (createdMs !== null && (sinceMs === null || createdMs >= sinceMs)) {
          await storage.event({
            name: ISSUE_EVENT,
            start_ts: createdMs,
            end_ts: null,
            attributes: {
              kind: 'opened' satisfies IssueEventKind,
              issueId: issue.id,
              severity,
              status,
              cloudProvider,
              resourceType,
              ruleName,
            },
          });
        }
        if (
          resolvedMs !== null &&
          (sinceMs === null || resolvedMs >= sinceMs)
        ) {
          await storage.event({
            name: ISSUE_EVENT,
            start_ts: resolvedMs,
            end_ts: null,
            attributes: {
              kind: 'resolved' satisfies IssueEventKind,
              issueId: issue.id,
              severity,
              status,
              cloudProvider,
              resourceType,
              ruleName,
            },
          });
        }
      }
    }
  }

  private async writeVulnerabilities(
    storage: StorageHandle,
    items: WizVulnerability[],
  ): Promise<void> {
    for (const v of items) {
      const severity = normalizeSeverity(v.severity);
      const status = normalizeVulnStatus(v.status);
      const firstMs = parseIsoMs(v.firstDetectedAt ?? null);
      const lastMs = parseIsoMs(v.lastDetectedAt ?? null) ?? firstMs;
      const resolvedMs = parseIsoMs(v.resolvedAt ?? null);
      await storage.entity({
        type: VULNERABILITY_ENTITY,
        id: v.id,
        attributes: {
          name: v.name ?? null,
          severity,
          status,
          cve: v.vulnerabilityExternalId ?? null,
          assetId: v.vulnerableAsset?.id ?? null,
          assetName: v.vulnerableAsset?.name ?? null,
          assetType: v.vulnerableAsset?.type ?? null,
          cloudPlatform: v.vulnerableAsset?.cloudPlatform ?? null,
          firstDetectedAt: firstMs,
          lastDetectedAt: lastMs,
          resolvedAt: resolvedMs,
        },
        updated_at: lastMs ?? firstMs ?? 0,
      });
    }
  }

  private async clearScopeOnFirstPage(
    storage: StorageHandle,
    phase: WizPhase,
    isFull: boolean,
  ): Promise<void> {
    if (!isFull) {
      return;
    }
    switch (phase) {
      case 'issues':
        if (this.resourceAllowed('issues')) {
          await storage.entities([], { types: [ISSUE_ENTITY] });
        }
        if (this.resourceAllowed('issue_events')) {
          await storage.events([], { names: [ISSUE_EVENT] });
        }
        return;
      case 'vulnerabilities':
        await storage.entities([], { types: [VULNERABILITY_ENTITY] });
        return;
    }
  }

  private resolveCursor(cursor: unknown): WizSyncCursor | undefined {
    return isWizSyncCursor(cursor) ? cursor : undefined;
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor = this.resolveCursor(options.cursor);
    const isFull = options.mode === 'full';
    const sinceMs = options.since ? Date.parse(options.since) : null;

    const phases = selectActivePhases<WizResource, WizPhase>(
      (r) => (r === 'vulnerabilities' ? 'vulnerabilities' : 'issues'),
      PHASE_ORDER,
      this.settings.resources,
    );

    return paginateChunked<WizPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: async (phase, page, sig) => {
        switch (phase) {
          case 'issues':
            return this.fetchIssuesPage(page, options, sinceMs, sig);
          case 'vulnerabilities':
            return this.fetchVulnerabilitiesPage(page, options, sig);
        }
      },
      writeBatch: async (phase, items, page) => {
        if (page === null) {
          await this.clearScopeOnFirstPage(storage, phase, isFull);
        }
        switch (phase) {
          case 'issues':
            await this.writeIssues(storage, items as WizIssue[], sinceMs);
            return;
          case 'vulnerabilities':
            await this.writeVulnerabilities(
              storage,
              items as WizVulnerability[],
            );
            return;
        }
      },
    });
  }
}
