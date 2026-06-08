import type { ConnectorCategory } from '@rawdash/core';

export interface ConnectorPlaceholder {
  id: string;
  name: string;
  category: ConnectorCategory;
  tagline: string;
  icon?: string;
  brandColor?: string;
  requestIssue?: string;
}

export const connectorPlaceholders: ConnectorPlaceholder[] = [
  // --- Engineering -------------------------------------------------------
  {
    id: 'jenkins',
    name: 'Jenkins',
    category: 'engineering',
    tagline:
      'Sync jobs and builds with their result, duration, and trigger cause from a Jenkins server.',
    icon: 'jenkins',
    requestIssue: 'RAW-223',
  },
  {
    id: 'buildkite',
    name: 'Buildkite',
    category: 'engineering',
    tagline:
      'Sync pipelines, builds, and jobs - including state, duration, and retries - from Buildkite.',
    icon: 'buildkite',
    requestIssue: 'RAW-224',
  },
  {
    id: 'bitbucket',
    name: 'Bitbucket',
    category: 'engineering',
    tagline:
      'Sync pull requests, commits, and Pipelines runs from a Bitbucket workspace.',
    icon: 'bitbucket',
    requestIssue: 'RAW-206',
  },
  {
    id: 'slack',
    name: 'Slack',
    category: 'engineering',
    tagline:
      'Sync channel activity, message volume, and member counts from a Slack workspace.',
    brandColor: '#4A154B',
  },

  // --- Infrastructure ----------------------------------------------------
  {
    id: 'render',
    name: 'Render',
    category: 'infrastructure',
    tagline:
      'Sync services, deploys, and their build/live state from a Render account.',
    icon: 'render',
    requestIssue: 'RAW-225',
  },
  {
    id: 'fly',
    name: 'Fly.io',
    category: 'infrastructure',
    tagline:
      'Sync apps, machines, and deployments - including region and health - from Fly.io.',
    icon: 'flydotio',
    requestIssue: 'RAW-226',
  },
  {
    id: 'railway',
    name: 'Railway',
    category: 'infrastructure',
    tagline:
      'Sync projects, services, and deployments with their status from Railway.',
    icon: 'railway',
    requestIssue: 'RAW-227',
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    category: 'infrastructure',
    tagline:
      'Pull zone analytics, Workers usage, and request/bandwidth metrics from a Cloudflare account.',
    icon: 'cloudflare',
    requestIssue: 'RAW-184',
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    category: 'infrastructure',
    tagline:
      'Run scheduled SQL against a PostgreSQL database and sync the result rows as a metric or entity series.',
    icon: 'postgresql',
  },

  // --- Observability / on-call (engineering) -----------------------------
  {
    id: 'pagerduty',
    name: 'PagerDuty',
    category: 'engineering',
    tagline:
      'Sync incidents, on-call shifts, and escalation activity - including acknowledge and resolve times - from PagerDuty.',
    icon: 'pagerduty',
    requestIssue: 'RAW-191',
  },
  {
    id: 'grafana-cloud',
    name: 'Grafana Cloud',
    category: 'engineering',
    tagline:
      'Query Loki, Tempo, and Mimir and sync log, trace, and metric series from Grafana Cloud.',
    icon: 'grafana',
    requestIssue: 'RAW-210',
  },
  {
    id: 'honeycomb',
    name: 'Honeycomb',
    category: 'engineering',
    tagline:
      'Sync query results, SLOs, and trigger activity from a Honeycomb environment.',
    brandColor: '#F5A623',
    requestIssue: 'RAW-209',
  },

  // --- Security ----------------------------------------------------------
  {
    id: 'snyk',
    name: 'Snyk',
    category: 'security',
    tagline:
      'Sync projects and vulnerability issues - by severity, status, and fixability - from a Snyk organization.',
    icon: 'snyk',
    requestIssue: 'RAW-229',
  },

  // --- Support -----------------------------------------------------------
  {
    id: 'helpscout',
    name: 'Help Scout',
    category: 'support',
    tagline:
      'Sync conversations, replies, and happiness ratings from a Help Scout mailbox.',
    icon: 'helpscout',
    requestIssue: 'RAW-243',
  },
  {
    id: 'front',
    name: 'Front',
    category: 'support',
    tagline:
      'Sync conversations, tags, and response/resolution times from a Front inbox.',
    brandColor: '#001B38',
    requestIssue: 'RAW-242',
  },

  // --- Product -----------------------------------------------------------
  {
    id: 'notion',
    name: 'Notion',
    category: 'product',
    tagline:
      'Sync database rows and page properties from a Notion workspace as entities you can chart.',
    icon: 'notion',
  },
  {
    id: 'google-sheets',
    name: 'Google Sheets',
    category: 'product',
    tagline:
      'Sync rows from a Google Sheet as a metric or entity series - the simplest bring-your-own-data source.',
    icon: 'googlesheets',
  },

  // --- Analytics / warehouse --------------------------------------------
  {
    id: 'snowflake',
    name: 'Snowflake',
    category: 'analytics',
    tagline:
      'Run scheduled SQL against a Snowflake warehouse and sync the result rows as metric or entity series.',
    icon: 'snowflake',
  },
  {
    id: 'bigquery',
    name: 'Google BigQuery',
    category: 'analytics',
    tagline:
      'Run scheduled SQL against BigQuery and sync the result rows as metric or entity series.',
    icon: 'googlebigquery',
  },

  // --- Sales -------------------------------------------------------------
  {
    id: 'shopify',
    name: 'Shopify',
    category: 'sales',
    tagline:
      'Sync orders, customers, and products plus revenue and order-volume metrics from a Shopify store.',
    icon: 'shopify',
  },
  {
    id: 'pipedrive',
    name: 'Pipedrive',
    category: 'sales',
    tagline:
      'Sync deals, pipeline stages, and activities - including win rate and stage age - from Pipedrive.',
    brandColor: '#2A8C3C',
    requestIssue: 'RAW-207',
  },
  {
    id: 'apollo',
    name: 'Apollo.io',
    category: 'sales',
    tagline:
      'Sync sequences, contacts, and outreach activity from an Apollo.io account.',
    brandColor: '#2E2E5E',
    requestIssue: 'RAW-237',
  },
  {
    id: 'gong',
    name: 'Gong',
    category: 'sales',
    tagline:
      'Sync calls, deal activity, and conversation stats from a Gong workspace.',
    brandColor: '#7C3AED',
    requestIssue: 'RAW-238',
  },
  {
    id: 'zoominfo',
    name: 'ZoomInfo',
    category: 'sales',
    tagline: 'Sync enrichment and intent activity from a ZoomInfo account.',
    brandColor: '#E22B33',
    requestIssue: 'RAW-240',
  },
  {
    id: 'clearbit',
    name: 'Clearbit',
    category: 'sales',
    tagline:
      'Sync enrichment lookups and reveal activity from a Clearbit account.',
    brandColor: '#2D2D2D',
    requestIssue: 'RAW-241',
  },

  // --- Marketing ---------------------------------------------------------
  {
    id: 'webflow',
    name: 'Webflow',
    category: 'marketing',
    tagline:
      'Sync site form submissions and CMS collection items from a Webflow site.',
    icon: 'webflow',
    requestIssue: 'RAW-235',
  },
  {
    id: 'ahrefs',
    name: 'Ahrefs',
    category: 'marketing',
    tagline:
      'Sync organic traffic, keyword rankings, and backlink counts from an Ahrefs project.',
    brandColor: '#054ADA',
    requestIssue: 'RAW-233',
  },
  {
    id: 'semrush',
    name: 'Semrush',
    category: 'marketing',
    tagline:
      'Sync domain visibility, keyword positions, and traffic estimates from Semrush.',
    icon: 'semrush',
    requestIssue: 'RAW-234',
  },

  // --- Finance -----------------------------------------------------------
  {
    id: 'xero',
    name: 'Xero',
    category: 'finance',
    tagline:
      'Sync invoices, bills, and profit-and-loss figures from a Xero organization.',
    icon: 'xero',
    requestIssue: 'RAW-218',
  },
  {
    id: 'quickbooks',
    name: 'QuickBooks',
    category: 'finance',
    tagline:
      'Sync invoices, expenses, and profit-and-loss figures from QuickBooks Online.',
    icon: 'quickbooks',
    requestIssue: 'RAW-217',
  },
  {
    id: 'brex',
    name: 'Brex',
    category: 'finance',
    tagline:
      'Sync card transactions, spend by category, and budget usage from a Brex account.',
    icon: 'brex',
    requestIssue: 'RAW-220',
  },
  {
    id: 'ramp',
    name: 'Ramp',
    category: 'finance',
    tagline:
      'Sync card transactions, spend by category, and budget usage from a Ramp account.',
    brandColor: '#1A1A1A',
    requestIssue: 'RAW-221',
  },
  {
    id: 'chargebee',
    name: 'Chargebee',
    category: 'finance',
    tagline:
      'Sync subscriptions, invoices, and MRR/churn metrics from a Chargebee site.',
    brandColor: '#FF7B45',
    requestIssue: 'RAW-215',
  },
  {
    id: 'mercury',
    name: 'Mercury',
    category: 'finance',
    tagline:
      'Sync account balances and transactions from a Mercury banking account.',
    brandColor: '#5266EB',
    requestIssue: 'RAW-222',
  },
];
