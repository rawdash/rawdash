// This file is generated from the connector packages by scripts/generate-connectors-package.ts. Do not edit by hand.
import type { ConnectorClass } from '@rawdash/core';

export const connectorLoaders: Record<string, () => Promise<ConnectorClass>> = {
  anthropic: () =>
    import('@rawdash/connector-anthropic').then((m) => m.default),
  'app-store-connect': () =>
    import('@rawdash/connector-app-store-connect').then((m) => m.default),
  appsflyer: () =>
    import('@rawdash/connector-appsflyer').then((m) => m.default),
  asana: () => import('@rawdash/connector-asana').then((m) => m.default),
  auth0: () => import('@rawdash/connector-auth0').then((m) => m.default),
  'aws-bedrock': () =>
    import('@rawdash/connector-aws-bedrock').then((m) => m.default),
  'aws-cloudwatch': () =>
    import('@rawdash/connector-aws-cloudwatch').then((m) => m.default),
  'aws-cost': () =>
    import('@rawdash/connector-aws-cost').then((m) => m.default),
  'azure-cost': () =>
    import('@rawdash/connector-azure-cost').then((m) => m.default),
  'azure-monitor': () =>
    import('@rawdash/connector-azure-monitor').then((m) => m.default),
  bitbucket: () =>
    import('@rawdash/connector-bitbucket').then((m) => m.default),
  branch: () => import('@rawdash/connector-branch').then((m) => m.default),
  circleci: () => import('@rawdash/connector-circleci').then((m) => m.default),
  clerk: () => import('@rawdash/connector-clerk').then((m) => m.default),
  clickup: () => import('@rawdash/connector-clickup').then((m) => m.default),
  datadog: () => import('@rawdash/connector-datadog').then((m) => m.default),
  drata: () => import('@rawdash/connector-drata').then((m) => m.default),
  'entra-id': () =>
    import('@rawdash/connector-entra-id').then((m) => m.default),
  'firebase-analytics': () =>
    import('@rawdash/connector-firebase-analytics').then((m) => m.default),
  'firebase-crashlytics': () =>
    import('@rawdash/connector-firebase-crashlytics').then((m) => m.default),
  'gcp-billing': () =>
    import('@rawdash/connector-gcp-billing').then((m) => m.default),
  'gcp-monitoring': () =>
    import('@rawdash/connector-gcp-monitoring').then((m) => m.default),
  'github-actions': () =>
    import('@rawdash/connector-github').then((m) => m.default),
  gitlab: () => import('@rawdash/connector-gitlab').then((m) => m.default),
  'google-ads': () =>
    import('@rawdash/connector-google-ads').then((m) => m.default),
  'google-analytics': () =>
    import('@rawdash/connector-google-analytics').then((m) => m.default),
  'google-play-console': () =>
    import('@rawdash/connector-google-play-console').then((m) => m.default),
  'google-search-console': () =>
    import('@rawdash/connector-google-search-console').then((m) => m.default),
  greenhouse: () =>
    import('@rawdash/connector-greenhouse').then((m) => m.default),
  hubspot: () => import('@rawdash/connector-hubspot').then((m) => m.default),
  intercom: () => import('@rawdash/connector-intercom').then((m) => m.default),
  jira: () => import('@rawdash/connector-jira').then((m) => m.default),
  klaviyo: () => import('@rawdash/connector-klaviyo').then((m) => m.default),
  langfuse: () => import('@rawdash/connector-langfuse').then((m) => m.default),
  langsmith: () =>
    import('@rawdash/connector-langsmith').then((m) => m.default),
  launchdarkly: () =>
    import('@rawdash/connector-launchdarkly').then((m) => m.default),
  linear: () => import('@rawdash/connector-linear').then((m) => m.default),
  mailchimp: () =>
    import('@rawdash/connector-mailchimp').then((m) => m.default),
  'meta-ads': () =>
    import('@rawdash/connector-meta-ads').then((m) => m.default),
  mixpanel: () => import('@rawdash/connector-mixpanel').then((m) => m.default),
  monday: () => import('@rawdash/connector-monday').then((m) => m.default),
  netlify: () => import('@rawdash/connector-netlify').then((m) => m.default),
  'new-relic': () =>
    import('@rawdash/connector-new-relic').then((m) => m.default),
  okta: () => import('@rawdash/connector-okta').then((m) => m.default),
  openai: () => import('@rawdash/connector-openai').then((m) => m.default),
  posthog: () => import('@rawdash/connector-posthog').then((m) => m.default),
  postmark: () => import('@rawdash/connector-postmark').then((m) => m.default),
  revenuecat: () =>
    import('@rawdash/connector-revenuecat').then((m) => m.default),
  salesforce: () =>
    import('@rawdash/connector-salesforce').then((m) => m.default),
  sentry: () => import('@rawdash/connector-sentry').then((m) => m.default),
  shopify: () => import('@rawdash/connector-shopify').then((m) => m.default),
  statuspage: () =>
    import('@rawdash/connector-statuspage').then((m) => m.default),
  stripe: () => import('@rawdash/connector-stripe').then((m) => m.default),
  vanta: () => import('@rawdash/connector-vanta').then((m) => m.default),
  vercel: () => import('@rawdash/connector-vercel').then((m) => m.default),
  'vertex-ai': () =>
    import('@rawdash/connector-vertex-ai').then((m) => m.default),
  wiz: () => import('@rawdash/connector-wiz').then((m) => m.default),
  workos: () => import('@rawdash/connector-workos').then((m) => m.default),
  zendesk: () => import('@rawdash/connector-zendesk').then((m) => m.default),
};
