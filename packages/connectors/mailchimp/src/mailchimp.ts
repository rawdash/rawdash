import { connectorUserAgent, parseEpoch } from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ConnectorContext,
  type ConnectorDoc,
  type CredentialsSchema,
  type JSONValue,
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

// ---------------------------------------------------------------------------
// configFields
// ---------------------------------------------------------------------------

export const configFields = defineConfigFields(
  z.object({
    apiKey: z.object({ $secret: z.string() }).meta({
      label: 'API key',
      description:
        'Mailchimp Marketing API key. The data-center suffix after the dash (e.g. `-us1`) selects the API host. Create one at Profile -> Extras -> API keys.',
      placeholder: 'abc123...-us1',
      secret: true,
    }),
    resources: z
      .array(z.enum(['campaigns', 'lists', 'automations', 'campaign_stats']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which Mailchimp resources to sync. Omit to sync all of them.',
      }),
  }),
);

// ---------------------------------------------------------------------------
// Connector doc (catalog metadata)
// ---------------------------------------------------------------------------

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Mailchimp',
  category: 'marketing',
  brandColor: '#FFE01B',
  tagline:
    'Sync Mailchimp campaigns, audiences (lists), automations, and per-campaign engagement stats for marketing email analytics.',
  vendor: {
    name: 'Mailchimp',
    apiDocs: 'https://mailchimp.com/developer/marketing/api/',
    website: 'https://mailchimp.com',
  },
  auth: {
    summary:
      'A Mailchimp Marketing API key. The data-center suffix after the dash (e.g. `-us1`) selects the API host the connector talks to.',
    setup: [
      'In Mailchimp, open Profile -> Extras -> API keys and create a new API key.',
      'Copy the full key including the trailing data-center suffix (e.g. `abc123...-us1`); the suffix selects the API host.',
      'Store the key as a secret and reference it from config as `apiKey: secret("MAILCHIMP_API_KEY")`.',
    ],
  },
  rateLimit:
    'Mailchimp allows up to 10 simultaneous connections per account; per-endpoint rate limits are not advertised, so the connector keeps to sequential paginated requests.',
  limitations: [
    'Per-campaign report stats are rewritten on every sync because the /reports endpoint has no `since` filter.',
    'Automations are synced as entities only; per-workflow open/click counts are out of scope.',
    'Member-level data, ecommerce stores, and landing pages are out of scope.',
  ],
});

// ---------------------------------------------------------------------------
// Settings / credentials
// ---------------------------------------------------------------------------

export interface MailchimpSettings {
  resources?: readonly MailchimpResource[];
}

const mailchimpCredentials = {
  apiKey: {
    description: 'Mailchimp Marketing API key (with data-center suffix)',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type MailchimpCredentials = typeof mailchimpCredentials;

// ---------------------------------------------------------------------------
// Sync phases + cursor
// ---------------------------------------------------------------------------

const PHASE_ORDER = [
  'campaigns',
  'lists',
  'automations',
  'campaign_stats',
] as const;

type MailchimpPhase = (typeof PHASE_ORDER)[number];

export type MailchimpResource = MailchimpPhase;

const isMailchimpSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

const CAMPAIGN_ENTITY = 'mailchimp_campaign';
const LIST_ENTITY = 'mailchimp_list';
const AUTOMATION_ENTITY = 'mailchimp_automation';
const CAMPAIGN_STATS_METRIC = 'mailchimp_campaign_stats';

const PAGE_SIZE = 500;

// ---------------------------------------------------------------------------
// API response types
// ---------------------------------------------------------------------------

interface CampaignRecipients {
  list_id?: string | null;
  list_name?: string | null;
}

interface CampaignSettings {
  subject_line?: string | null;
  title?: string | null;
  from_name?: string | null;
  reply_to?: string | null;
}

interface CampaignRecord {
  id: string;
  status?: string | null;
  type?: string | null;
  create_time?: string | null;
  send_time?: string | null;
  emails_sent?: number | null;
  recipients?: CampaignRecipients | null;
  settings?: CampaignSettings | null;
}

interface CampaignsListResponse {
  campaigns: CampaignRecord[];
  total_items?: number;
}

interface ListStats {
  member_count?: number | null;
  unsubscribe_count?: number | null;
  cleaned_count?: number | null;
  open_rate?: number | null;
  click_rate?: number | null;
  campaign_count?: number | null;
}

interface ListRecord {
  id: string;
  name?: string | null;
  date_created?: string | null;
  list_rating?: number | null;
  stats?: ListStats | null;
}

interface ListsListResponse {
  lists: ListRecord[];
  total_items?: number;
}

interface AutomationRecipients {
  list_id?: string | null;
  list_name?: string | null;
}

interface AutomationSettings {
  title?: string | null;
  from_name?: string | null;
  reply_to?: string | null;
}

interface AutomationRecord {
  id: string;
  create_time?: string | null;
  start_time?: string | null;
  status?: string | null;
  emails_sent?: number | null;
  recipients?: AutomationRecipients | null;
  settings?: AutomationSettings | null;
}

interface AutomationsListResponse {
  automations: AutomationRecord[];
  total_items?: number;
}

interface ReportOpens {
  opens_total?: number | null;
  unique_opens?: number | null;
  open_rate?: number | null;
}

interface ReportClicks {
  clicks_total?: number | null;
  unique_clicks?: number | null;
  click_rate?: number | null;
}

interface ReportBounces {
  hard_bounces?: number | null;
  soft_bounces?: number | null;
  syntax_errors?: number | null;
}

interface ReportRecord {
  id: string;
  campaign_title?: string | null;
  type?: string | null;
  list_id?: string | null;
  emails_sent?: number | null;
  unsubscribed?: number | null;
  send_time?: string | null;
  opens?: ReportOpens | null;
  clicks?: ReportClicks | null;
  bounces?: ReportBounces | null;
}

interface ReportsListResponse {
  reports: ReportRecord[];
  total_items?: number;
}

// ---------------------------------------------------------------------------
// Schemas - describe the per-resource API response shape consumed by request()
// ---------------------------------------------------------------------------

const idString = z.string().min(1);

const campaignSchema = z.object({
  id: idString,
  status: z.string().nullish(),
  type: z.string().nullish(),
  create_time: z.string().nullish(),
  send_time: z.string().nullish(),
  emails_sent: z.number().nullish(),
  recipients: z
    .object({
      list_id: z.string().nullish(),
      list_name: z.string().nullish(),
    })
    .nullish(),
  settings: z
    .object({
      subject_line: z.string().nullish(),
      title: z.string().nullish(),
      from_name: z.string().nullish(),
      reply_to: z.string().nullish(),
    })
    .nullish(),
});

const listSchema = z.object({
  id: idString,
  name: z.string().nullish(),
  date_created: z.string().nullish(),
  list_rating: z.number().nullish(),
  stats: z
    .object({
      member_count: z.number().nullish(),
      unsubscribe_count: z.number().nullish(),
      cleaned_count: z.number().nullish(),
      open_rate: z.number().nullish(),
      click_rate: z.number().nullish(),
      campaign_count: z.number().nullish(),
    })
    .nullish(),
});

const automationSchema = z.object({
  id: idString,
  create_time: z.string().nullish(),
  start_time: z.string().nullish(),
  status: z.string().nullish(),
  emails_sent: z.number().nullish(),
  recipients: z
    .object({
      list_id: z.string().nullish(),
      list_name: z.string().nullish(),
    })
    .nullish(),
  settings: z
    .object({
      title: z.string().nullish(),
      from_name: z.string().nullish(),
      reply_to: z.string().nullish(),
    })
    .nullish(),
});

const reportSchema = z.object({
  id: idString,
  campaign_title: z.string().nullish(),
  type: z.string().nullish(),
  list_id: z.string().nullish(),
  emails_sent: z.number().nullish(),
  unsubscribed: z.number().nullish(),
  send_time: z.string().nullish(),
  opens: z
    .object({
      opens_total: z.number().nullish(),
      unique_opens: z.number().nullish(),
      open_rate: z.number().nullish(),
    })
    .nullish(),
  clicks: z
    .object({
      clicks_total: z.number().nullish(),
      unique_clicks: z.number().nullish(),
      click_rate: z.number().nullish(),
    })
    .nullish(),
  bounces: z
    .object({
      hard_bounces: z.number().nullish(),
      soft_bounces: z.number().nullish(),
      syntax_errors: z.number().nullish(),
    })
    .nullish(),
});

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

export const mailchimpResources = defineResources({
  [CAMPAIGN_ENTITY]: {
    shape: 'entity',
    description:
      'Campaigns (regular, plaintext, A/B, RSS, etc.) with status, type, subject line, sender, audience, send time, and total emails sent.',
    endpoint: 'GET /campaigns',
    fields: [
      {
        name: 'status',
        description: 'Campaign status (save, paused, schedule, sending, sent).',
      },
      {
        name: 'type',
        description: 'Campaign type (regular, plaintext, absplit, rss, etc.).',
      },
      { name: 'subjectLine', description: 'Email subject line.' },
      { name: 'title', description: 'Internal campaign title.' },
      { name: 'fromName', description: 'Sender display name.' },
      { name: 'replyTo', description: 'Reply-to email address.' },
      {
        name: 'listId',
        description: 'Audience (list) id the campaign targets.',
      },
      { name: 'listName', description: 'Audience (list) display name.' },
      {
        name: 'createTime',
        description: 'When the campaign was created (Unix ms).',
      },
      {
        name: 'sendTime',
        description: 'When the campaign was sent (Unix ms).',
      },
      { name: 'emailsSent', description: 'Total emails sent.' },
    ],
    responses: { campaigns: z.array(campaignSchema) },
  },
  [LIST_ENTITY]: {
    shape: 'entity',
    description:
      'Audiences (lists) with member counts, engagement rates, and lifetime campaign count.',
    endpoint: 'GET /lists',
    fields: [
      { name: 'name', description: 'Audience name.' },
      { name: 'memberCount', description: 'Number of subscribed members.' },
      {
        name: 'unsubscribeCount',
        description: 'Number of unsubscribed members.',
      },
      { name: 'cleanedCount', description: 'Number of cleaned addresses.' },
      {
        name: 'openRate',
        description: 'Lifetime open rate as a fraction (0 to 1).',
      },
      {
        name: 'clickRate',
        description: 'Lifetime click rate as a fraction (0 to 1).',
      },
      {
        name: 'campaignCount',
        description: 'Number of campaigns sent to the audience.',
      },
      { name: 'listRating', description: 'Mailchimp star rating (0 to 5).' },
      {
        name: 'createdAt',
        description: 'When the audience was created (Unix ms).',
      },
    ],
    responses: { lists: z.array(listSchema) },
  },
  [AUTOMATION_ENTITY]: {
    shape: 'entity',
    description:
      'Automations (classic email workflows) with status, title, sender, audience, and lifetime emails sent.',
    endpoint: 'GET /automations',
    fields: [
      {
        name: 'status',
        description: 'Automation status (save, paused, sending).',
      },
      { name: 'title', description: 'Automation title.' },
      { name: 'fromName', description: 'Sender display name.' },
      { name: 'replyTo', description: 'Reply-to email address.' },
      {
        name: 'listId',
        description: 'Audience (list) id the automation targets.',
      },
      { name: 'listName', description: 'Audience (list) display name.' },
      {
        name: 'emailsSent',
        description: 'Total emails sent over the workflow lifetime.',
      },
      {
        name: 'createTime',
        description: 'When the automation was created (Unix ms).',
      },
      {
        name: 'startTime',
        description: 'When the automation was started (Unix ms).',
      },
    ],
    responses: { automations: z.array(automationSchema) },
  },
  [CAMPAIGN_STATS_METRIC]: {
    shape: 'metric',
    description:
      'Per-campaign engagement stats (sent, opens, clicks, bounces, unsubscribes) timestamped at the campaign send time.',
    endpoint: 'GET /reports',
    unit: 'emails',
    notes:
      'One sample per campaign; value is the sent count, and every other counter is exposed in attributes. The scope is cleared and rewritten on every sync because the /reports endpoint has no `since` filter.',
    dimensions: [
      { name: 'campaignId', description: 'Campaign id.' },
      { name: 'campaignTitle', description: 'Campaign internal title.' },
      { name: 'campaignType', description: 'Campaign type.' },
      { name: 'listId', description: 'Audience (list) id.' },
      { name: 'opensTotal', description: 'Total opens.' },
      { name: 'uniqueOpens', description: 'Unique opens.' },
      { name: 'openRate', description: 'Open rate as a fraction (0 to 1).' },
      { name: 'clicksTotal', description: 'Total clicks.' },
      { name: 'uniqueClicks', description: 'Unique clicks.' },
      { name: 'clickRate', description: 'Click rate as a fraction (0 to 1).' },
      { name: 'hardBounces', description: 'Number of hard bounces.' },
      { name: 'softBounces', description: 'Number of soft bounces.' },
      { name: 'unsubscribed', description: 'Number of unsubscribes.' },
    ],
    responses: { campaign_stats: z.array(reportSchema) },
  },
});

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

function isoToMs(value: string | null | undefined): number | null {
  return parseEpoch(value ?? null, 'iso');
}

function isoToMsOrZero(value: string | null | undefined): number {
  return isoToMs(value) ?? 0;
}

function nullableNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function counterValue(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// Mailchimp API keys end with `-<dc>` (e.g. `xxx-us1`). The data-center prefix
// selects the API host. We extract it at sync time rather than at config time
// because the key is a secret and only resolved inside the connector.
function dataCenterFromApiKey(apiKey: string): string {
  const dash = apiKey.lastIndexOf('-');
  if (dash === -1 || dash === apiKey.length - 1) {
    throw new Error(
      'Mailchimp API key is missing the data-center suffix (e.g. `-us1`).',
    );
  }
  const dc = apiKey.slice(dash + 1);
  if (!/^[a-z]{1,4}\d{1,3}$/i.test(dc)) {
    throw new Error(
      `Mailchimp API key data-center suffix "${dc}" is not in the expected shape (e.g. "us1", "us21").`,
    );
  }
  return dc;
}

function encodeBasicAuth(username: string, password: string): string {
  const raw = `${username}:${password}`;
  if (typeof btoa === 'function') {
    return `Basic ${btoa(raw)}`;
  }
  const bufferCtor = (
    globalThis as {
      Buffer?: { from: (s: string) => { toString: (enc: string) => string } };
    }
  ).Buffer;
  if (bufferCtor) {
    return `Basic ${bufferCtor.from(raw).toString('base64')}`;
  }
  throw new Error('No base64 encoder available in this runtime');
}

// Mailchimp pages by `count` + `offset`. The cursor encodes the next offset
// as a string so paginateChunked can carry it; `null` means start at 0.
function nextOffsetCursor(currentOffset: number, pageSize: number): string {
  return String(currentOffset + pageSize);
}

function offsetFromPage(page: string | null): number {
  if (page === null) {
    return 0;
  }
  const n = Number(page);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// ---------------------------------------------------------------------------
// MailchimpConnector
// ---------------------------------------------------------------------------

export const id = 'mailchimp';

export class MailchimpConnector extends BaseConnector<
  MailchimpSettings,
  MailchimpCredentials
> {
  static readonly id = id;

  static readonly resources = mailchimpResources;

  static readonly schemas = schemasFromResources(mailchimpResources);

  static create(input: unknown, ctx?: ConnectorContext): MailchimpConnector {
    const parsed = configFields.parse(input);
    return new MailchimpConnector(
      { resources: parsed.resources },
      { apiKey: parsed.apiKey },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = mailchimpCredentials;

  private get baseUrl(): string {
    const dc = dataCenterFromApiKey(this.creds.apiKey);
    return `https://${dc}.api.mailchimp.com/3.0`;
  }

  private buildHeaders(): Record<string, string> {
    return {
      // Mailchimp accepts any username with the API key as the password.
      Authorization: encodeBasicAuth('rawdash', this.creds.apiKey),
      Accept: 'application/json',
      'User-Agent': connectorUserAgent('mailchimp'),
    };
  }

  private async fetchList<T>(
    path: string,
    resource: string,
    params: Record<string, string | number | undefined>,
    signal?: AbortSignal,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') {
        continue;
      }
      url.searchParams.set(key, String(value));
    }
    const res = await this.get<T>(url.toString(), {
      resource,
      headers: this.buildHeaders(),
      signal,
    });
    return res.body;
  }

  // -------------------------------------------------------------------------
  // campaigns - GET /campaigns
  // -------------------------------------------------------------------------

  private async fetchCampaignsPage(
    page: string | null,
    options: SyncOptions,
    signal?: AbortSignal,
  ): Promise<{ items: unknown[]; next: string | null }> {
    const offset = offsetFromPage(page);
    const body = await this.fetchList<CampaignsListResponse>(
      '/campaigns',
      'campaigns',
      {
        count: PAGE_SIZE,
        offset,
        // Ascending send time keeps the offset cursor stable across pages.
        sort_field: 'send_time',
        sort_dir: 'ASC',
        ...(options.since ? { since_send_time: options.since } : {}),
      },
      signal,
    );
    const campaigns = body.campaigns ?? [];
    const next =
      campaigns.length < PAGE_SIZE ? null : nextOffsetCursor(offset, PAGE_SIZE);
    return { items: campaigns, next };
  }

  private async writeCampaigns(
    storage: StorageHandle,
    items: CampaignRecord[],
  ): Promise<void> {
    for (const campaign of items) {
      const settings = campaign.settings ?? {};
      const recipients = campaign.recipients ?? {};
      const attributes: Record<string, JSONValue> = {
        status: campaign.status ?? null,
        type: campaign.type ?? null,
        subjectLine: settings.subject_line ?? null,
        title: settings.title ?? null,
        fromName: settings.from_name ?? null,
        replyTo: settings.reply_to ?? null,
        listId: recipients.list_id ?? null,
        listName: recipients.list_name ?? null,
        createTime: isoToMs(campaign.create_time),
        sendTime: isoToMs(campaign.send_time),
        emailsSent: nullableNumber(campaign.emails_sent),
      };
      // Sent campaigns get their updated_at from send_time; unsent ones fall
      // back to create_time so newer ticks still beat older ones on upsert.
      const updatedAt =
        isoToMs(campaign.send_time) ?? isoToMsOrZero(campaign.create_time);
      await storage.entity({
        type: CAMPAIGN_ENTITY,
        id: campaign.id,
        attributes,
        updated_at: updatedAt,
      });
    }
  }

  // -------------------------------------------------------------------------
  // lists - GET /lists
  // -------------------------------------------------------------------------

  private async fetchListsPage(
    page: string | null,
    options: SyncOptions,
    signal?: AbortSignal,
  ): Promise<{ items: unknown[]; next: string | null }> {
    const offset = offsetFromPage(page);
    const body = await this.fetchList<ListsListResponse>(
      '/lists',
      'lists',
      {
        count: PAGE_SIZE,
        offset,
        sort_field: 'date_created',
        sort_dir: 'ASC',
        ...(options.since ? { since_date_created: options.since } : {}),
      },
      signal,
    );
    const lists = body.lists ?? [];
    const next =
      lists.length < PAGE_SIZE ? null : nextOffsetCursor(offset, PAGE_SIZE);
    return { items: lists, next };
  }

  private async writeLists(
    storage: StorageHandle,
    items: ListRecord[],
  ): Promise<void> {
    for (const list of items) {
      const stats = list.stats ?? {};
      const attributes: Record<string, JSONValue> = {
        name: list.name ?? null,
        memberCount: nullableNumber(stats.member_count),
        unsubscribeCount: nullableNumber(stats.unsubscribe_count),
        cleanedCount: nullableNumber(stats.cleaned_count),
        openRate: nullableNumber(stats.open_rate),
        clickRate: nullableNumber(stats.click_rate),
        campaignCount: nullableNumber(stats.campaign_count),
        listRating: nullableNumber(list.list_rating),
        createdAt: isoToMs(list.date_created),
      };
      await storage.entity({
        type: LIST_ENTITY,
        id: list.id,
        attributes,
        // Lists have no updated_at in the API; stamp with sync time so newer
        // syncs win on conflict.
        updated_at: Date.now(),
      });
    }
  }

  // -------------------------------------------------------------------------
  // automations - GET /automations
  // -------------------------------------------------------------------------

  private async fetchAutomationsPage(
    page: string | null,
    signal?: AbortSignal,
  ): Promise<{ items: unknown[]; next: string | null }> {
    const offset = offsetFromPage(page);
    const body = await this.fetchList<AutomationsListResponse>(
      '/automations',
      'automations',
      {
        count: PAGE_SIZE,
        offset,
      },
      signal,
    );
    const automations = body.automations ?? [];
    const next =
      automations.length < PAGE_SIZE
        ? null
        : nextOffsetCursor(offset, PAGE_SIZE);
    return { items: automations, next };
  }

  private async writeAutomations(
    storage: StorageHandle,
    items: AutomationRecord[],
  ): Promise<void> {
    for (const automation of items) {
      const settings = automation.settings ?? {};
      const recipients = automation.recipients ?? {};
      const attributes: Record<string, JSONValue> = {
        status: automation.status ?? null,
        title: settings.title ?? null,
        fromName: settings.from_name ?? null,
        replyTo: settings.reply_to ?? null,
        listId: recipients.list_id ?? null,
        listName: recipients.list_name ?? null,
        emailsSent: nullableNumber(automation.emails_sent),
        createTime: isoToMs(automation.create_time),
        startTime: isoToMs(automation.start_time),
      };
      // Automations also lack an updated_at; fall back to start_time/create_time
      // when present, otherwise stamp with sync time.
      const updatedAt =
        isoToMs(automation.start_time) ??
        isoToMs(automation.create_time) ??
        Date.now();
      await storage.entity({
        type: AUTOMATION_ENTITY,
        id: automation.id,
        attributes,
        updated_at: updatedAt,
      });
    }
  }

  // -------------------------------------------------------------------------
  // campaign_stats - GET /reports (metric, one sample per campaign)
  // -------------------------------------------------------------------------

  private async fetchReportsPage(
    page: string | null,
    signal?: AbortSignal,
  ): Promise<{ items: unknown[]; next: string | null }> {
    const offset = offsetFromPage(page);
    const body = await this.fetchList<ReportsListResponse>(
      '/reports',
      'campaign_stats',
      {
        count: PAGE_SIZE,
        offset,
      },
      signal,
    );
    const reports = body.reports ?? [];
    const next =
      reports.length < PAGE_SIZE ? null : nextOffsetCursor(offset, PAGE_SIZE);
    return { items: reports, next };
  }

  private async writeCampaignStats(
    storage: StorageHandle,
    items: ReportRecord[],
  ): Promise<void> {
    for (const report of items) {
      const ts = isoToMs(report.send_time);
      if (ts === null) {
        // Reports for unsent or scheduled campaigns have no send_time; skip
        // them rather than stamp with sync time and pollute the time series.
        continue;
      }
      const opens = report.opens ?? {};
      const clicks = report.clicks ?? {};
      const bounces = report.bounces ?? {};
      const sent = counterValue(report.emails_sent);
      await storage.metric({
        name: CAMPAIGN_STATS_METRIC,
        ts,
        value: sent,
        attributes: {
          campaignId: report.id,
          campaignTitle: report.campaign_title ?? null,
          campaignType: report.type ?? null,
          listId: report.list_id ?? null,
          sent,
          opensTotal: counterValue(opens.opens_total),
          uniqueOpens: counterValue(opens.unique_opens),
          openRate: nullableNumber(opens.open_rate),
          clicksTotal: counterValue(clicks.clicks_total),
          uniqueClicks: counterValue(clicks.unique_clicks),
          clickRate: nullableNumber(clicks.click_rate),
          hardBounces: counterValue(bounces.hard_bounces),
          softBounces: counterValue(bounces.soft_bounces),
          unsubscribed: counterValue(report.unsubscribed),
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Scope clearing (idempotency)
  // -------------------------------------------------------------------------

  private async clearScopeOnFirstPage(
    storage: StorageHandle,
    phase: MailchimpPhase,
    isFull: boolean,
  ): Promise<void> {
    if (phase === 'campaign_stats') {
      // Metrics can't be upserted by key and /reports has no `since` filter,
      // so the only way to keep stats idempotent is to wipe the scope on every
      // sync and rewrite from the freshly fetched payload.
      await storage.metrics([], { names: [CAMPAIGN_STATS_METRIC] });
      return;
    }
    if (!isFull) {
      // Entity phases upsert by id, so incremental ticks just overwrite the
      // records they touch.
      return;
    }
    const entityType = ENTITY_TYPE_BY_PHASE[phase];
    if (entityType) {
      await storage.entities([], { types: [entityType] });
    }
  }

  private async writePhase(
    storage: StorageHandle,
    phase: MailchimpPhase,
    items: unknown[],
  ): Promise<void> {
    switch (phase) {
      case 'campaigns':
        await this.writeCampaigns(storage, items as CampaignRecord[]);
        return;
      case 'lists':
        await this.writeLists(storage, items as ListRecord[]);
        return;
      case 'automations':
        await this.writeAutomations(storage, items as AutomationRecord[]);
        return;
      case 'campaign_stats':
        await this.writeCampaignStats(storage, items as ReportRecord[]);
        return;
    }
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor = isMailchimpSyncCursor(options.cursor)
      ? options.cursor
      : undefined;
    const isFull = options.mode === 'full';

    const phases = selectActivePhases<MailchimpResource, MailchimpPhase>(
      (r) => r,
      PHASE_ORDER,
      this.settings.resources,
    );

    return paginateChunked<MailchimpPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: async (phase, page, sig) => {
        switch (phase) {
          case 'campaigns':
            return this.fetchCampaignsPage(page, options, sig);
          case 'lists':
            return this.fetchListsPage(page, options, sig);
          case 'automations':
            return this.fetchAutomationsPage(page, sig);
          case 'campaign_stats':
            return this.fetchReportsPage(page, sig);
        }
      },
      writeBatch: async (phase, items, page) => {
        if (page === null) {
          await this.clearScopeOnFirstPage(storage, phase, isFull);
        }
        await this.writePhase(storage, phase, items);
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers (module-scoped)
// ---------------------------------------------------------------------------

const ENTITY_TYPE_BY_PHASE: Partial<Record<MailchimpPhase, string>> = {
  campaigns: CAMPAIGN_ENTITY,
  lists: LIST_ENTITY,
  automations: AUTOMATION_ENTITY,
};
