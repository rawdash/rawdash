import {
  type InvariantViolation,
  assertConnectorResourceShapes,
  connectorResourceShapeViolations,
  entityStoreFor,
  installFetchMock,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { MailchimpConnector } from './mailchimp';

const CONNECTOR_ID = 'mailchimp';
const API_KEY = 'mailchimp-test-key-us1' as unknown as { $secret: string };

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    MailchimpConnector.resources,
    storage,
    connectorId,
  );

type CampaignsSample = z.infer<typeof MailchimpConnector.schemas.campaigns>;
type ListsSample = z.infer<typeof MailchimpConnector.schemas.lists>;
type AutomationsSample = z.infer<typeof MailchimpConnector.schemas.automations>;

function uniqueEntityInvariant(
  entityType: string,
  phase: string,
): (
  storage: InMemoryStorage,
  connectorId: string,
  sample: unknown[],
) => InvariantViolation[] {
  return (storage, _connectorId, sample) => {
    const violations: InvariantViolation[] = [];
    const records = sample as Array<{ id: string }>;
    const unique = new Set(records.map((r) => r.id)).size;
    const written =
      entityStoreFor(storage, CONNECTOR_ID).get(entityType)?.size ?? 0;
    if (written !== unique) {
      violations.push({
        invariant: `one ${entityType} entity per unique id`,
        location: `${phase} phase`,
        detail: `expected ${unique} entities, got ${written}`,
      });
    }
    return violations;
  };
}

describe('MailchimpConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('campaigns: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<CampaignsSample>({
      connectorClass: MailchimpConnector,
      resource: 'campaigns',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [
        uniqueEntityInvariant('mailchimp_campaign', 'campaigns'),
        docShapeExtra,
      ],
      run: async (sample, storage) => {
        installFetchMock(() => ({ campaigns: sample }));
        const c = new MailchimpConnector(
          { resources: ['campaigns'] },
          { apiKey: API_KEY },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('lists: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<ListsSample>({
      connectorClass: MailchimpConnector,
      resource: 'lists',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [
        uniqueEntityInvariant('mailchimp_list', 'lists'),
        docShapeExtra,
      ],
      run: async (sample, storage) => {
        installFetchMock(() => ({ lists: sample }));
        const c = new MailchimpConnector(
          { resources: ['lists'] },
          { apiKey: API_KEY },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('automations: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<AutomationsSample>({
      connectorClass: MailchimpConnector,
      resource: 'automations',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [
        uniqueEntityInvariant('mailchimp_automation', 'automations'),
        docShapeExtra,
      ],
      run: async (sample, storage) => {
        installFetchMock(() => ({ automations: sample }));
        const c = new MailchimpConnector(
          { resources: ['automations'] },
          { apiKey: API_KEY },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('full sync across all resources matches the documented resource shapes', async () => {
    installFetchMock((url) => {
      if (url.includes('/campaigns')) {
        return {
          campaigns: [
            {
              id: 'c_1',
              status: 'sent',
              type: 'regular',
              create_time: '2024-01-01T00:00:00.000Z',
              send_time: '2024-02-01T00:00:00.000Z',
              emails_sent: 1000,
              recipients: { list_id: 'l_1', list_name: 'Newsletter' },
              settings: {
                subject_line: 'Welcome',
                title: 'Welcome blast',
                from_name: 'Marketing',
                reply_to: 'reply@example.com',
              },
            },
          ],
        };
      }
      if (url.includes('/lists')) {
        return {
          lists: [
            {
              id: 'l_1',
              name: 'Newsletter',
              date_created: '2023-05-01T00:00:00.000Z',
              list_rating: 4,
              stats: {
                member_count: 1200,
                unsubscribe_count: 30,
                cleaned_count: 5,
                open_rate: 0.45,
                click_rate: 0.12,
                campaign_count: 24,
              },
            },
          ],
        };
      }
      if (url.includes('/automations')) {
        return {
          automations: [
            {
              id: 'a_1',
              create_time: '2024-01-01T00:00:00.000Z',
              start_time: '2024-01-02T00:00:00.000Z',
              status: 'sending',
              emails_sent: 5,
              recipients: { list_id: 'l_1', list_name: 'Newsletter' },
              settings: {
                title: 'Welcome series',
                from_name: 'Onboarding',
                reply_to: 'hello@example.com',
              },
            },
          ],
        };
      }
      if (url.includes('/reports')) {
        return {
          reports: [
            {
              id: 'c_1',
              campaign_title: 'Welcome blast',
              type: 'regular',
              list_id: 'l_1',
              emails_sent: 1000,
              unsubscribed: 4,
              send_time: '2024-02-01T00:00:00.000Z',
              opens: { opens_total: 600, unique_opens: 450, open_rate: 0.45 },
              clicks: {
                clicks_total: 120,
                unique_clicks: 100,
                click_rate: 0.1,
              },
              bounces: { hard_bounces: 3, soft_bounces: 7, syntax_errors: 0 },
            },
          ],
        };
      }
      return {};
    });

    const storage = new InMemoryStorage();
    const c = new MailchimpConnector(
      {
        resources: ['campaigns', 'lists', 'automations', 'campaign_stats'],
      },
      { apiKey: API_KEY },
    );
    await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));

    assertConnectorResourceShapes(
      MailchimpConnector.resources,
      storage,
      CONNECTOR_ID,
    );
  });
});
