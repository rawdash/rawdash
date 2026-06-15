import {
  type TokenCacheEntry,
  fetchEntraAccessToken,
  isTokenFresh,
} from '@rawdash/connector-azure-shared';
import {
  type HttpResponse,
  connectorUserAgent,
  parseEpoch,
  sanitizeAllowedUrl,
  standardRateLimitPolicy,
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

const GRAPH_HOST = 'graph.microsoft.com';
const API_VERSION = 'v1.0';

// Entra tenant identifier: GUID, or a verified domain like contoso.onmicrosoft.com,
// or one of the well-known values (common, organizations, consumers). Reject
// anything containing a slash or whitespace so the token URL stays anchored.
const TENANT_ID_PATTERN = /^[a-zA-Z0-9.-]{1,256}$/;

export const configFields = defineConfigFields(
  z.object({
    tenantId: z
      .string()
      .trim()
      .min(1)
      .regex(
        TENANT_ID_PATTERN,
        'Use the tenant GUID, a verified domain (e.g. "contoso.onmicrosoft.com"), or one of the well-known values "common" / "organizations" / "consumers".',
      )
      .meta({
        label: 'Tenant ID',
        description:
          'Microsoft Entra tenant identifier. Either the directory (tenant) GUID from the Azure portal, or a verified domain such as "contoso.onmicrosoft.com".',
        placeholder: '00000000-0000-0000-0000-000000000000',
      }),
    clientId: z.string().min(1).meta({
      label: 'Application (client) ID',
      description:
        'Application (client) ID of the Entra app registration used to call Microsoft Graph.',
      placeholder: '00000000-0000-0000-0000-000000000000',
    }),
    clientSecret: z.object({ $secret: z.string().min(1) }).meta({
      label: 'Client secret',
      description:
        'Client secret value (not the secret ID) from the app registration. Stored as a secret.',
      placeholder: 'ENTRA_CLIENT_SECRET',
      secret: true,
    }),
    resources: z
      .array(z.enum(['users', 'signins', 'risky_users']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which Entra ID resources to sync. Omit to sync all of them. The app registration only needs the Microsoft Graph application permissions for the resources listed here (User.Read.All, AuditLog.Read.All, IdentityRiskyUser.Read.All).',
      }),
    signinsLookbackDays: z.number().int().positive().max(30).optional().meta({
      label: 'Sign-ins lookback (days)',
      description:
        'How many days of sign-in events to backfill on a full sync. Defaults to 7. Microsoft Graph retains sign-in logs for 30 days on the Premium tiers required to call the API.',
      placeholder: '7',
    }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Microsoft Entra ID',
  category: 'security',
  brandColor: '#0078D4',
  tagline:
    'Sync users, sign-in events, and risky users from a Microsoft Entra ID (formerly Azure AD) tenant for sign-in volume, failed-sign-in rate, and identity-risk dashboards.',
  vendor: {
    name: 'Microsoft Entra ID',
    domain: 'microsoft.com',
    apiDocs: 'https://learn.microsoft.com/en-us/graph/api/resources/signin',
    website:
      'https://www.microsoft.com/en-us/security/business/identity-access/microsoft-entra-id',
  },
  auth: {
    summary:
      'OAuth 2.0 client-credentials flow against the Microsoft identity platform, using an Entra app registration with Microsoft Graph application permissions.',
    setup: [
      'In the Azure portal, open Microsoft Entra ID -> App registrations and create a new registration (single tenant).',
      'Under API permissions, add Microsoft Graph Application permissions for the resources you want to sync: User.Read.All (users), AuditLog.Read.All (signins), IdentityRiskyUser.Read.All (risky_users). Grant admin consent.',
      'Under Certificates & secrets, add a new client secret and copy the Value (not the Secret ID) immediately - Azure only shows it once.',
      'Copy the Directory (tenant) ID and Application (client) ID from the registration overview.',
      'Store the client secret as a rawdash secret and reference it from the connector config as `clientSecret: secret("ENTRA_CLIENT_SECRET")`.',
    ],
  },
  rateLimit:
    'Microsoft Graph applies per-app and per-tenant throttling. The shared HTTP client backs off on 429 using Retry-After and the standard rate-limit policy.',
  limitations: [
    'The sign-in logs and risky-users endpoints require Entra ID P1 or P2; tenants on the free tier cannot call them and the connector will surface a 4xx from Microsoft Graph.',
    'Sign-in logs are retained by Microsoft for 30 days; backfills beyond that window return no data.',
    'Conditional Access, application assignments, and audit logs (admin activity) are out of scope.',
  ],
});

export type EntraIdResource = 'users' | 'signins' | 'risky_users';

export interface EntraIdSettings {
  tenantId: string;
  resources?: readonly EntraIdResource[];
  signinsLookbackDays?: number;
}

const entraIdCredentials = {
  clientId: {
    description: 'Entra app registration application (client) ID',
    auth: 'required' as const,
  },
  clientSecret: {
    description: 'Entra app registration client secret value',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type EntraIdCredentials = typeof entraIdCredentials;

const entraIdRateLimit = standardRateLimitPolicy({
  remainingHeader: 'ratelimit-remaining',
  resetHeader: 'ratelimit-reset',
  resetUnit: 's',
});

const PHASE_ORDER = ['users', 'signins', 'risky_users'] as const;

type EntraIdPhase = (typeof PHASE_ORDER)[number];

type EntraIdSyncCursor = ChunkedSyncCursor<EntraIdPhase, string>;

const isEntraIdSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

const USER_ENTITY = 'entra_user';
const SIGNIN_EVENT = 'entra_signin_event';
const RISKY_USER_ENTITY = 'entra_risky_user';

const USERS_PAGE_SIZE = 500;
const SIGNINS_PAGE_SIZE = 1000;
const RISKY_USERS_PAGE_SIZE = 500;
const DEFAULT_SIGNINS_LOOKBACK_DAYS = 7;

const oauthTokenSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
});

const userSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().nullish(),
  userPrincipalName: z.string().nullish(),
  mail: z.string().nullish(),
  accountEnabled: z.boolean().nullish(),
  userType: z.string().nullish(),
  createdDateTime: z.string().nullish(),
});

const usersResponseSchema = z.object({
  '@odata.nextLink': z.string().nullish(),
  value: z.array(userSchema),
});

const signinStatusSchema = z.object({
  errorCode: z.number().nullish(),
  failureReason: z.string().nullish(),
  additionalDetails: z.string().nullish(),
});

const signinLocationSchema = z.object({
  city: z.string().nullish(),
  state: z.string().nullish(),
  countryOrRegion: z.string().nullish(),
});

const signinSchema = z.object({
  id: z.string().min(1),
  createdDateTime: z.string(),
  userId: z.string().nullish(),
  userPrincipalName: z.string().nullish(),
  userDisplayName: z.string().nullish(),
  appId: z.string().nullish(),
  appDisplayName: z.string().nullish(),
  ipAddress: z.string().nullish(),
  clientAppUsed: z.string().nullish(),
  conditionalAccessStatus: z.string().nullish(),
  riskLevelAggregated: z.string().nullish(),
  riskLevelDuringSignIn: z.string().nullish(),
  riskState: z.string().nullish(),
  riskDetail: z.string().nullish(),
  status: signinStatusSchema.nullish(),
  location: signinLocationSchema.nullish(),
});

const signinsResponseSchema = z.object({
  '@odata.nextLink': z.string().nullish(),
  value: z.array(signinSchema),
});

const riskyUserSchema = z.object({
  id: z.string().min(1),
  userPrincipalName: z.string().nullish(),
  userDisplayName: z.string().nullish(),
  riskLevel: z.string().nullish(),
  riskState: z.string().nullish(),
  riskDetail: z.string().nullish(),
  riskLastUpdatedDateTime: z.string().nullish(),
  isProcessing: z.boolean().nullish(),
  isDeleted: z.boolean().nullish(),
});

const riskyUsersResponseSchema = z.object({
  '@odata.nextLink': z.string().nullish(),
  value: z.array(riskyUserSchema),
});

export const entraIdResources = defineResources({
  [USER_ENTITY]: {
    shape: 'entity',
    filterable: [
      { field: 'accountEnabled', ops: ['eq'], values: ['true', 'false'] },
      {
        field: 'userType',
        ops: ['eq'],
        values: ['Member', 'Guest'],
      },
    ],
    description:
      'Entra ID users with display name, principal name, mail, account-enabled flag, and user type.',
    endpoint: 'GET /v1.0/users',
    notes:
      'Fully enumerated on every sync; @odata.nextLink pages are followed within the chunked sync loop.',
    fields: [
      { name: 'displayName', description: 'Display name from the directory.' },
      {
        name: 'userPrincipalName',
        description: 'User principal name (e.g. alice@contoso.com).',
      },
      { name: 'mail', description: 'Primary SMTP address (may be null).' },
      {
        name: 'accountEnabled',
        description:
          'Whether the account is enabled (sign-in allowed when true).',
      },
      {
        name: 'userType',
        description: 'Either "Member" (in-tenant) or "Guest" (B2B invitee).',
      },
      {
        name: 'createdAt',
        description: 'When the user was created (Unix ms).',
      },
    ],
    responses: {
      oauth_token: oauthTokenSchema,
      users: usersResponseSchema,
    },
  },
  [SIGNIN_EVENT]: {
    shape: 'event',
    filterable: [
      { field: 'status', ops: ['eq'], values: ['success', 'failure'] },
      {
        field: 'riskLevel',
        ops: ['eq'],
        values: [
          'none',
          'low',
          'medium',
          'high',
          'hidden',
          'unknownFutureValue',
        ],
      },
      { field: 'appDisplayName', ops: ['eq'] },
    ],
    description:
      'Sign-in events from the Entra ID audit logs (`/auditLogs/signIns`). One event per interactive sign-in attempt with user, app, IP, location, and risk fields.',
    endpoint: 'GET /v1.0/auditLogs/signIns',
    notes:
      'Backfill window defaults to 7 days and is capped at the Microsoft Graph 30-day retention. Incremental syncs filter on `createdDateTime`.',
    fields: [
      {
        name: 'status',
        description:
          'Aggregated status: "success" when the sign-in completed without error, otherwise "failure".',
      },
      {
        name: 'errorCode',
        description: 'Microsoft Graph signInStatus.errorCode (0 on success).',
      },
      {
        name: 'failureReason',
        description: 'Human-readable failure reason (null on success).',
      },
      { name: 'userId', description: 'Directory object id of the actor.' },
      {
        name: 'userPrincipalName',
        description: 'User principal name at sign-in time.',
      },
      { name: 'appId', description: 'Application (client) id signed into.' },
      {
        name: 'appDisplayName',
        description: 'Display name of the application signed into.',
      },
      { name: 'ipAddress', description: 'Client IP recorded by Entra.' },
      {
        name: 'countryOrRegion',
        description: 'Geographic country/region from location.countryOrRegion.',
      },
      {
        name: 'city',
        description: 'City from location.city (may be null).',
      },
      {
        name: 'riskLevel',
        description:
          'Aggregated risk level (none / low / medium / high / hidden / unknownFutureValue).',
      },
      {
        name: 'riskState',
        description:
          'Risk state (none / confirmedSafe / remediated / dismissed / atRisk / confirmedCompromised).',
      },
      {
        name: 'clientAppUsed',
        description:
          'Client app type (Browser, Mobile Apps and Desktop clients, etc.).',
      },
      {
        name: 'conditionalAccessStatus',
        description:
          'Outcome of conditional-access policy evaluation (success / failure / notApplied / unknownFutureValue).',
      },
    ],
    responses: { signins: signinsResponseSchema },
  },
  [RISKY_USER_ENTITY]: {
    shape: 'entity',
    filterable: [
      {
        field: 'riskLevel',
        ops: ['eq'],
        values: ['low', 'medium', 'high', 'hidden', 'unknownFutureValue'],
      },
      {
        field: 'riskState',
        ops: ['eq'],
        values: [
          'none',
          'confirmedSafe',
          'remediated',
          'dismissed',
          'atRisk',
          'confirmedCompromised',
          'unknownFutureValue',
        ],
      },
    ],
    description:
      'Users currently flagged by Entra Identity Protection, with their risk level, risk state, and last-updated timestamp.',
    endpoint: 'GET /v1.0/identityProtection/riskyUsers',
    notes:
      'Fully enumerated on every sync; @odata.nextLink pages are followed within the chunked sync loop.',
    fields: [
      {
        name: 'userPrincipalName',
        description: 'User principal name of the risky user.',
      },
      { name: 'displayName', description: 'Display name of the risky user.' },
      {
        name: 'riskLevel',
        description:
          'Identity Protection risk level (low / medium / high / hidden / unknownFutureValue).',
      },
      {
        name: 'riskState',
        description:
          'Risk state (none / confirmedSafe / remediated / dismissed / atRisk / confirmedCompromised / unknownFutureValue).',
      },
      {
        name: 'riskDetail',
        description:
          'Latest risk detail string (the specific reason for the flag).',
      },
      {
        name: 'riskLastUpdatedAt',
        description: 'When the risk was last refreshed (Unix ms).',
      },
    ],
    responses: { risky_users: riskyUsersResponseSchema },
  },
});

export const id = 'entra-id';

type UsersResponse = z.infer<typeof usersResponseSchema>;
type SigninsResponse = z.infer<typeof signinsResponseSchema>;
type RiskyUsersResponse = z.infer<typeof riskyUsersResponseSchema>;
type EntraUser = z.infer<typeof userSchema>;
type EntraSignin = z.infer<typeof signinSchema>;
type EntraRiskyUser = z.infer<typeof riskyUserSchema>;

function signinStatus(
  errorCode: number | null | undefined,
): 'success' | 'failure' {
  return errorCode === 0 ? 'success' : 'failure';
}

function pageRequestPath(phase: EntraIdPhase): string {
  switch (phase) {
    case 'users':
      return `/${API_VERSION}/users`;
    case 'signins':
      return `/${API_VERSION}/auditLogs/signIns`;
    case 'risky_users':
      return `/${API_VERSION}/identityProtection/riskyUsers`;
  }
}

function sanitizeGraphUrl(
  url: string | null,
  phase: EntraIdPhase,
): string | null {
  return sanitizeAllowedUrl({
    url,
    host: GRAPH_HOST,
    pathname: pageRequestPath(phase),
  });
}

export class EntraIdConnector extends BaseConnector<
  EntraIdSettings,
  EntraIdCredentials
> {
  static readonly id = id;

  static readonly resources = entraIdResources;

  static readonly schemas = schemasFromResources(entraIdResources);

  static create(input: unknown, ctx?: ConnectorContext): EntraIdConnector {
    const parsed = configFields.parse(input);
    return new EntraIdConnector(
      {
        tenantId: parsed.tenantId,
        resources: parsed.resources,
        signinsLookbackDays: parsed.signinsLookbackDays,
      },
      {
        clientId: parsed.clientId,
        clientSecret: parsed.clientSecret,
      },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = entraIdCredentials;

  private tokenCache: TokenCacheEntry | null = null;

  private async getAccessToken(signal?: AbortSignal): Promise<string> {
    if (isTokenFresh(this.tokenCache)) {
      return this.tokenCache!.token;
    }
    this.tokenCache = await fetchEntraAccessToken(
      {
        tenantId: this.settings.tenantId,
        clientId: this.creds.clientId,
        clientSecret: this.creds.clientSecret,
        scope: `https://${GRAPH_HOST}/.default`,
        connectorId: 'entra-id',
      },
      signal,
    );
    return this.tokenCache.token;
  }

  private async apiGet<T>(
    url: string,
    resource: string,
    signal?: AbortSignal,
    retried = false,
  ): Promise<HttpResponse<T>> {
    const token = await this.getAccessToken(signal);
    const res = await this.get<T>(url, {
      resource,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'User-Agent': connectorUserAgent('entra-id'),
      },
      rateLimit: entraIdRateLimit,
      signal,
    });
    if (res.status === 401 && !retried) {
      this.tokenCache = null;
      return this.apiGet<T>(url, resource, signal, true);
    }
    return res;
  }

  private signinsSince(options: SyncOptions): string {
    if (options.since) {
      return options.since;
    }
    const lookback =
      this.settings.signinsLookbackDays ?? DEFAULT_SIGNINS_LOOKBACK_DAYS;
    const since = new Date(Date.now() - lookback * 24 * 60 * 60 * 1000);
    return since.toISOString();
  }

  private buildInitialUrl(phase: EntraIdPhase, options: SyncOptions): string {
    const u = new URL(`https://${GRAPH_HOST}${pageRequestPath(phase)}`);
    switch (phase) {
      case 'users':
        u.searchParams.set(
          '$select',
          'id,displayName,userPrincipalName,mail,accountEnabled,userType,createdDateTime',
        );
        u.searchParams.set('$top', String(USERS_PAGE_SIZE));
        return u.toString();
      case 'signins': {
        const since = this.signinsSince(options);
        u.searchParams.set('$filter', `createdDateTime ge ${since}`);
        u.searchParams.set('$orderby', 'createdDateTime asc');
        u.searchParams.set('$top', String(SIGNINS_PAGE_SIZE));
        return u.toString();
      }
      case 'risky_users':
        u.searchParams.set('$top', String(RISKY_USERS_PAGE_SIZE));
        return u.toString();
    }
  }

  private async fetchPhasePage(
    phase: EntraIdPhase,
    page: string | null,
    options: SyncOptions,
    signal: AbortSignal | undefined,
  ): Promise<{ items: unknown[]; next: string | null }> {
    const url = page ?? this.buildInitialUrl(phase, options);
    switch (phase) {
      case 'users': {
        const res = await this.apiGet<UsersResponse>(url, 'users', signal);
        const next = sanitizeGraphUrl(
          res.body['@odata.nextLink'] ?? null,
          phase,
        );
        return { items: res.body.value, next };
      }
      case 'signins': {
        const res = await this.apiGet<SigninsResponse>(url, 'signins', signal);
        const next = sanitizeGraphUrl(
          res.body['@odata.nextLink'] ?? null,
          phase,
        );
        return { items: res.body.value, next };
      }
      case 'risky_users': {
        const res = await this.apiGet<RiskyUsersResponse>(
          url,
          'risky_users',
          signal,
        );
        const next = sanitizeGraphUrl(
          res.body['@odata.nextLink'] ?? null,
          phase,
        );
        return { items: res.body.value, next };
      }
    }
  }

  private async writeUsers(
    storage: StorageHandle,
    items: EntraUser[],
  ): Promise<void> {
    for (const u of items) {
      const createdMs = parseEpoch(u.createdDateTime ?? null, 'iso');
      await storage.entity({
        type: USER_ENTITY,
        id: u.id,
        attributes: {
          displayName: u.displayName ?? null,
          userPrincipalName: u.userPrincipalName ?? null,
          mail: u.mail ?? null,
          accountEnabled: u.accountEnabled ?? null,
          userType: u.userType ?? null,
          createdAt: createdMs,
        },
        updated_at: createdMs ?? 0,
      });
    }
  }

  private async writeSignins(
    storage: StorageHandle,
    items: EntraSignin[],
    sinceMs: number | null,
  ): Promise<void> {
    for (const s of items) {
      const ts = parseEpoch(s.createdDateTime, 'iso');
      if (ts === null) {
        continue;
      }
      if (sinceMs !== null && ts <= sinceMs) {
        continue;
      }
      const errorCode = s.status?.errorCode ?? null;
      await storage.event({
        name: SIGNIN_EVENT,
        start_ts: ts,
        end_ts: null,
        attributes: {
          signinId: s.id,
          status: signinStatus(errorCode),
          errorCode,
          failureReason: s.status?.failureReason ?? null,
          userId: s.userId ?? null,
          userPrincipalName: s.userPrincipalName ?? null,
          userDisplayName: s.userDisplayName ?? null,
          appId: s.appId ?? null,
          appDisplayName: s.appDisplayName ?? null,
          ipAddress: s.ipAddress ?? null,
          clientAppUsed: s.clientAppUsed ?? null,
          city: s.location?.city ?? null,
          state: s.location?.state ?? null,
          countryOrRegion: s.location?.countryOrRegion ?? null,
          riskLevel: s.riskLevelAggregated ?? null,
          riskLevelDuringSignIn: s.riskLevelDuringSignIn ?? null,
          riskState: s.riskState ?? null,
          riskDetail: s.riskDetail ?? null,
          conditionalAccessStatus: s.conditionalAccessStatus ?? null,
        },
      });
    }
  }

  private async writeRiskyUsers(
    storage: StorageHandle,
    items: EntraRiskyUser[],
  ): Promise<void> {
    for (const r of items) {
      const updatedMs = parseEpoch(r.riskLastUpdatedDateTime ?? null, 'iso');
      await storage.entity({
        type: RISKY_USER_ENTITY,
        id: r.id,
        attributes: {
          userPrincipalName: r.userPrincipalName ?? null,
          displayName: r.userDisplayName ?? null,
          riskLevel: r.riskLevel ?? null,
          riskState: r.riskState ?? null,
          riskDetail: r.riskDetail ?? null,
          riskLastUpdatedAt: updatedMs,
          isProcessing: r.isProcessing ?? null,
          isDeleted: r.isDeleted ?? null,
        },
        updated_at: updatedMs ?? 0,
      });
    }
  }

  private async writePhase(
    storage: StorageHandle,
    phase: EntraIdPhase,
    items: unknown[],
    sinceMs: number | null,
  ): Promise<void> {
    switch (phase) {
      case 'users':
        return this.writeUsers(storage, items as EntraUser[]);
      case 'signins':
        return this.writeSignins(storage, items as EntraSignin[], sinceMs);
      case 'risky_users':
        return this.writeRiskyUsers(storage, items as EntraRiskyUser[]);
    }
  }

  private async clearScopeOnFirstPage(
    storage: StorageHandle,
    phase: EntraIdPhase,
    isFull: boolean,
  ): Promise<void> {
    if (!isFull) {
      return;
    }
    switch (phase) {
      case 'users':
        await storage.entities([], { types: [USER_ENTITY] });
        return;
      case 'signins':
        await storage.events([], { names: [SIGNIN_EVENT] });
        return;
      case 'risky_users':
        await storage.entities([], { types: [RISKY_USER_ENTITY] });
        return;
    }
  }

  private resolveCursor(cursor: unknown): EntraIdSyncCursor | undefined {
    if (!isEntraIdSyncCursor(cursor)) {
      return undefined;
    }
    return {
      phase: cursor.phase,
      page: sanitizeGraphUrl(cursor.page, cursor.phase),
    };
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor = this.resolveCursor(options.cursor);
    const isFull = options.mode === 'full';
    const sinceMsRaw = options.since ? Date.parse(options.since) : null;
    const sinceMs =
      sinceMsRaw !== null && Number.isFinite(sinceMsRaw) ? sinceMsRaw : null;

    const phases = selectActivePhases<EntraIdResource, EntraIdPhase>(
      (r) => r,
      PHASE_ORDER,
      this.settings.resources,
    );

    return paginateChunked<EntraIdPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: async (phase, page, sig) =>
        this.fetchPhasePage(phase, page, options, sig),
      writeBatch: async (phase, items, page) => {
        if (page === null) {
          await this.clearScopeOnFirstPage(storage, phase, isFull);
        }
        await this.writePhase(storage, phase, items, sinceMs);
      },
    });
  }
}
