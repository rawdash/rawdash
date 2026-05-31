// This file is generated from the connector packages by scripts/generate-connectors-package.ts. Do not edit by hand.
import {
  configFields as awsCloudwatchConfigFields,
  cost as awsCloudwatchCost,
  doc as awsCloudwatchDoc,
  id as awsCloudwatchId,
  resources as awsCloudwatchResources,
} from '@rawdash/connector-aws-cloudwatch';
import {
  configFields as awsCostConfigFields,
  cost as awsCostCost,
  doc as awsCostDoc,
  id as awsCostId,
  resources as awsCostResources,
} from '@rawdash/connector-aws-cost';
import {
  configFields as datadogConfigFields,
  doc as datadogDoc,
  id as datadogId,
  resources as datadogResources,
} from '@rawdash/connector-datadog';
import {
  configFields as githubConfigFields,
  doc as githubDoc,
  id as githubId,
  resources as githubResources,
} from '@rawdash/connector-github';
import {
  configFields as googleAdsConfigFields,
  doc as googleAdsDoc,
  id as googleAdsId,
  resources as googleAdsResources,
} from '@rawdash/connector-google-ads';
import {
  configFields as googleAnalyticsConfigFields,
  doc as googleAnalyticsDoc,
  id as googleAnalyticsId,
  resources as googleAnalyticsResources,
} from '@rawdash/connector-google-analytics';
import {
  configFields as googleSearchConsoleConfigFields,
  doc as googleSearchConsoleDoc,
  id as googleSearchConsoleId,
  resources as googleSearchConsoleResources,
} from '@rawdash/connector-google-search-console';
import {
  configFields as hubspotConfigFields,
  doc as hubspotDoc,
  id as hubspotId,
  resources as hubspotResources,
} from '@rawdash/connector-hubspot';
import {
  configFields as intercomConfigFields,
  doc as intercomDoc,
  id as intercomId,
  resources as intercomResources,
} from '@rawdash/connector-intercom';
import {
  configFields as jiraConfigFields,
  doc as jiraDoc,
  id as jiraId,
  resources as jiraResources,
} from '@rawdash/connector-jira';
import {
  configFields as linearConfigFields,
  doc as linearDoc,
  id as linearId,
  resources as linearResources,
} from '@rawdash/connector-linear';
import {
  configFields as metaAdsConfigFields,
  doc as metaAdsDoc,
  id as metaAdsId,
  resources as metaAdsResources,
} from '@rawdash/connector-meta-ads';
import {
  configFields as mixpanelConfigFields,
  cost as mixpanelCost,
  doc as mixpanelDoc,
  id as mixpanelId,
  resources as mixpanelResources,
} from '@rawdash/connector-mixpanel';
import {
  configFields as posthogConfigFields,
  doc as posthogDoc,
  id as posthogId,
  resources as posthogResources,
} from '@rawdash/connector-posthog';
import {
  configFields as salesforceConfigFields,
  doc as salesforceDoc,
  id as salesforceId,
  resources as salesforceResources,
} from '@rawdash/connector-salesforce';
import {
  configFields as sentryConfigFields,
  doc as sentryDoc,
  id as sentryId,
  resources as sentryResources,
} from '@rawdash/connector-sentry';
import {
  configFields as stripeConfigFields,
  doc as stripeDoc,
  id as stripeId,
  resources as stripeResources,
} from '@rawdash/connector-stripe';
import {
  configFields as vercelConfigFields,
  doc as vercelDoc,
  id as vercelId,
  resources as vercelResources,
} from '@rawdash/connector-vercel';

import type { ConnectorMetadata } from './types';

export const connectorMetadata: ConnectorMetadata[] = [
  {
    id: awsCloudwatchId,
    packageName: '@rawdash/connector-aws-cloudwatch',
    doc: awsCloudwatchDoc,
    configFields: awsCloudwatchConfigFields,
    resources: awsCloudwatchResources,
    cost: awsCloudwatchCost,
  },
  {
    id: awsCostId,
    packageName: '@rawdash/connector-aws-cost',
    doc: awsCostDoc,
    configFields: awsCostConfigFields,
    resources: awsCostResources,
    cost: awsCostCost,
  },
  {
    id: datadogId,
    packageName: '@rawdash/connector-datadog',
    doc: datadogDoc,
    configFields: datadogConfigFields,
    resources: datadogResources,
  },
  {
    id: githubId,
    packageName: '@rawdash/connector-github',
    doc: githubDoc,
    configFields: githubConfigFields,
    resources: githubResources,
  },
  {
    id: googleAdsId,
    packageName: '@rawdash/connector-google-ads',
    doc: googleAdsDoc,
    configFields: googleAdsConfigFields,
    resources: googleAdsResources,
  },
  {
    id: googleAnalyticsId,
    packageName: '@rawdash/connector-google-analytics',
    doc: googleAnalyticsDoc,
    configFields: googleAnalyticsConfigFields,
    resources: googleAnalyticsResources,
  },
  {
    id: googleSearchConsoleId,
    packageName: '@rawdash/connector-google-search-console',
    doc: googleSearchConsoleDoc,
    configFields: googleSearchConsoleConfigFields,
    resources: googleSearchConsoleResources,
  },
  {
    id: hubspotId,
    packageName: '@rawdash/connector-hubspot',
    doc: hubspotDoc,
    configFields: hubspotConfigFields,
    resources: hubspotResources,
  },
  {
    id: intercomId,
    packageName: '@rawdash/connector-intercom',
    doc: intercomDoc,
    configFields: intercomConfigFields,
    resources: intercomResources,
  },
  {
    id: jiraId,
    packageName: '@rawdash/connector-jira',
    doc: jiraDoc,
    configFields: jiraConfigFields,
    resources: jiraResources,
  },
  {
    id: linearId,
    packageName: '@rawdash/connector-linear',
    doc: linearDoc,
    configFields: linearConfigFields,
    resources: linearResources,
  },
  {
    id: metaAdsId,
    packageName: '@rawdash/connector-meta-ads',
    doc: metaAdsDoc,
    configFields: metaAdsConfigFields,
    resources: metaAdsResources,
  },
  {
    id: mixpanelId,
    packageName: '@rawdash/connector-mixpanel',
    doc: mixpanelDoc,
    configFields: mixpanelConfigFields,
    resources: mixpanelResources,
    cost: mixpanelCost,
  },
  {
    id: posthogId,
    packageName: '@rawdash/connector-posthog',
    doc: posthogDoc,
    configFields: posthogConfigFields,
    resources: posthogResources,
  },
  {
    id: salesforceId,
    packageName: '@rawdash/connector-salesforce',
    doc: salesforceDoc,
    configFields: salesforceConfigFields,
    resources: salesforceResources,
  },
  {
    id: sentryId,
    packageName: '@rawdash/connector-sentry',
    doc: sentryDoc,
    configFields: sentryConfigFields,
    resources: sentryResources,
  },
  {
    id: stripeId,
    packageName: '@rawdash/connector-stripe',
    doc: stripeDoc,
    configFields: stripeConfigFields,
    resources: stripeResources,
  },
  {
    id: vercelId,
    packageName: '@rawdash/connector-vercel',
    doc: vercelDoc,
    configFields: vercelConfigFields,
    resources: vercelResources,
  },
];
