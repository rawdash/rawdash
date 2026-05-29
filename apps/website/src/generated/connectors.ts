// Generated from connector metadata by scripts/generate-connector-docs.ts.
// Do not edit by hand.

export interface ConnectorCard {
  id: string;
  name: string;
  category: string;
  tagline: string;
  href: string;
  iconPath: string;
  brandColor: string | null;
}

export const connectors: ConnectorCard[] = [
  {
    id: 'aws-cloudwatch',
    name: 'AWS CloudWatch',
    category: 'infrastructure',
    tagline:
      'Pull declared CloudWatch metric time series (any namespace, statistic, and period) into a single metric series per query.',
    href: '/docs/connectors/infrastructure/aws-cloudwatch/',
    iconPath: '/connectors/aws-cloudwatch.svg',
    brandColor: '#FF4F8B',
  },
  {
    id: 'aws-cost',
    name: 'AWS Cost Explorer',
    category: 'finance',
    tagline:
      'Track AWS spend over time and projected month-end costs, optionally broken down by service, account, tag, or cost category.',
    href: '/docs/connectors/finance/aws-cost/',
    iconPath: '/connectors/aws-cost.svg',
    brandColor: '#6CAE3E',
  },
  {
    id: 'github-actions',
    name: 'GitHub',
    category: 'engineering',
    tagline:
      'Sync pull requests, issues, deployments, releases, CI runs, and contributor activity from a GitHub repository.',
    href: '/docs/connectors/engineering/github-actions/',
    iconPath: '/connectors/github-actions.svg',
    brandColor: '#181717',
  },
  {
    id: 'google-analytics',
    name: 'Google Analytics',
    category: 'analytics',
    tagline:
      'Sync daily GA4 traffic, acquisition, top pages, events, conversions, and geography metrics from a Google Analytics 4 property.',
    href: '/docs/connectors/analytics/google-analytics/',
    iconPath: '/connectors/google-analytics.svg',
    brandColor: '#E37400',
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    category: 'sales',
    tagline:
      'Sync CRM contacts, companies, and deals plus deal stage-change events and marketing email campaign stats from HubSpot.',
    href: '/docs/connectors/sales/hubspot/',
    iconPath: '/connectors/hubspot.svg',
    brandColor: '#FF7A59',
  },
  {
    id: 'jira',
    name: 'Jira',
    category: 'product',
    tagline:
      'Sync projects, users, sprints, issues, and issue status-change events from a Jira Cloud site.',
    href: '/docs/connectors/product/jira/',
    iconPath: '/connectors/jira.svg',
    brandColor: '#0052CC',
  },
  {
    id: 'linear',
    name: 'Linear',
    category: 'product',
    tagline:
      'Sync teams, members, cycles, issues, and issue state-transition events from a Linear workspace.',
    href: '/docs/connectors/product/linear/',
    iconPath: '/connectors/linear.svg',
    brandColor: '#5E6AD2',
  },
  {
    id: 'mixpanel',
    name: 'Mixpanel',
    category: 'analytics',
    tagline:
      'Sync Mixpanel active-user counts, per-event volume, funnel conversion, and cohort retention as metric time series.',
    href: '/docs/connectors/analytics/mixpanel/',
    iconPath: '/connectors/mixpanel.svg',
    brandColor: '#7856FF',
  },
  {
    id: 'posthog',
    name: 'PostHog',
    category: 'product',
    tagline:
      'Sync feature flags, per-day event volume, feature flag usage, active users, and funnel conversion from a PostHog project.',
    href: '/docs/connectors/product/posthog/',
    iconPath: '/connectors/posthog.svg',
    brandColor: '#000000',
  },
  {
    id: 'sentry',
    name: 'Sentry',
    category: 'engineering',
    tagline:
      'Sync issues, issue events, releases, and hourly error rates from a Sentry organization.',
    href: '/docs/connectors/engineering/sentry/',
    iconPath: '/connectors/sentry.svg',
    brandColor: '#362D59',
  },
  {
    id: 'stripe',
    name: 'Stripe',
    category: 'finance',
    tagline:
      'Sync customers, products, prices, subscriptions, and invoices alongside charge, payment, dispute, and refund events from your Stripe account.',
    href: '/docs/connectors/finance/stripe/',
    iconPath: '/connectors/stripe.svg',
    brandColor: '#635BFF',
  },
  {
    id: 'vercel',
    name: 'Vercel',
    category: 'infrastructure',
    tagline:
      'Sync Vercel projects and deployments - including build state, target, git ref, and build duration - across your team.',
    href: '/docs/connectors/infrastructure/vercel/',
    iconPath: '/connectors/vercel.svg',
    brandColor: '#000000',
  },
];
