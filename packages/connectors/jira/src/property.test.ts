import {
  type InvariantViolation,
  entityStoreFor,
  installFetchMock,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { JiraConnector } from './jira';

const CONNECTOR_ID = 'jira';

const CREDS = {
  email: 'bot@acme.test' as unknown as { $secret: string },
  apiToken: 'jira_token' as unknown as { $secret: string },
};

type ProjectsSample = z.infer<typeof JiraConnector.schemas.projects>;
type UsersSample = z.infer<typeof JiraConnector.schemas.users>;
type SprintsSample = z.infer<typeof JiraConnector.schemas.sprints>;
type IssuesSample = z.infer<typeof JiraConnector.schemas.issues>;

function makeConnector(resources: string[]): JiraConnector {
  return new JiraConnector(
    { host: 'acme.atlassian.net', resources: resources as never },
    CREDS,
  );
}

describe('JiraConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('projects: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: ProjectsSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const unique = new Set(sample.values.map((p) => p.id)).size;
      const written =
        entityStoreFor(storage, CONNECTOR_ID).get('jira_project')?.size ?? 0;
      if (written !== unique) {
        violations.push({
          invariant: 'one jira_project entity per unique project id',
          location: 'projects phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: JiraConnector,
      resource: 'projects',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra],
      run: async (sample, storage) => {
        const terminated = { ...sample, isLast: true };
        installFetchMock(() => terminated);
        await makeConnector(['projects']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('users: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: UsersSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const unique = new Set(sample.map((u) => u.accountId)).size;
      const written =
        entityStoreFor(storage, CONNECTOR_ID).get('jira_user')?.size ?? 0;
      if (written !== unique) {
        violations.push({
          invariant: 'one jira_user entity per unique accountId',
          location: 'users phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: JiraConnector,
      resource: 'users',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra],
      run: async (sample, storage) => {
        // The /users/search payload is a plain array; <50 items terminates.
        installFetchMock(() => sample);
        await makeConnector(['users']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('sprints: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: SprintsSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const unique = new Set(sample.map((s) => String(s.id))).size;
      const written =
        entityStoreFor(storage, CONNECTOR_ID).get('jira_sprint')?.size ?? 0;
      if (written !== unique) {
        violations.push({
          invariant: 'one jira_sprint entity per unique sprint id',
          location: 'sprints phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: JiraConnector,
      resource: 'sprints',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra],
      run: async (sample, storage) => {
        installFetchMock((url) => {
          if (url.includes('/sprint')) {
            return {
              values: sample,
              isLast: true,
              startAt: 0,
              maxResults: 50,
            };
          }
          return {
            values: [{ id: 1, name: 'Board', type: 'scrum' }],
            isLast: true,
            startAt: 0,
            maxResults: 50,
            total: 1,
          };
        });
        await makeConnector(['sprints']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('issues: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: IssuesSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const unique = new Set(sample.issues.map((i) => i.id)).size;
      const written =
        entityStoreFor(storage, CONNECTOR_ID).get('jira_issue')?.size ?? 0;
      if (written !== unique) {
        violations.push({
          invariant: 'one jira_issue entity per unique issue id',
          location: 'issues phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: JiraConnector,
      resource: 'issues',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra],
      run: async (sample, storage) => {
        const terminated = { ...sample, isLast: true, nextPageToken: null };
        installFetchMock(() => terminated);
        await makeConnector(['issues', 'issue_events']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });
});
