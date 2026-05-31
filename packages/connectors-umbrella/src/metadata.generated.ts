// This file is generated from the connector packages by scripts/generate-connectors-package.ts. Do not edit by hand.
import awsCloudwatchConnector, {
  configFields as awsCloudwatchConfigFields,
  doc as awsCloudwatchDoc,
} from '@rawdash/connector-aws-cloudwatch';
import awsCostConnector, {
  configFields as awsCostConfigFields,
  doc as awsCostDoc,
} from '@rawdash/connector-aws-cost';
import datadogConnector, {
  configFields as datadogConfigFields,
  doc as datadogDoc,
} from '@rawdash/connector-datadog';
import githubConnector, {
  configFields as githubConfigFields,
  doc as githubDoc,
} from '@rawdash/connector-github';
import googleAnalyticsConnector, {
  configFields as googleAnalyticsConfigFields,
  doc as googleAnalyticsDoc,
} from '@rawdash/connector-google-analytics';
import hubspotConnector, {
  configFields as hubspotConfigFields,
  doc as hubspotDoc,
} from '@rawdash/connector-hubspot';
import intercomConnector, {
  configFields as intercomConfigFields,
  doc as intercomDoc,
} from '@rawdash/connector-intercom';
import jiraConnector, {
  configFields as jiraConfigFields,
  doc as jiraDoc,
} from '@rawdash/connector-jira';
import linearConnector, {
  configFields as linearConfigFields,
  doc as linearDoc,
} from '@rawdash/connector-linear';
import mixpanelConnector, {
  configFields as mixpanelConfigFields,
  doc as mixpanelDoc,
} from '@rawdash/connector-mixpanel';
import posthogConnector, {
  configFields as posthogConfigFields,
  doc as posthogDoc,
} from '@rawdash/connector-posthog';
import salesforceConnector, {
  configFields as salesforceConfigFields,
  doc as salesforceDoc,
} from '@rawdash/connector-salesforce';
import sentryConnector, {
  configFields as sentryConfigFields,
  doc as sentryDoc,
} from '@rawdash/connector-sentry';
import stripeConnector, {
  configFields as stripeConfigFields,
  doc as stripeDoc,
} from '@rawdash/connector-stripe';
import vercelConnector, {
  configFields as vercelConfigFields,
  doc as vercelDoc,
} from '@rawdash/connector-vercel';

import type { ConnectorMetadata } from './types';

export const connectorMetadata: ConnectorMetadata[] = [
  {
    id: awsCloudwatchConnector.id,
    packageName: '@rawdash/connector-aws-cloudwatch',
    doc: awsCloudwatchDoc,
    configFields: awsCloudwatchConfigFields,
    resources: awsCloudwatchConnector.resources,
    cost: awsCloudwatchConnector.cost,
  },
  {
    id: awsCostConnector.id,
    packageName: '@rawdash/connector-aws-cost',
    doc: awsCostDoc,
    configFields: awsCostConfigFields,
    resources: awsCostConnector.resources,
    cost: awsCostConnector.cost,
  },
  {
    id: datadogConnector.id,
    packageName: '@rawdash/connector-datadog',
    doc: datadogDoc,
    configFields: datadogConfigFields,
    resources: datadogConnector.resources,
  },
  {
    id: githubConnector.id,
    packageName: '@rawdash/connector-github',
    doc: githubDoc,
    configFields: githubConfigFields,
    resources: githubConnector.resources,
  },
  {
    id: googleAnalyticsConnector.id,
    packageName: '@rawdash/connector-google-analytics',
    doc: googleAnalyticsDoc,
    configFields: googleAnalyticsConfigFields,
    resources: googleAnalyticsConnector.resources,
  },
  {
    id: hubspotConnector.id,
    packageName: '@rawdash/connector-hubspot',
    doc: hubspotDoc,
    configFields: hubspotConfigFields,
    resources: hubspotConnector.resources,
  },
  {
    id: intercomConnector.id,
    packageName: '@rawdash/connector-intercom',
    doc: intercomDoc,
    configFields: intercomConfigFields,
    resources: intercomConnector.resources,
  },
  {
    id: jiraConnector.id,
    packageName: '@rawdash/connector-jira',
    doc: jiraDoc,
    configFields: jiraConfigFields,
    resources: jiraConnector.resources,
  },
  {
    id: linearConnector.id,
    packageName: '@rawdash/connector-linear',
    doc: linearDoc,
    configFields: linearConfigFields,
    resources: linearConnector.resources,
  },
  {
    id: mixpanelConnector.id,
    packageName: '@rawdash/connector-mixpanel',
    doc: mixpanelDoc,
    configFields: mixpanelConfigFields,
    resources: mixpanelConnector.resources,
    cost: mixpanelConnector.cost,
  },
  {
    id: posthogConnector.id,
    packageName: '@rawdash/connector-posthog',
    doc: posthogDoc,
    configFields: posthogConfigFields,
    resources: posthogConnector.resources,
  },
  {
    id: salesforceConnector.id,
    packageName: '@rawdash/connector-salesforce',
    doc: salesforceDoc,
    configFields: salesforceConfigFields,
    resources: salesforceConnector.resources,
  },
  {
    id: sentryConnector.id,
    packageName: '@rawdash/connector-sentry',
    doc: sentryDoc,
    configFields: sentryConfigFields,
    resources: sentryConnector.resources,
  },
  {
    id: stripeConnector.id,
    packageName: '@rawdash/connector-stripe',
    doc: stripeDoc,
    configFields: stripeConfigFields,
    resources: stripeConnector.resources,
  },
  {
    id: vercelConnector.id,
    packageName: '@rawdash/connector-vercel',
    doc: vercelDoc,
    configFields: vercelConfigFields,
    resources: vercelConnector.resources,
  },
];
