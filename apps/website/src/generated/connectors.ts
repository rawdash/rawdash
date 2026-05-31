// Generated from connector metadata by scripts/generate-connector-docs.ts.
// Do not edit by hand.

export interface ConnectorCard {
  id: string;
  name: string;
  category: string;
  categoryLabel: string;
  tagline: string;
  href: string;
  iconPath: string;
  brandColor: string | null;
  keywords: string[];
}

export interface ConnectorCategory {
  id: string;
  label: string;
  count: number;
}

export const connectors: ConnectorCard[] = [
  {
    id: 'aws-cloudwatch',
    name: 'AWS CloudWatch',
    category: 'infrastructure',
    categoryLabel: 'Infrastructure',
    tagline:
      'Pull declared CloudWatch metric time series (any namespace, statistic, and period) into a single metric series per query.',
    href: '/docs/connectors/infrastructure/aws-cloudwatch/',
    iconPath: '/connectors/aws-cloudwatch.svg',
    brandColor: '#FF4F8B',
    keywords: [
      '<namespace>/<metric>',
      '@rawdash/connector-aws-cloudwatch',
      'amazon web services',
    ],
  },
  {
    id: 'aws-cost',
    name: 'AWS Cost Explorer',
    category: 'finance',
    categoryLabel: 'Finance',
    tagline:
      'Track AWS spend over time and projected month-end costs, optionally broken down by service, account, tag, or cost category.',
    href: '/docs/connectors/finance/aws-cost/',
    iconPath: '/connectors/aws-cost.svg',
    brandColor: '#6CAE3E',
    keywords: [
      '@rawdash/connector-aws-cost',
      'amazon web services',
      'aws_cost_daily',
      'aws_cost_forecast',
    ],
  },
  {
    id: 'datadog',
    name: 'Datadog',
    category: 'infrastructure',
    categoryLabel: 'Infrastructure',
    tagline:
      'Sync monitor health, monitor state-change events, incidents, SLOs, and user-declared metric queries from a Datadog org.',
    href: '/docs/connectors/infrastructure/datadog/',
    iconPath: '/connectors/datadog.svg',
    brandColor: '#632CA6',
    keywords: [
      '@rawdash/connector-datadog',
      'datadog',
      'datadog_incident',
      'datadog_metric',
      'datadog_monitor',
      'datadog_monitor_event',
      'datadog_slo',
      'datadog_slo_sli',
    ],
  },
  {
    id: 'github-actions',
    name: 'GitHub',
    category: 'engineering',
    categoryLabel: 'Engineering',
    tagline:
      'Sync pull requests, issues, deployments, releases, CI runs, and contributor activity from a GitHub repository.',
    href: '/docs/connectors/engineering/github-actions/',
    iconPath: '/connectors/github-actions.svg',
    brandColor: '#181717',
    keywords: [
      '@rawdash/connector-github',
      'contributor',
      'deployment',
      'github',
      'issue',
      'pull_request',
      'release',
      'repo',
      'workflow_run',
    ],
  },
  {
    id: 'google-analytics',
    name: 'Google Analytics',
    category: 'analytics',
    categoryLabel: 'Analytics',
    tagline:
      'Sync daily GA4 traffic, acquisition, top pages, events, conversions, and geography metrics from a Google Analytics 4 property.',
    href: '/docs/connectors/analytics/google-analytics/',
    iconPath: '/connectors/google-analytics.svg',
    brandColor: '#E37400',
    keywords: [
      '@rawdash/connector-google-analytics',
      'ga4_conversions',
      'ga4_events',
      'ga4_geo',
      'ga4_top_pages',
      'ga4_traffic_by_day',
      'ga4_traffic_by_source',
      'google analytics',
    ],
  },
  {
    id: 'google-search-console',
    name: 'Google Search Console',
    category: 'marketing',
    categoryLabel: 'Marketing',
    tagline:
      'Sync daily Search Console SEO metrics - clicks, impressions, CTR, and average position - by date, query, page, and country.',
    href: '/docs/connectors/marketing/google-search-console/',
    iconPath: '/connectors/google-search-console.svg',
    brandColor: '#458CF5',
    keywords: [
      '@rawdash/connector-google-search-console',
      'google search console',
      'gsc_search_analytics_by_day',
      'gsc_top_countries',
      'gsc_top_pages',
      'gsc_top_queries',
    ],
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    category: 'sales',
    categoryLabel: 'Sales',
    tagline:
      'Sync CRM contacts, companies, and deals plus deal stage-change events and marketing email campaign stats from HubSpot.',
    href: '/docs/connectors/sales/hubspot/',
    iconPath: '/connectors/hubspot.svg',
    brandColor: '#FF7A59',
    keywords: [
      '@rawdash/connector-hubspot',
      'hubspot',
      'hubspot_company',
      'hubspot_contact',
      'hubspot_deal',
      'hubspot_deal_stage_change',
      'hubspot_email_campaign',
      'hubspot_email_stats',
    ],
  },
  {
    id: 'intercom',
    name: 'Intercom',
    category: 'support',
    categoryLabel: 'Support',
    tagline:
      'Sync conversations, contacts, teams, and admins from Intercom for support volume, response latency, and queue-depth analytics.',
    href: '/docs/connectors/support/intercom/',
    iconPath: '/connectors/intercom.svg',
    brandColor: '#6AFDEF',
    keywords: [
      '@rawdash/connector-intercom',
      'intercom',
      'intercom_admin',
      'intercom_contact',
      'intercom_conversation',
      'intercom_conversation_state_change',
      'intercom_team',
    ],
  },
  {
    id: 'jira',
    name: 'Jira',
    category: 'product',
    categoryLabel: 'Product',
    tagline:
      'Sync projects, users, sprints, issues, and issue status-change events from a Jira Cloud site.',
    href: '/docs/connectors/product/jira/',
    iconPath: '/connectors/jira.svg',
    brandColor: '#0052CC',
    keywords: [
      '@rawdash/connector-jira',
      'atlassian',
      'jira_issue',
      'jira_issue_status_change',
      'jira_project',
      'jira_sprint',
      'jira_user',
    ],
  },
  {
    id: 'linear',
    name: 'Linear',
    category: 'product',
    categoryLabel: 'Product',
    tagline:
      'Sync teams, members, cycles, issues, and issue state-transition events from a Linear workspace.',
    href: '/docs/connectors/product/linear/',
    iconPath: '/connectors/linear.svg',
    brandColor: '#5E6AD2',
    keywords: [
      '@rawdash/connector-linear',
      'linear',
      'linear_cycle',
      'linear_issue',
      'linear_issue_state_change',
      'linear_team',
      'linear_user',
    ],
  },
  {
    id: 'mixpanel',
    name: 'Mixpanel',
    category: 'analytics',
    categoryLabel: 'Analytics',
    tagline:
      'Sync Mixpanel active-user counts, per-event volume, funnel conversion, and cohort retention as metric time series.',
    href: '/docs/connectors/analytics/mixpanel/',
    iconPath: '/connectors/mixpanel.svg',
    brandColor: '#7856FF',
    keywords: [
      '@rawdash/connector-mixpanel',
      'mixpanel',
      'mixpanel_dau',
      'mixpanel_events_per_day',
      'mixpanel_funnel_results',
      'mixpanel_mau',
      'mixpanel_retention',
      'mixpanel_wau',
    ],
  },
  {
    id: 'posthog',
    name: 'PostHog',
    category: 'product',
    categoryLabel: 'Product',
    tagline:
      'Sync feature flags, per-day event volume, feature flag usage, active users, and funnel conversion from a PostHog project.',
    href: '/docs/connectors/product/posthog/',
    iconPath: '/connectors/posthog.svg',
    brandColor: '#000000',
    keywords: [
      '@rawdash/connector-posthog',
      'posthog',
      'posthog_active_users',
      'posthog_events_per_day',
      'posthog_feature_flag',
      'posthog_feature_flag_usage',
      'posthog_funnel',
    ],
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    category: 'sales',
    categoryLabel: 'Sales',
    tagline:
      'Sync opportunities, opportunity stage-change events, accounts, leads, and users from a Salesforce org for pipeline, forecast, and quota-attainment dashboards.',
    href: '/docs/connectors/sales/salesforce/',
    iconPath: '/connectors/salesforce.svg',
    brandColor: '#00A1E0',
    keywords: [
      '@rawdash/connector-salesforce',
      'salesforce',
      'salesforce_account',
      'salesforce_lead',
      'salesforce_opportunity',
      'salesforce_opportunity_stage_change',
      'salesforce_user',
    ],
  },
  {
    id: 'sentry',
    name: 'Sentry',
    category: 'engineering',
    categoryLabel: 'Engineering',
    tagline:
      'Sync issues, issue events, releases, and hourly error rates from a Sentry organization.',
    href: '/docs/connectors/engineering/sentry/',
    iconPath: '/connectors/sentry.svg',
    brandColor: '#362D59',
    keywords: [
      '@rawdash/connector-sentry',
      'sentry',
      'sentry_errors_per_hour',
      'sentry_issue',
      'sentry_issue_event',
      'sentry_release',
    ],
  },
  {
    id: 'stripe',
    name: 'Stripe',
    category: 'finance',
    categoryLabel: 'Finance',
    tagline:
      'Sync customers, products, prices, subscriptions, and invoices alongside charge, payment, dispute, and refund events from your Stripe account.',
    href: '/docs/connectors/finance/stripe/',
    iconPath: '/connectors/stripe.svg',
    brandColor: '#635BFF',
    keywords: [
      '@rawdash/connector-stripe',
      'stripe',
      'stripe_charge',
      'stripe_customer',
      'stripe_dispute',
      'stripe_invoice',
      'stripe_payment_intent',
      'stripe_price',
      'stripe_product',
      'stripe_refund',
      'stripe_subscription',
    ],
  },
  {
    id: 'vercel',
    name: 'Vercel',
    category: 'infrastructure',
    categoryLabel: 'Infrastructure',
    tagline:
      'Sync Vercel projects and deployments - including build state, target, git ref, and build duration - across your team.',
    href: '/docs/connectors/infrastructure/vercel/',
    iconPath: '/connectors/vercel.svg',
    brandColor: '#000000',
    keywords: [
      '@rawdash/connector-vercel',
      'vercel',
      'vercel_deployment',
      'vercel_deployment_event',
      'vercel_project',
    ],
  },
];

export const connectorCategories: ConnectorCategory[] = [
  {
    id: 'engineering',
    label: 'Engineering',
    count: 2,
  },
  {
    id: 'product',
    label: 'Product',
    count: 3,
  },
  {
    id: 'analytics',
    label: 'Analytics',
    count: 2,
  },
  {
    id: 'marketing',
    label: 'Marketing',
    count: 1,
  },
  {
    id: 'sales',
    label: 'Sales',
    count: 2,
  },
  {
    id: 'support',
    label: 'Support',
    count: 1,
  },
  {
    id: 'finance',
    label: 'Finance',
    count: 2,
  },
  {
    id: 'infrastructure',
    label: 'Infrastructure',
    count: 3,
  },
];
