import { z } from 'zod';

export const BQ_API_BASE = 'https://bigquery.googleapis.com/bigquery/v2';
export const BQ_READONLY_SCOPE =
  'https://www.googleapis.com/auth/bigquery.readonly';
export const BQ_PAGE_SIZE = 10_000;
export const BQ_QUERY_TIMEOUT_MS = 30_000;

export const bqQueryResponseSchema = z.object({
  jobComplete: z.boolean().optional(),
  schema: z
    .object({
      fields: z.array(z.object({ name: z.string(), type: z.string() })),
    })
    .optional(),
  rows: z
    .array(
      z.object({
        f: z.array(z.object({ v: z.string().nullable().optional() })),
      }),
    )
    .optional(),
  pageToken: z.string().optional(),
  jobReference: z
    .object({
      projectId: z.string(),
      jobId: z.string(),
      location: z.string().optional(),
    })
    .optional(),
});

export type BqQueryResponse = z.infer<typeof bqQueryResponseSchema>;
export type BqJobReference = NonNullable<BqQueryResponse['jobReference']>;

export type BqPageRequest =
  | { method: 'POST'; url: string; body: string }
  | { method: 'GET'; url: string };

export interface BqPageLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
}

export function buildBigQueryPageRequest(opts: {
  projectId: string;
  sql: string;
  pageToken: string | undefined;
  jobReference: BqJobReference | undefined;
  location?: string;
  pageSize?: number;
  timeoutMs?: number;
}): BqPageRequest {
  const pageSize = opts.pageSize ?? BQ_PAGE_SIZE;
  const timeoutMs = opts.timeoutMs ?? BQ_QUERY_TIMEOUT_MS;

  if (opts.pageToken === undefined) {
    const url = `${BQ_API_BASE}/projects/${encodeURIComponent(
      opts.projectId,
    )}/queries`;
    const body: Record<string, unknown> = {
      query: opts.sql,
      useLegacySql: false,
      maxResults: pageSize,
      timeoutMs,
    };
    if (opts.location !== undefined) {
      body['location'] = opts.location;
    }
    return { method: 'POST', url, body: JSON.stringify(body) };
  }

  if (opts.jobReference === undefined) {
    throw new Error(
      'cannot fetch the next page of BigQuery results without a jobReference',
    );
  }

  const params = new URLSearchParams({
    pageToken: opts.pageToken,
    maxResults: String(pageSize),
    timeoutMs: String(timeoutMs),
  });
  const location = opts.jobReference.location ?? opts.location;
  if (location !== undefined) {
    params.set('location', location);
  }
  const url = `${BQ_API_BASE}/projects/${encodeURIComponent(
    opts.jobReference.projectId,
  )}/queries/${encodeURIComponent(opts.jobReference.jobId)}?${params.toString()}`;
  return { method: 'GET', url };
}

export async function collectBigQueryPages<T>(opts: {
  projectId: string;
  sql: string;
  resource: string;
  fetchPage: (
    request: BqPageRequest,
    signal: AbortSignal | undefined,
  ) => Promise<BqQueryResponse>;
  mapRows: (response: BqQueryResponse) => T[];
  jobIncompleteMessage: string;
  location?: string;
  pageSize?: number;
  signal?: AbortSignal;
  logger?: BqPageLogger;
}): Promise<{ rows: T[]; aborted: boolean }> {
  const rows: T[] = [];
  let pageToken: string | undefined;
  let jobReference: BqJobReference | undefined;
  let page = 0;
  const phaseStart = Date.now();

  do {
    if (opts.signal?.aborted) {
      return { rows, aborted: true };
    }
    const request = buildBigQueryPageRequest({
      projectId: opts.projectId,
      sql: opts.sql,
      pageToken,
      jobReference,
      location: opts.location,
      pageSize: opts.pageSize,
    });
    let response: BqQueryResponse;
    try {
      response = await opts.fetchPage(request, opts.signal);
    } catch (err) {
      opts.logger?.warn('fetch page failed', {
        resource: opts.resource,
        page: page + 1,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
    if (response.jobComplete === false) {
      throw new Error(opts.jobIncompleteMessage);
    }
    if (response.jobReference !== undefined) {
      jobReference = response.jobReference;
    }
    const pageRows = opts.mapRows(response);
    rows.push(...pageRows);
    pageToken =
      typeof response.pageToken === 'string' && response.pageToken.length > 0
        ? response.pageToken
        : undefined;
    page += 1;
    opts.logger?.info('fetched page', {
      resource: opts.resource,
      page,
      items: pageRows.length,
      next: pageToken ?? null,
    });
  } while (pageToken !== undefined);

  opts.logger?.info('resource done', {
    resource: opts.resource,
    pages: page,
    items: rows.length,
    duration_ms: Date.now() - phaseStart,
  });
  return { rows, aborted: false };
}
