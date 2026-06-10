import { describe, expect, it } from 'vitest';

import {
  type BqPageRequest,
  type BqQueryResponse,
  buildBigQueryPageRequest,
  collectBigQueryPages,
} from './bigquery';

describe('buildBigQueryPageRequest', () => {
  it('POSTs to /queries for the first page', () => {
    const req = buildBigQueryPageRequest({
      projectId: 'proj',
      sql: 'SELECT 1',
      pageToken: undefined,
      jobReference: undefined,
      location: 'US',
    });
    expect(req.method).toBe('POST');
    expect(req.url).toBe(
      'https://bigquery.googleapis.com/bigquery/v2/projects/proj/queries',
    );
    expect(req.method === 'POST' && JSON.parse(req.body)).toMatchObject({
      query: 'SELECT 1',
      useLegacySql: false,
      location: 'US',
    });
  });

  it('GETs jobs.getQueryResults for subsequent pages using the jobReference', () => {
    const req = buildBigQueryPageRequest({
      projectId: 'proj',
      sql: 'SELECT 1',
      pageToken: 'next',
      jobReference: { projectId: 'job-proj', jobId: 'job-1', location: 'EU' },
    });
    expect(req.method).toBe('GET');
    expect(req.url).toContain('/projects/job-proj/queries/job-1?');
    expect(req.url).toContain('pageToken=next');
    expect(req.url).toContain('location=EU');
  });

  it('throws when a pageToken is given without a jobReference', () => {
    expect(() =>
      buildBigQueryPageRequest({
        projectId: 'proj',
        sql: 'SELECT 1',
        pageToken: 'next',
        jobReference: undefined,
      }),
    ).toThrow(/without a jobReference/);
  });
});

describe('collectBigQueryPages', () => {
  function page(
    rows: number[],
    extra?: Partial<BqQueryResponse>,
  ): BqQueryResponse {
    return {
      jobComplete: true,
      rows: rows.map((v) => ({ f: [{ v: String(v) }] })),
      ...extra,
    };
  }

  it('follows pageToken across pages and threads the jobReference', async () => {
    const requests: BqPageRequest[] = [];
    const { rows, aborted } = await collectBigQueryPages<number>({
      projectId: 'proj',
      sql: 'SELECT n',
      resource: 'test',
      jobIncompleteMessage: 'incomplete',
      fetchPage: (req) => {
        requests.push(req);
        if (req.method === 'POST') {
          return Promise.resolve(
            page([1], {
              pageToken: 'p2',
              jobReference: { projectId: 'proj', jobId: 'job-1' },
            }),
          );
        }
        return Promise.resolve(page([2]));
      },
      mapRows: (r) => (r.rows ?? []).map((row) => Number(row.f[0]!.v)),
    });
    expect(aborted).toBe(false);
    expect(rows).toEqual([1, 2]);
    expect(requests.map((r) => r.method)).toEqual(['POST', 'GET']);
    expect(requests[1]!.url).toContain('/queries/job-1?');
  });

  it('returns aborted without fetching when the signal is already aborted', async () => {
    let calls = 0;
    const { rows, aborted } = await collectBigQueryPages<number>({
      projectId: 'proj',
      sql: 'SELECT n',
      resource: 'test',
      jobIncompleteMessage: 'incomplete',
      signal: AbortSignal.abort(),
      fetchPage: () => {
        calls += 1;
        return Promise.resolve(page([1]));
      },
      mapRows: () => [1],
    });
    expect(aborted).toBe(true);
    expect(rows).toEqual([]);
    expect(calls).toBe(0);
  });

  it('throws the provided message when the job does not complete', async () => {
    await expect(
      collectBigQueryPages<number>({
        projectId: 'proj',
        sql: 'SELECT n',
        resource: 'test',
        jobIncompleteMessage: 'did not complete',
        fetchPage: () => Promise.resolve({ jobComplete: false }),
        mapRows: () => [],
      }),
    ).rejects.toThrow(/did not complete/);
  });
});
