import {
  type InvariantViolation,
  connectorResourceShapeViolations,
  entityStoreFor,
  mockJsonResponse,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { WizConnector } from './wiz';

const CONNECTOR_ID = 'wiz';
const CLIENT_SECRET = 'WIZ_CLIENT_SECRET' as unknown as { $secret: string };

const shapeViolationsExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    WizConnector.resources,
    storage,
    connectorId,
  );

type IssuesSample = z.infer<typeof WizConnector.schemas.issues>;
type VulnsSample = z.infer<typeof WizConnector.schemas.vulnerabilities>;

interface GraphQLBody {
  query: string;
  variables?: Record<string, unknown>;
}

function emptyConn() {
  return { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };
}

function operationName(query: string): string {
  return query.match(/query\s+(\w+)/)?.[1] ?? '';
}

function installWizMock(
  responseFor: (op: string) => Record<string, unknown>,
): ReturnType<typeof vi.fn> {
  const spy = vi
    .fn()
    .mockImplementation((url: string | URL, init: RequestInit) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.includes('/oauth/token')) {
        return Promise.resolve(
          mockJsonResponse({ access_token: 'tok', expires_in: 3600 }),
        );
      }
      const parsed = JSON.parse(init.body as string) as GraphQLBody;
      const data = responseFor(operationName(parsed.query));
      return Promise.resolve(mockJsonResponse({ data }));
    });
  vi.stubGlobal('fetch', spy);
  return spy;
}

function uniqueIssueEntityInvariant(
  storage: InMemoryStorage,
  _connectorId: string,
  sample: IssuesSample,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const unique = new Set(sample.map((n) => n.id)).size;
  const written =
    entityStoreFor(storage, CONNECTOR_ID).get('wiz_issue')?.size ?? 0;
  if (written !== unique) {
    violations.push({
      invariant: 'one wiz_issue entity per unique issue id',
      location: 'issues phase',
      detail: `expected ${unique} entities, got ${written}`,
    });
  }
  return violations;
}

function uniqueVulnEntityInvariant(
  storage: InMemoryStorage,
  _connectorId: string,
  sample: VulnsSample,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const unique = new Set(sample.map((n) => n.id)).size;
  const written =
    entityStoreFor(storage, CONNECTOR_ID).get('wiz_vulnerability')?.size ?? 0;
  if (written !== unique) {
    violations.push({
      invariant: 'one wiz_vulnerability entity per unique finding id',
      location: 'vulnerabilities phase',
      detail: `expected ${unique} entities, got ${written}`,
    });
  }
  return violations;
}

function makeConnector(resources: ('issues' | 'vulnerabilities')[]) {
  return new WizConnector(
    {
      apiEndpoint: 'https://api.us1.app.wiz.io/graphql',
      resources,
    },
    { clientId: 'cid', clientSecret: CLIENT_SECRET },
  );
}

describe('WizConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('issues: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<IssuesSample>({
      connectorClass: WizConnector,
      resource: 'issues',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [uniqueIssueEntityInvariant, shapeViolationsExtra],
      run: async (sample, storage) => {
        installWizMock((op) => {
          if (op === 'Issues') {
            return {
              issues: {
                nodes: sample,
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            };
          }
          return {
            issues: emptyConn(),
            vulnerabilityFindings: emptyConn(),
          };
        });
        await makeConnector(['issues']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('vulnerabilities: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<VulnsSample>({
      connectorClass: WizConnector,
      resource: 'vulnerabilities',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [uniqueVulnEntityInvariant, shapeViolationsExtra],
      run: async (sample, storage) => {
        installWizMock((op) => {
          if (op === 'VulnerabilityFindings') {
            return {
              vulnerabilityFindings: {
                nodes: sample,
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            };
          }
          return {
            issues: emptyConn(),
            vulnerabilityFindings: emptyConn(),
          };
        });
        await makeConnector(['vulnerabilities']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });
});
