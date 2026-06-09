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
  {
    id: 'asana',
    name: 'Asana',
    category: 'engineering',
    tagline:
      'Sync tasks, projects, and completion activity from an Asana workspace.',
    icon: 'asana',
    requestIssue: 'RAW-424',
  },
  {
    id: 'basecamp',
    name: 'Basecamp',
    category: 'engineering',
    tagline:
      'Sync to-dos, message boards, and project activity from a Basecamp account.',
    icon: 'basecamp',
  },
  {
    id: 'bitrise',
    name: 'Bitrise',
    category: 'engineering',
    tagline:
      'Sync mobile CI builds with their state, duration, and trigger source from Bitrise.',
    icon: 'bitrise',
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
    id: 'clickup',
    name: 'ClickUp',
    category: 'engineering',
    tagline:
      'Sync tasks, lists, and completion throughput from a ClickUp workspace.',
    icon: 'clickup',
    requestIssue: 'RAW-425',
  },
  {
    id: 'codacy',
    name: 'Codacy',
    category: 'engineering',
    tagline:
      'Sync code quality issues, coverage, and per-repo grades from Codacy.',
    icon: 'codacy',
  },
  {
    id: 'codeclimate',
    name: 'Code Climate',
    category: 'engineering',
    tagline:
      'Sync maintainability, technical debt, and coverage trends from Code Climate.',
    brandColor: '#000000',
  },
  {
    id: 'codemagic',
    name: 'Codemagic',
    category: 'engineering',
    tagline:
      'Sync mobile CI builds, distributions, and test reports from Codemagic.',
    brandColor: '#7E5BEF',
  },
  {
    id: 'deepsource',
    name: 'DeepSource',
    category: 'engineering',
    tagline:
      'Sync issues, coverage, and per-analyzer findings from DeepSource.',
    brandColor: '#21AC7A',
  },
  {
    id: 'docker-hub',
    name: 'Docker Hub',
    category: 'engineering',
    tagline:
      'Sync repositories with pull counts, star counts, and last-push activity from Docker Hub.',
    icon: 'docker',
  },
  {
    id: 'dynatrace',
    name: 'Dynatrace',
    category: 'engineering',
    tagline:
      'Sync problems, hosts, and entity metrics from a Dynatrace environment.',
    icon: 'dynatrace',
  },
  {
    id: 'eas-build',
    name: 'EAS Build (Expo)',
    category: 'engineering',
    tagline:
      'Sync Expo Application Services builds, updates, and submission status.',
    icon: 'expo',
  },
  {
    id: 'github-container-registry',
    name: 'GitHub Container Registry',
    category: 'engineering',
    tagline:
      'Sync container packages, downloads, and version counts from GHCR.',
    icon: 'github',
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
    id: 'harvest',
    name: 'Harvest',
    category: 'engineering',
    tagline:
      'Sync tracked time, by-project breakdowns, and team utilization from Harvest.',
    brandColor: '#FA5D00',
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
    id: 'logrocket',
    name: 'LogRocket',
    category: 'engineering',
    tagline:
      'Sync session counts, error volume, and frontend performance from LogRocket.',
    brandColor: '#764ABC',
  },
  {
    id: 'mage',
    name: 'Mage',
    category: 'engineering',
    tagline: 'Sync pipeline runs, schedules, and failures from Mage.',
    brandColor: '#7B61FF',
  },
  {
    id: 'mezmo',
    name: 'Mezmo',
    category: 'engineering',
    tagline:
      'Sync log volumes, error counts, and per-source rates from Mezmo (LogDNA).',
    brandColor: '#3B82F6',
  },
  {
    id: 'microsoft-app-center',
    name: 'Microsoft App Center',
    category: 'engineering',
    tagline:
      'Sync mobile builds, distributions, crashes, and analytics from App Center.',
    brandColor: '#0078D4',
  },
  {
    id: 'microsoft-teams',
    name: 'Microsoft Teams',
    category: 'engineering',
    tagline:
      'Sync channel activity, message volume, and team membership from Microsoft Teams.',
    brandColor: '#4B53BC',
  },
  {
    id: 'monday',
    name: 'Monday.com',
    category: 'engineering',
    tagline:
      'Sync items, boards, and status throughput from a Monday.com workspace.',
    brandColor: '#FF3D57',
    requestIssue: 'RAW-426',
  },
  {
    id: 'mysql',
    name: 'MySQL',
    category: 'engineering',
    tagline:
      'Run scheduled SQL against a MySQL database and sync the result rows as a metric or entity series.',
    icon: 'mysql',
    requestIssue: 'RAW-442',
  },
  {
    id: 'npm-stats',
    name: 'npm Stats',
    category: 'engineering',
    tagline:
      'Sync daily download counts for npm packages you maintain or depend on.',
    icon: 'npm',
    requestIssue: 'RAW-228',
  },
  {
    id: 'opsgenie',
    name: 'Opsgenie',
    category: 'engineering',
    tagline:
      'Sync alerts, incidents, and on-call shifts from an Opsgenie team.',
    icon: 'opsgenie',
    requestIssue: 'RAW-208',
  },
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
    id: 'rollbar',
    name: 'Rollbar',
    category: 'engineering',
    tagline:
      'Sync errors, occurrence counts, and people-affected metrics from Rollbar.',
    brandColor: '#FF5A5F',
  },
  {
    id: 'shortcut',
    name: 'Shortcut',
    category: 'engineering',
    tagline:
      'Sync stories, epics, and cycle activity from a Shortcut workspace.',
    icon: 'shortcut',
  },
  {
    id: 'slack',
    name: 'Slack',
    category: 'engineering',
    tagline:
      'Sync channel activity, message volume, and member counts from a Slack workspace.',
    brandColor: '#4A154B',
  },
  {
    id: 'sonarcloud',
    name: 'SonarCloud',
    category: 'engineering',
    tagline:
      'Sync code quality issues, coverage, and per-branch grades from SonarCloud.',
    brandColor: '#F3702A',
  },
  {
    id: 'splunk',
    name: 'Splunk',
    category: 'engineering',
    tagline:
      'Sync saved-search results and alert counts from a Splunk instance.',
    icon: 'splunk',
  },
  {
    id: 'sumo-logic',
    name: 'Sumo Logic',
    category: 'engineering',
    tagline:
      'Sync search results, alert volume, and source health from Sumo Logic.',
    brandColor: '#000099',
  },
  {
    id: 'temporal',
    name: 'Temporal',
    category: 'engineering',
    tagline:
      'Sync workflow runs, failures, and queue depth from a Temporal cluster.',
    icon: 'temporal',
  },
  {
    id: 'terraform-cloud',
    name: 'Terraform Cloud',
    category: 'engineering',
    tagline:
      'Sync workspace runs, plan/apply outcomes, and drift state from Terraform Cloud.',
    icon: 'terraform',
  },
  {
    id: 'testrail',
    name: 'TestRail',
    category: 'engineering',
    tagline:
      'Sync test runs, pass/fail breakdowns, and milestone progress from TestRail.',
    brandColor: '#65C179',
  },
  {
    id: 'toggl',
    name: 'Toggl Track',
    category: 'engineering',
    tagline:
      'Sync tracked time, by-project hours, and team utilization from Toggl Track.',
    icon: 'toggl',
  },
  {
    id: 'trello',
    name: 'Trello',
    category: 'engineering',
    tagline: 'Sync cards, lists, and board activity from a Trello workspace.',
    icon: 'trello',
  },
  {
    id: 'trigger-dev',
    name: 'Trigger.dev',
    category: 'engineering',
    tagline:
      'Sync job runs, schedules, and failures from a Trigger.dev project.',
    brandColor: '#7C3AED',
  },
  {
    id: 'wrike',
    name: 'Wrike',
    category: 'engineering',
    tagline: 'Sync tasks, projects, and workload across a Wrike account.',
    brandColor: '#0088CC',
  },
  {
    id: 'zoom',
    name: 'Zoom',
    category: 'engineering',
    tagline:
      'Sync meeting counts, total minutes, and webinar attendance from Zoom.',
    icon: 'zoom',
  },

  {
    id: 'airflow',
    name: 'Apache Airflow',
    category: 'infrastructure',
    tagline:
      'Sync DAG runs, task instances, and SLA miss counts from an Airflow deployment.',
    icon: 'apacheairflow',
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
    id: 'cockroachdb',
    name: 'CockroachDB Cloud',
    category: 'infrastructure',
    tagline:
      'Sync cluster status, regions, and connection metrics from CockroachDB Cloud.',
    icon: 'cockroachlabs',
  },
  {
    id: 'confluent-cloud',
    name: 'Confluent Cloud',
    category: 'infrastructure',
    tagline:
      'Sync topic message rates, consumer lag, and cluster throughput from Confluent Cloud.',
    icon: 'apachekafka',
  },
  {
    id: 'dagster',
    name: 'Dagster',
    category: 'infrastructure',
    tagline:
      'Sync runs, asset materializations, and schedules from a Dagster deployment.',
    brandColor: '#19B5E1',
  },
  {
    id: 'digitalocean',
    name: 'DigitalOcean',
    category: 'infrastructure',
    tagline:
      'Sync droplets, databases, app deployments, and monthly spend from DigitalOcean.',
    icon: 'digitalocean',
  },
  {
    id: 'fastly',
    name: 'Fastly',
    category: 'infrastructure',
    tagline:
      'Sync requests, cache-hit ratio, and origin performance from Fastly.',
    icon: 'fastly',
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
    id: 'heroku',
    name: 'Heroku',
    category: 'infrastructure',
    tagline:
      'Sync apps, dynos, deploys, and monthly spend from a Heroku account.',
    brandColor: '#6762A6',
  },
  {
    id: 'inngest',
    name: 'Inngest',
    category: 'infrastructure',
    tagline:
      'Sync function runs, queue depth, and failures from an Inngest workspace.',
    brandColor: '#000000',
  },
  {
    id: 'mongodb-atlas',
    name: 'MongoDB Atlas',
    category: 'infrastructure',
    tagline:
      'Sync cluster state, connection counts, and read/write throughput from MongoDB Atlas.',
    icon: 'mongodb',
  },
  {
    id: 'neon',
    name: 'Neon',
    category: 'infrastructure',
    tagline: 'Sync projects, branches, and compute-hours from a Neon account.',
    brandColor: '#00E699',
  },
  {
    id: 'planetscale',
    name: 'PlanetScale',
    category: 'infrastructure',
    tagline:
      'Sync database branches, deploy requests, and query latency from PlanetScale.',
    icon: 'planetscale',
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    category: 'infrastructure',
    tagline:
      'Run scheduled SQL against a PostgreSQL database and sync the result rows as a metric or entity series.',
    icon: 'postgresql',
    requestIssue: 'RAW-441',
  },
  {
    id: 'prefect',
    name: 'Prefect',
    category: 'infrastructure',
    tagline:
      'Sync flow runs, schedules, and failures from a Prefect workspace.',
    icon: 'prefect',
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
    id: 'redis',
    name: 'Redis',
    category: 'infrastructure',
    tagline:
      'Sync key counts, memory usage, and command throughput from a Redis instance.',
    icon: 'redis',
  },
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
    id: 'statusgator',
    name: 'StatusGator',
    category: 'infrastructure',
    tagline:
      "Aggregate the public status pages of every SaaS you depend on into a single 'is anything down?' view.",
    brandColor: '#5C6BC0',
    requestIssue: 'RAW-452',
  },
  {
    id: 'supabase',
    name: 'Supabase',
    category: 'infrastructure',
    tagline:
      'Sync project status, auth users, and database storage from a Supabase project.',
    icon: 'supabase',
  },
  {
    id: 'upstash',
    name: 'Upstash',
    category: 'infrastructure',
    tagline:
      'Sync request counts, bandwidth, and storage across Upstash Redis/Kafka databases.',
    icon: 'upstash',
  },

  {
    id: '1password',
    name: '1Password',
    category: 'security',
    tagline:
      'Sync vault item counts, recently changed credentials, and watchtower findings from a 1Password account.',
    icon: '1password',
  },
  {
    id: 'auth0',
    name: 'Auth0',
    category: 'security',
    tagline:
      'Sync users, sign-up rate, MFA adoption, and failed-login activity from an Auth0 tenant.',
    icon: 'auth0',
    requestIssue: 'RAW-416',
  },
  {
    id: 'clerk',
    name: 'Clerk',
    category: 'security',
    tagline:
      'Sync users, organizations, and sign-in activity from a Clerk application.',
    brandColor: '#6C47FF',
    requestIssue: 'RAW-418',
  },
  {
    id: 'crowdstrike',
    name: 'CrowdStrike Falcon',
    category: 'security',
    tagline:
      'Sync detections, incidents, and host coverage from CrowdStrike Falcon.',
    brandColor: '#FA0202',
  },
  {
    id: 'drata',
    name: 'Drata',
    category: 'security',
    tagline:
      'Sync control status, failing tests, and audit-ready percentage from Drata.',
    brandColor: '#6D2BFF',
    requestIssue: 'RAW-422',
  },
  {
    id: 'entra-id',
    name: 'Microsoft Entra ID',
    category: 'security',
    tagline:
      'Sync sign-ins, risky users, and MFA adoption from a Microsoft Entra ID tenant.',
    brandColor: '#0078D4',
    requestIssue: 'RAW-420',
  },
  {
    id: 'have-i-been-pwned',
    name: 'Have I Been Pwned',
    category: 'security',
    tagline: 'Watch a list of company domains for new breach disclosures.',
    brandColor: '#1F4068',
  },
  {
    id: 'lacework',
    name: 'Lacework',
    category: 'security',
    tagline:
      'Sync cloud security findings, severity distribution, and coverage from Lacework.',
    brandColor: '#1A57F1',
  },
  {
    id: 'microsoft-defender',
    name: 'Microsoft Defender',
    category: 'security',
    tagline:
      'Sync detections, incidents, and device exposure from Microsoft Defender.',
    brandColor: '#0078D4',
  },
  {
    id: 'okta',
    name: 'Okta',
    category: 'security',
    tagline: 'Sync users, sign-ins, and MFA enrollment from an Okta org.',
    icon: 'okta',
    requestIssue: 'RAW-417',
  },
  {
    id: 'orca-security',
    name: 'Orca Security',
    category: 'security',
    tagline:
      'Sync cloud assets, alerts, and severity counts from Orca Security.',
    brandColor: '#202020',
  },
  {
    id: 'qualys',
    name: 'Qualys',
    category: 'security',
    tagline:
      'Sync vulnerabilities, asset coverage, and compliance scan results from Qualys.',
    brandColor: '#ED1C24',
  },
  {
    id: 'rapid7-insightvm',
    name: 'Rapid7 InsightVM',
    category: 'security',
    tagline:
      'Sync vulnerabilities, asset coverage, and remediation progress from InsightVM.',
    brandColor: '#1A1A1A',
  },
  {
    id: 'secureframe',
    name: 'Secureframe',
    category: 'security',
    tagline:
      'Sync control status, evidence age, and audit readiness from Secureframe.',
    brandColor: '#7C3AED',
  },
  {
    id: 'sentinelone',
    name: 'SentinelOne',
    category: 'security',
    tagline: 'Sync threats, incidents, and endpoint coverage from SentinelOne.',
    brandColor: '#6B0AEA',
  },
  {
    id: 'snyk',
    name: 'Snyk',
    category: 'security',
    tagline:
      'Sync projects and vulnerability issues - by severity, status, and fixability - from a Snyk organization.',
    icon: 'snyk',
    requestIssue: 'RAW-229',
  },
  {
    id: 'ssl-monitor',
    name: 'SSL Certificate Monitor',
    category: 'security',
    tagline:
      'Watch TLS certificates on a list of domains - days-until-expiry, issuer, and reachability.',
    brandColor: '#00ADD8',
    requestIssue: 'RAW-451',
  },
  {
    id: 'tenable',
    name: 'Tenable',
    category: 'security',
    tagline:
      'Sync vulnerabilities, asset coverage, and scan results from Tenable.',
    brandColor: '#00B5E2',
  },
  {
    id: 'vanta',
    name: 'Vanta',
    category: 'security',
    tagline:
      'Sync control status, failing tests, and audit-ready percentage from Vanta.',
    brandColor: '#45D5BB',
    requestIssue: 'RAW-421',
  },
  {
    id: 'wiz',
    name: 'Wiz',
    category: 'security',
    tagline:
      'Sync cloud security findings by severity and remediation progress from Wiz.',
    brandColor: '#11253E',
    requestIssue: 'RAW-423',
  },
  {
    id: 'workos',
    name: 'WorkOS',
    category: 'security',
    tagline:
      'Sync organizations, SSO connections, directory-sync activity, and SSO logins from WorkOS.',
    brandColor: '#6363F1',
    requestIssue: 'RAW-419',
  },

  {
    id: 'freshdesk',
    name: 'Freshdesk',
    category: 'support',
    tagline:
      'Sync tickets, SLA breach counts, agent activity, and CSAT from a Freshdesk account.',
    brandColor: '#25C16F',
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
  {
    id: 'gladly',
    name: 'Gladly',
    category: 'support',
    tagline: 'Sync conversations, channels, and agent activity from Gladly.',
    brandColor: '#FE4F2D',
  },
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
    id: 'jira-service-management',
    name: 'Jira Service Management',
    category: 'support',
    tagline:
      'Sync service requests, SLA breach counts, and resolution times from Jira Service Management.',
    icon: 'jira',
    requestIssue: 'RAW-446',
  },
  {
    id: 'kayako',
    name: 'Kayako',
    category: 'support',
    tagline: 'Sync cases, replies, and CSAT from a Kayako instance.',
    brandColor: '#E62828',
  },
  {
    id: 'servicenow',
    name: 'ServiceNow',
    category: 'support',
    tagline:
      'Sync incidents, change requests, and SLA breach counts from a ServiceNow instance.',
    brandColor: '#62D84E',
    requestIssue: 'RAW-445',
  },

  {
    id: 'airtable',
    name: 'Airtable',
    category: 'product',
    tagline:
      'Sync records from selected bases as entities or metric series - bring-your-own-data from Airtable.',
    icon: 'airtable',
  },
  {
    id: 'algolia',
    name: 'Algolia',
    category: 'product',
    tagline:
      "Sync search query counts, CTR, top queries, and no-result rate from Algolia's analytics.",
    icon: 'algolia',
    requestIssue: 'RAW-448',
  },
  {
    id: 'app-store-connect',
    name: 'App Store Connect',
    category: 'product',
    tagline:
      'Sync app installs, in-app revenue, and ratings across territories from App Store Connect.',
    icon: 'appstore',
    requestIssue: 'RAW-403',
  },
  {
    id: 'appcues',
    name: 'Appcues',
    category: 'product',
    tagline:
      'Sync flow engagement, completion rates, and feature adoption from Appcues.',
    brandColor: '#4F36C6',
  },
  {
    id: 'bugsnag',
    name: 'Bugsnag',
    category: 'product',
    tagline:
      'Sync errors, occurrence counts, and people-affected metrics from Bugsnag.',
    brandColor: '#4949E4',
  },
  {
    id: 'canny',
    name: 'Canny',
    category: 'product',
    tagline: 'Sync feature requests, upvotes, and roadmap status from Canny.',
    brandColor: '#FF005C',
  },
  {
    id: 'chameleon',
    name: 'Chameleon',
    category: 'product',
    tagline: 'Sync tour engagement and completion rates from Chameleon.',
    brandColor: '#3700FF',
  },
  {
    id: 'configcat',
    name: 'ConfigCat',
    category: 'product',
    tagline:
      'Sync feature flags, evaluations, and rollout state from ConfigCat.',
    brandColor: '#FA0F00',
  },
  {
    id: 'delighted',
    name: 'Delighted',
    category: 'product',
    tagline: 'Sync NPS, CSAT, and CES survey responses from Delighted.',
    brandColor: '#1FB39A',
  },
  {
    id: 'firebase-analytics',
    name: 'Firebase Analytics',
    category: 'product',
    tagline:
      'Sync DAU, retention, and in-app event volume from Firebase Analytics.',
    icon: 'firebase',
    requestIssue: 'RAW-406',
  },
  {
    id: 'flagsmith',
    name: 'Flagsmith',
    category: 'product',
    tagline:
      'Sync feature flags, environments, and evaluations from Flagsmith.',
    brandColor: '#1A2233',
  },
  {
    id: 'fullstory',
    name: 'FullStory',
    category: 'product',
    tagline:
      'Sync session counts, frustration signals, and conversion funnels from FullStory.',
    brandColor: '#F24405',
  },
  {
    id: 'gainsight',
    name: 'Gainsight',
    category: 'product',
    tagline:
      'Sync customer health scores, renewal risk, and CTAs from Gainsight.',
    brandColor: '#F58220',
  },
  {
    id: 'google-play-console',
    name: 'Google Play Console',
    category: 'product',
    tagline:
      'Sync app installs, in-app revenue, and ratings across countries from Google Play Console.',
    icon: 'googleplay',
    requestIssue: 'RAW-404',
  },
  {
    id: 'google-sheets',
    name: 'Google Sheets',
    category: 'product',
    tagline:
      'Sync rows from a Google Sheet as a metric or entity series - the simplest bring-your-own-data source.',
    icon: 'googlesheets',
  },
  {
    id: 'growthbook',
    name: 'GrowthBook',
    category: 'product',
    tagline: 'Sync feature flags and experiment results from GrowthBook.',
    brandColor: '#6F4DBC',
  },
  {
    id: 'heap',
    name: 'Heap',
    category: 'product',
    tagline: 'Sync DAU, event volume, and funnel results from Heap.',
    brandColor: '#15ADDE',
  },
  {
    id: 'hotjar',
    name: 'Hotjar',
    category: 'product',
    tagline: 'Sync survey response volume and NPS scores from Hotjar.',
    icon: 'hotjar',
  },
  {
    id: 'microsoft-clarity',
    name: 'Microsoft Clarity',
    category: 'product',
    tagline:
      'Sync session counts, rage clicks, dead clicks, and frustration signals from Microsoft Clarity.',
    brandColor: '#2D3FED',
  },
  {
    id: 'notion',
    name: 'Notion',
    category: 'product',
    tagline:
      'Sync database rows and page properties from a Notion workspace as entities you can chart.',
    icon: 'notion',
  },
  {
    id: 'optimizely',
    name: 'Optimizely',
    category: 'product',
    tagline:
      'Sync experiments, variations, and lift estimates from Optimizely.',
    brandColor: '#0037FF',
  },
  {
    id: 'pendo',
    name: 'Pendo',
    category: 'product',
    tagline: 'Sync feature adoption, guide engagement, and NPS from Pendo.',
    brandColor: '#FF4876',
  },
  {
    id: 'productboard',
    name: 'Productboard',
    category: 'product',
    tagline:
      'Sync features, notes, and prioritization scores from Productboard.',
    brandColor: '#3F4060',
  },
  {
    id: 'survicate',
    name: 'Survicate',
    category: 'product',
    tagline: 'Sync survey responses, NPS, and CSAT from Survicate.',
    brandColor: '#FF8C42',
  },
  {
    id: 'typeform',
    name: 'Typeform',
    category: 'product',
    tagline:
      'Sync form submissions, completion rates, and answer distribution from Typeform.',
    icon: 'typeform',
  },
  {
    id: 'unleash',
    name: 'Unleash',
    category: 'product',
    tagline:
      'Sync feature toggles, evaluations, and environments from Unleash.',
    brandColor: '#1A2333',
  },
  {
    id: 'userpilot',
    name: 'Userpilot',
    category: 'product',
    tagline:
      'Sync onboarding flow completion and feature adoption from Userpilot.',
    brandColor: '#7438FF',
  },
  {
    id: 'vwo',
    name: 'VWO',
    category: 'product',
    tagline: 'Sync A/B tests, variations, and conversion lift from VWO.',
    brandColor: '#EE3F46',
  },

  {
    id: 'bigquery',
    name: 'Google BigQuery',
    category: 'analytics',
    tagline:
      'Run scheduled SQL against BigQuery and sync the result rows as metric or entity series.',
    icon: 'googlebigquery',
    requestIssue: 'RAW-444',
  },
  {
    id: 'snowflake',
    name: 'Snowflake',
    category: 'analytics',
    tagline:
      'Run scheduled SQL against a Snowflake warehouse and sync the result rows as metric or entity series.',
    icon: 'snowflake',
    requestIssue: 'RAW-443',
  },

  {
    id: 'activecampaign',
    name: 'ActiveCampaign',
    category: 'marketing',
    tagline:
      'Sync campaigns, sends, open/click rates, and automations from ActiveCampaign.',
    brandColor: '#356AE6',
  },
  {
    id: 'agorapulse',
    name: 'Agorapulse',
    category: 'marketing',
    tagline:
      'Sync scheduled posts, engagement, and inbox volume from Agorapulse.',
    brandColor: '#56A7DB',
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
    id: 'appsflyer',
    name: 'AppsFlyer',
    category: 'marketing',
    tagline:
      'Sync mobile installs, CPI, ROAS, and retention by source from AppsFlyer.',
    brandColor: '#007AFF',
    requestIssue: 'RAW-408',
  },
  {
    id: 'beehiiv',
    name: 'Beehiiv',
    category: 'marketing',
    tagline:
      'Sync newsletter subscribers, opens, clicks, and revenue from Beehiiv.',
    brandColor: '#F1D52F',
  },
  {
    id: 'braze',
    name: 'Braze',
    category: 'marketing',
    tagline:
      'Sync campaigns, message volume, opens, clicks, and conversions from Braze.',
    brandColor: '#FA9810',
  },
  {
    id: 'branch',
    name: 'Branch',
    category: 'marketing',
    tagline:
      'Sync deep-link conversions, install attribution, and channel performance from Branch.',
    brandColor: '#7CB833',
    requestIssue: 'RAW-409',
  },
  {
    id: 'buffer',
    name: 'Buffer',
    category: 'marketing',
    tagline: 'Sync scheduled posts and per-channel engagement from Buffer.',
    icon: 'buffer',
  },
  {
    id: 'buttondown',
    name: 'Buttondown',
    category: 'marketing',
    tagline: 'Sync newsletter subscribers, opens, and clicks from Buttondown.',
    brandColor: '#000000',
  },
  {
    id: 'buy-me-a-coffee',
    name: 'Buy Me a Coffee',
    category: 'marketing',
    tagline:
      'Sync supporter count and monthly contributions from Buy Me a Coffee.',
    brandColor: '#FFDD00',
  },
  {
    id: 'circle',
    name: 'Circle',
    category: 'marketing',
    tagline:
      'Sync members, posts, and engagement across spaces in a Circle community.',
    brandColor: '#000000',
  },
  {
    id: 'constant-contact',
    name: 'Constant Contact',
    category: 'marketing',
    tagline: 'Sync campaigns, sends, opens, and clicks from Constant Contact.',
    brandColor: '#1856ED',
  },
  {
    id: 'convertkit',
    name: 'ConvertKit / Kit',
    category: 'marketing',
    tagline:
      'Sync subscribers, broadcasts, sequences, and revenue from ConvertKit / Kit.',
    brandColor: '#FB6970',
  },
  {
    id: 'crunchbase',
    name: 'Crunchbase',
    category: 'marketing',
    tagline:
      'Watch competitor companies for funding events and news velocity from Crunchbase.',
    icon: 'crunchbase',
  },
  {
    id: 'customer-io',
    name: 'Customer.io',
    category: 'marketing',
    tagline:
      'Sync campaigns, broadcasts, and per-message engagement from Customer.io.',
    brandColor: '#7C3AED',
    requestIssue: 'RAW-232',
  },
  {
    id: 'discord',
    name: 'Discord',
    category: 'marketing',
    tagline:
      'Sync member count, DAU, joins, and message volume across channels in a Discord server.',
    icon: 'discord',
    requestIssue: 'RAW-447',
  },
  {
    id: 'discourse',
    name: 'Discourse',
    category: 'marketing',
    tagline:
      'Sync topics, posts, daily active users, and trust-level distribution from a Discourse community.',
    icon: 'discourse',
  },
  {
    id: 'drip',
    name: 'Drip',
    category: 'marketing',
    tagline: 'Sync campaigns, sends, opens, and revenue from Drip.',
    brandColor: '#EC568B',
  },
  {
    id: 'eventbrite',
    name: 'Eventbrite',
    category: 'marketing',
    tagline: 'Sync events, tickets sold, and revenue from Eventbrite.',
    brandColor: '#F05537',
  },
  {
    id: 'facebook-pages',
    name: 'Facebook Pages',
    category: 'marketing',
    tagline: 'Sync followers, post engagement, and reach from a Facebook Page.',
    icon: 'facebook',
  },
  {
    id: 'firebase-cloud-messaging',
    name: 'Firebase Cloud Messaging',
    category: 'marketing',
    tagline:
      'Sync push send volume, delivery rate, and opens from Firebase Cloud Messaging.',
    icon: 'firebase',
    requestIssue: 'RAW-450',
  },
  {
    id: 'getresponse',
    name: 'GetResponse',
    category: 'marketing',
    tagline: 'Sync campaigns, list growth, opens, and clicks from GetResponse.',
    brandColor: '#00BAFF',
  },
  {
    id: 'github-sponsors',
    name: 'GitHub Sponsors',
    category: 'marketing',
    tagline:
      'Sync active sponsors, monthly recurring sponsorship, and tier distribution from GitHub Sponsors.',
    icon: 'github',
  },
  {
    id: 'glassdoor',
    name: 'Glassdoor',
    category: 'marketing',
    tagline:
      'Sync employer ratings, review count, and rating-category trends from Glassdoor.',
    icon: 'glassdoor',
  },
  {
    id: 'hacker-news',
    name: 'Hacker News',
    category: 'marketing',
    tagline:
      'Watch HN for submissions of your domain and mentions in comments - points, comments, rank.',
    brandColor: '#FF6600',
    requestIssue: 'RAW-455',
  },
  {
    id: 'hootsuite',
    name: 'Hootsuite',
    category: 'marketing',
    tagline:
      'Sync scheduled posts and engagement across channels from Hootsuite.',
    icon: 'hootsuite',
  },
  {
    id: 'instagram-graph',
    name: 'Instagram',
    category: 'marketing',
    tagline:
      'Sync followers, post engagement, and reach via the Instagram Graph API.',
    icon: 'instagram',
  },
  {
    id: 'iterable',
    name: 'Iterable',
    category: 'marketing',
    tagline:
      'Sync campaigns, sends, opens, clicks, and conversions from Iterable.',
    brandColor: '#3650FA',
  },
  {
    id: 'ko-fi',
    name: 'Ko-fi',
    category: 'marketing',
    tagline:
      'Sync supporters, one-off contributions, and membership tiers from Ko-fi.',
    brandColor: '#FF5E5B',
  },
  {
    id: 'later',
    name: 'Later',
    category: 'marketing',
    tagline: 'Sync scheduled posts and engagement across channels from Later.',
    brandColor: '#5D5DFF',
  },
  {
    id: 'linkedin-ads',
    name: 'LinkedIn Ads',
    category: 'marketing',
    tagline:
      'Sync campaign metrics - impressions, clicks, cost, conversions - from LinkedIn Ads.',
    brandColor: '#0A66C2',
    requestIssue: 'RAW-230',
  },
  {
    id: 'linkedin-pages',
    name: 'LinkedIn Pages',
    category: 'marketing',
    tagline:
      'Sync followers, post engagement, and impressions for a LinkedIn Page.',
    brandColor: '#0A66C2',
  },
  {
    id: 'lob',
    name: 'Lob',
    category: 'marketing',
    tagline:
      'Sync direct-mail sends, delivery status, and per-template performance from Lob.',
    brandColor: '#0099D8',
  },
  {
    id: 'luma',
    name: 'Luma',
    category: 'marketing',
    tagline:
      'Sync events, registrations, and check-in counts from Luma (lu.ma).',
    brandColor: '#5E5BFF',
  },
  {
    id: 'mailerlite',
    name: 'MailerLite',
    category: 'marketing',
    tagline: 'Sync subscribers, campaigns, opens, and clicks from MailerLite.',
    brandColor: '#1A82E0',
  },
  {
    id: 'marketo',
    name: 'Marketo',
    category: 'marketing',
    tagline:
      'Sync programs, leads, email engagement, and pipeline contribution from Marketo.',
    brandColor: '#5C4C9F',
  },
  {
    id: 'moengage',
    name: 'MoEngage',
    category: 'marketing',
    tagline: 'Sync campaigns, message volume, and conversions from MoEngage.',
    brandColor: '#FF665A',
  },
  {
    id: 'onesignal',
    name: 'OneSignal',
    category: 'marketing',
    tagline:
      'Sync push send volume, delivery rate, opt-ins, and per-notification conversions from OneSignal.',
    brandColor: '#E54B4D',
    requestIssue: 'RAW-449',
  },
  {
    id: 'opencollective',
    name: 'Open Collective',
    category: 'marketing',
    tagline: 'Sync sponsors, MRR, and balance for an Open Collective.',
    brandColor: '#1869F4',
  },
  {
    id: 'oss-insight',
    name: 'OSS Insight',
    category: 'marketing',
    tagline:
      'Sync GitHub star trajectory, contributor growth, and comparative position vs peer repos.',
    brandColor: '#FF8800',
    requestIssue: 'RAW-453',
  },
  {
    id: 'pardot',
    name: 'Pardot (Account Engagement)',
    category: 'marketing',
    tagline:
      'Sync prospects, emails, forms, and pipeline contribution from Pardot.',
    brandColor: '#00A1E0',
  },
  {
    id: 'patreon',
    name: 'Patreon',
    category: 'marketing',
    tagline:
      'Sync active patrons, MRR, tier distribution, and pledges from Patreon.',
    icon: 'patreon',
  },
  {
    id: 'pinterest',
    name: 'Pinterest',
    category: 'marketing',
    tagline:
      'Sync followers, impressions, and pin engagement from a Pinterest business account.',
    icon: 'pinterest',
  },
  {
    id: 'polar',
    name: 'Polar',
    category: 'marketing',
    tagline:
      'Sync OSS funding subscribers, MRR, and per-tier breakdown from Polar.',
    brandColor: '#0062FF',
  },
  {
    id: 'product-hunt',
    name: 'Product Hunt',
    category: 'marketing',
    tagline:
      'Sync upvote velocity, rank trajectory, and comments on Product Hunt launches.',
    icon: 'producthunt',
    requestIssue: 'RAW-454',
  },
  {
    id: 'reddit',
    name: 'Reddit',
    category: 'marketing',
    tagline:
      'Sync subreddit subscriber growth, post activity, and karma flow for tracked communities.',
    icon: 'reddit',
  },
  {
    id: 'sendinblue',
    name: 'Brevo (Sendinblue)',
    category: 'marketing',
    tagline:
      'Sync campaigns, sends, opens, clicks, and contact growth from Brevo.',
    icon: 'brevo',
  },
  {
    id: 'similarweb',
    name: 'SimilarWeb',
    category: 'marketing',
    tagline:
      'Sync competitor traffic estimates, engagement, and traffic-source mix from SimilarWeb.',
    brandColor: '#092540',
  },
  {
    id: 'spotify-for-podcasters',
    name: 'Spotify for Podcasters',
    category: 'marketing',
    tagline:
      'Sync plays, unique listeners, and follower growth across episodes from Spotify for Podcasters.',
    icon: 'spotify',
  },
  {
    id: 'sprout-social',
    name: 'Sprout Social',
    category: 'marketing',
    tagline:
      'Sync scheduled posts, per-channel engagement, and inbox volume from Sprout Social.',
    brandColor: '#75DD66',
  },
  {
    id: 'substack',
    name: 'Substack',
    category: 'marketing',
    tagline:
      'Sync subscribers, opens, paid conversions, and revenue from a Substack publication.',
    icon: 'substack',
  },
  {
    id: 'tidelift',
    name: 'Tidelift',
    category: 'marketing',
    tagline:
      'Sync subscriber counts and lifter income for OSS packages on Tidelift.',
    brandColor: '#F46524',
  },
  {
    id: 'tiktok-ads',
    name: 'TikTok Ads',
    category: 'marketing',
    tagline:
      'Sync campaign spend, impressions, clicks, and conversions from TikTok Ads.',
    icon: 'tiktok',
    requestIssue: 'RAW-231',
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    category: 'marketing',
    tagline:
      'Sync follower growth, post views, and engagement from a TikTok business account.',
    icon: 'tiktok',
  },
  {
    id: 'trustpilot',
    name: 'Trustpilot',
    category: 'marketing',
    tagline:
      'Sync overall rating, review count, and rating-category trends from Trustpilot.',
    icon: 'trustpilot',
  },
  {
    id: 'twitch',
    name: 'Twitch',
    category: 'marketing',
    tagline:
      'Sync followers, subscribers, peak viewers, and stream activity from a Twitch channel.',
    icon: 'twitch',
  },
  {
    id: 'twitter-x',
    name: 'Twitter / X',
    category: 'marketing',
    tagline:
      'Sync followers, post engagement, and mention volume from Twitter / X.',
    icon: 'x',
  },
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
    id: 'wistia',
    name: 'Wistia',
    category: 'marketing',
    tagline: 'Sync video plays, play rate, and engagement from Wistia.',
    icon: 'wistia',
  },
  {
    id: 'youtube',
    name: 'YouTube',
    category: 'marketing',
    tagline:
      'Sync channel subscribers, views, watch-time, and per-video performance from YouTube.',
    icon: 'youtube',
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
    id: 'cal-com',
    name: 'Cal.com',
    category: 'sales',
    tagline:
      'Sync bookings, no-shows, and per-event-type performance from Cal.com.',
    icon: 'caldotcom',
    requestIssue: 'RAW-438',
  },
  {
    id: 'calendly',
    name: 'Calendly',
    category: 'sales',
    tagline:
      'Sync bookings, no-shows, and per-event-type performance from Calendly.',
    icon: 'calendly',
    requestIssue: 'RAW-437',
  },
  {
    id: 'chorus',
    name: 'Chorus',
    category: 'sales',
    tagline: 'Sync calls and conversation activity from Chorus.',
    brandColor: '#19BC9C',
    requestIssue: 'RAW-239',
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
    id: 'outreach',
    name: 'Outreach',
    category: 'sales',
    tagline:
      'Sync sequences, prospects, and rep activity from an Outreach account.',
    brandColor: '#5951FF',
    requestIssue: 'RAW-236',
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
    id: 'shopify',
    name: 'Shopify',
    category: 'sales',
    tagline:
      'Sync orders, customers, and products plus revenue and order-volume metrics from a Shopify store.',
    icon: 'shopify',
    requestIssue: 'RAW-427',
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
    id: 'bigcommerce',
    name: 'BigCommerce',
    category: 'sales',
    tagline: 'Sync orders, customers, and revenue from a BigCommerce store.',
    icon: 'bigcommerce',
  },
  {
    id: 'lemon-squeezy',
    name: 'Lemon Squeezy',
    category: 'sales',
    tagline: 'Sync orders, MRR, and refunds from a Lemon Squeezy store.',
    brandColor: '#FFC233',
  },
  {
    id: 'paddle',
    name: 'Paddle',
    category: 'sales',
    tagline: 'Sync transactions, MRR, and refunds from Paddle.',
    icon: 'paddle',
  },
  {
    id: 'salesloft',
    name: 'Salesloft',
    category: 'sales',
    tagline: 'Sync cadences, prospects, and rep activity from Salesloft.',
    brandColor: '#003C7A',
  },
  {
    id: 'square',
    name: 'Square',
    category: 'sales',
    tagline: 'Sync orders, transactions, and revenue from a Square account.',
    icon: 'square',
  },
  {
    id: 'woocommerce',
    name: 'WooCommerce',
    category: 'sales',
    tagline: 'Sync orders, customers, and revenue from a WooCommerce store.',
    icon: 'woocommerce',
  },

  {
    id: 'adyen',
    name: 'Adyen',
    category: 'finance',
    tagline: 'Sync payments, refunds, and chargebacks from an Adyen account.',
    icon: 'adyen',
  },
  {
    id: 'airbase',
    name: 'Airbase',
    category: 'finance',
    tagline:
      'Sync card transactions, AP automation, and spend by category from Airbase.',
    brandColor: '#16395A',
  },
  {
    id: 'aws-bedrock',
    name: 'AWS Bedrock',
    category: 'engineering',
    tagline:
      'Sync model invocations, tokens, and spend across Bedrock-hosted models.',
    brandColor: '#FF9900',
    requestIssue: 'RAW-412',
  },
  {
    id: 'aws-ses',
    name: 'Amazon SES',
    category: 'engineering',
    tagline:
      'Sync send volume, delivery, bounce, and complaint rates from Amazon SES.',
    brandColor: '#FF9900',
    requestIssue: 'RAW-432',
  },
  {
    id: 'anthropic',
    name: 'Anthropic API',
    category: 'engineering',
    tagline:
      'Sync token usage, requests, and spend across Claude models from the Anthropic API.',
    brandColor: '#D97757',
    requestIssue: 'RAW-411',
  },
  {
    id: 'bamboohr',
    name: 'BambooHR',
    category: 'hr',
    tagline: 'Sync employees, tenure, time-off, and attrition from BambooHR.',
    brandColor: '#71B340',
    requestIssue: 'RAW-246',
  },
  {
    id: 'ashby',
    name: 'Ashby',
    category: 'hr',
    tagline: 'Sync candidates, applications, and offer activity from Ashby.',
    brandColor: '#101010',
    requestIssue: 'RAW-245',
  },
  {
    id: 'lever',
    name: 'Lever',
    category: 'hr',
    tagline:
      'Sync candidates, opportunities, and pipeline progression from Lever.',
    brandColor: '#1F1F1F',
    requestIssue: 'RAW-244',
  },
  {
    id: 'rippling',
    name: 'Rippling',
    category: 'hr',
    tagline: 'Sync employees, departments, and time-off across Rippling.',
    brandColor: '#1A1A1A',
    requestIssue: 'RAW-247',
  },
  {
    id: 'gusto',
    name: 'Gusto',
    category: 'hr',
    tagline: 'Sync employees, payroll runs, and pay-cycle spend from Gusto.',
    icon: 'gusto',
    requestIssue: 'RAW-248',
  },
  {
    id: 'workday',
    name: 'Workday',
    category: 'hr',
    tagline: 'Sync workers, headcount, and attrition from Workday.',
    brandColor: '#0875E1',
    requestIssue: 'RAW-249',
  },
  {
    id: 'lattice',
    name: 'Lattice',
    category: 'hr',
    tagline: 'Sync reviews, goals, and engagement-score trends from Lattice.',
    brandColor: '#5750FF',
    requestIssue: 'RAW-250',
  },
  {
    id: '15five',
    name: '15Five',
    category: 'hr',
    tagline: 'Sync check-ins, reviews, and completion rates from 15Five.',
    brandColor: '#FF6358',
    requestIssue: 'RAW-251',
  },
  {
    id: 'cultureamp',
    name: 'Culture Amp',
    category: 'hr',
    tagline:
      'Sync engagement scores, eNPS, and survey response rates from Culture Amp.',
    brandColor: '#000000',
    requestIssue: 'RAW-252',
  },
  {
    id: 'adp',
    name: 'ADP',
    category: 'hr',
    tagline:
      'Sync workers, payroll runs, and pay-cycle spend from ADP Workforce Now.',
    icon: 'adp',
    requestIssue: 'RAW-440',
  },
  {
    id: 'deel',
    name: 'Deel',
    category: 'hr',
    tagline:
      'Sync people, contracts, and payroll spend across countries from Deel.',
    brandColor: '#15D27C',
    requestIssue: 'RAW-439',
  },
  {
    id: 'paychex',
    name: 'Paychex',
    category: 'hr',
    tagline: 'Sync workers, payroll runs, and pay-cycle spend from Paychex.',
    brandColor: '#0072CE',
  },
  {
    id: 'paylocity',
    name: 'Paylocity',
    category: 'hr',
    tagline: 'Sync workers, payroll runs, and pay-cycle spend from Paylocity.',
    brandColor: '#1B5180',
  },
  {
    id: 'justworks',
    name: 'Justworks',
    category: 'hr',
    tagline: 'Sync employees, payroll, and benefits from Justworks.',
    brandColor: '#1A3F4C',
  },
  {
    id: 'trinet',
    name: 'TriNet',
    category: 'hr',
    tagline: 'Sync employees, payroll, and benefits from TriNet.',
    brandColor: '#D6232C',
  },
  {
    id: 'remote',
    name: 'Remote',
    category: 'hr',
    tagline:
      'Sync employees, contractors, and payroll spend across countries from Remote.',
    brandColor: '#625BF6',
  },
  {
    id: 'oyster',
    name: 'Oyster',
    category: 'hr',
    tagline:
      'Sync team members, contracts, and payroll spend across countries from Oyster.',
    brandColor: '#08243A',
  },
  {
    id: 'checkr',
    name: 'Checkr',
    category: 'hr',
    tagline:
      'Sync background-check reports, status, and turnaround from Checkr.',
    brandColor: '#322987',
  },
  {
    id: 'sterling',
    name: 'Sterling',
    category: 'hr',
    tagline:
      'Sync background-check reports, status, and turnaround from Sterling.',
    brandColor: '#003478',
  },
  {
    id: 'docebo',
    name: 'Docebo',
    category: 'hr',
    tagline:
      'Sync course enrollments, completions, and compliance training from Docebo.',
    brandColor: '#FFA200',
  },
  {
    id: 'linkedin-learning',
    name: 'LinkedIn Learning',
    category: 'hr',
    tagline:
      'Sync learner activity, course completions, and assignment progress from LinkedIn Learning.',
    brandColor: '#0A66C2',
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
    id: 'bill',
    name: 'Bill.com',
    category: 'finance',
    tagline: 'Sync bills pending, AP aging, and vendor spend from Bill.com.',
    brandColor: '#005DAA',
    requestIssue: 'RAW-434',
  },
  {
    id: 'baremetrics',
    name: 'Baremetrics',
    category: 'finance',
    tagline:
      'Sync MRR, churn, ARPU, LTV, and cohort retention from Baremetrics.',
    brandColor: '#0070FF',
  },
  {
    id: 'braintree',
    name: 'Braintree',
    category: 'finance',
    tagline: 'Sync payments, refunds, and disputes from Braintree.',
    brandColor: '#000000',
  },
  {
    id: 'causal',
    name: 'Causal',
    category: 'finance',
    tagline:
      'Sync model outputs, scenarios, and forecast vs actuals from a Causal model.',
    brandColor: '#0E4A8A',
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
    id: 'chartmogul',
    name: 'ChartMogul',
    category: 'finance',
    tagline: 'Sync MRR, churn, ARPU, and cohort retention from ChartMogul.',
    brandColor: '#FF3266',
  },
  {
    id: 'crypto-coingecko',
    name: 'CoinGecko',
    category: 'finance',
    tagline:
      'Sync prices and market caps for a watched set of cryptocurrencies from CoinGecko.',
    brandColor: '#8DC647',
  },
  {
    id: 'expensify',
    name: 'Expensify',
    category: 'finance',
    tagline:
      'Sync reports, expense submissions, and policy violations from Expensify.',
    icon: 'expensify',
    requestIssue: 'RAW-435',
  },
  {
    id: 'fixer',
    name: 'Fixer (FX rates)',
    category: 'finance',
    tagline:
      'Sync foreign-exchange rates from Fixer for multi-currency dashboards.',
    brandColor: '#1C1C1E',
  },
  {
    id: 'freshbooks',
    name: 'FreshBooks',
    category: 'finance',
    tagline: 'Sync invoices, expenses, and revenue from FreshBooks.',
    brandColor: '#1CBC9C',
  },
  {
    id: 'gocardless',
    name: 'GoCardless',
    category: 'finance',
    tagline: 'Sync mandates, payments, and failures from GoCardless.',
    brandColor: '#1AA5E1',
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
  {
    id: 'navan',
    name: 'Navan',
    category: 'finance',
    tagline:
      'Sync travel and expense spend by category and traveler from Navan.',
    brandColor: '#1A1A1A',
  },
  {
    id: 'netsuite',
    name: 'NetSuite',
    category: 'finance',
    tagline: 'Sync invoices, transactions, and P&L from a NetSuite tenant.',
    brandColor: '#00467F',
    requestIssue: 'RAW-219',
  },
  {
    id: 'paypal',
    name: 'PayPal',
    category: 'finance',
    tagline:
      'Sync transactions, refunds, and balance from a PayPal business account.',
    icon: 'paypal',
  },
  {
    id: 'plaid',
    name: 'Plaid',
    category: 'finance',
    tagline:
      'Sync linked accounts, balances, and categorized transactions across banks via Plaid.',
    brandColor: '#111111',
    requestIssue: 'RAW-436',
  },
  {
    id: 'pleo',
    name: 'Pleo',
    category: 'finance',
    tagline:
      'Sync card transactions, spend by category, and pocket money from Pleo.',
    brandColor: '#EB6FBD',
  },
  {
    id: 'profitwell',
    name: 'ProfitWell (Paddle Metrics)',
    category: 'finance',
    tagline: 'Sync MRR, churn, ARPU, and cohort retention from ProfitWell.',
    brandColor: '#21B287',
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
    id: 'ramp',
    name: 'Ramp',
    category: 'finance',
    tagline:
      'Sync card transactions, spend by category, and budget usage from a Ramp account.',
    brandColor: '#1A1A1A',
    requestIssue: 'RAW-221',
  },
  {
    id: 'recurly',
    name: 'Recurly',
    category: 'finance',
    tagline:
      'Sync subscriptions, invoices, and MRR/churn metrics from Recurly.',
    brandColor: '#F8423A',
    requestIssue: 'RAW-216',
  },
  {
    id: 'revenuecat',
    name: 'RevenueCat',
    category: 'finance',
    tagline:
      'Sync mobile MRR, churn, trial conversion, and active subscribers from RevenueCat.',
    brandColor: '#F44CA1',
    requestIssue: 'RAW-407',
  },
  {
    id: 'sage-intacct',
    name: 'Sage Intacct',
    category: 'finance',
    tagline: 'Sync invoices, expenses, and P&L from Sage Intacct.',
    icon: 'sage',
  },
  {
    id: 'soldo',
    name: 'Soldo',
    category: 'finance',
    tagline: 'Sync card transactions and spend by team from Soldo.',
    brandColor: '#FF5151',
  },
  {
    id: 'spendesk',
    name: 'Spendesk',
    category: 'finance',
    tagline:
      'Sync card transactions, requests, and per-team spend from Spendesk.',
    brandColor: '#1F1F4E',
  },
  {
    id: 'subscript',
    name: 'Subscript',
    category: 'finance',
    tagline: 'Sync MRR, churn, and revenue waterfall from Subscript.',
    brandColor: '#3F2DFF',
  },
  {
    id: 'tipalti',
    name: 'Tipalti',
    category: 'finance',
    tagline: 'Sync bills, payments, and supplier activity from Tipalti.',
    brandColor: '#161A2E',
  },
  {
    id: 'wave',
    name: 'Wave Accounting',
    category: 'finance',
    tagline: 'Sync invoices, expenses, and revenue from Wave.',
    brandColor: '#27488A',
  },
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
    id: 'zoho-books',
    name: 'Zoho Books',
    category: 'finance',
    tagline: 'Sync invoices, expenses, and revenue from Zoho Books.',
    icon: 'zoho',
  },
  {
    id: 'avalara',
    name: 'Avalara',
    category: 'finance',
    tagline:
      'Sync tax liability by jurisdiction and filing status from Avalara.',
    brandColor: '#FF5616',
  },
  {
    id: 'anrok',
    name: 'Anrok',
    category: 'finance',
    tagline:
      'Sync sales-tax liability and filing status for SaaS revenue from Anrok.',
    brandColor: '#000000',
  },
  {
    id: 'carta',
    name: 'Carta',
    category: 'finance',
    tagline:
      'Sync shareholders, option grants, and dilution across rounds from Carta.',
    brandColor: '#FE6027',
  },
  {
    id: 'pilot',
    name: 'Pilot',
    category: 'finance',
    tagline:
      'Sync monthly financial summaries and bookkeeping status from Pilot.',
    brandColor: '#2E62F3',
  },

  {
    id: 'mailgun',
    name: 'Mailgun',
    category: 'engineering',
    tagline:
      'Sync transactional email send volume, delivery, bounce, and complaint rates from Mailgun.',
    icon: 'mailgun',
    requestIssue: 'RAW-431',
  },
  {
    id: 'openai',
    name: 'OpenAI API',
    category: 'engineering',
    tagline:
      'Sync token usage, requests, and spend across OpenAI models and projects.',
    brandColor: '#10A37F',
    requestIssue: 'RAW-410',
  },
  {
    id: 'postmark',
    name: 'Postmark',
    category: 'engineering',
    tagline:
      'Sync transactional email send volume, delivery, bounce, and complaint rates from Postmark.',
    brandColor: '#FFCC00',
    requestIssue: 'RAW-430',
  },
  {
    id: 'langfuse',
    name: 'Langfuse',
    category: 'engineering',
    tagline:
      'Sync LLM traces, observation volume, per-model cost, and feedback scores from Langfuse.',
    brandColor: '#1F2937',
    requestIssue: 'RAW-414',
  },
  {
    id: 'langsmith',
    name: 'LangSmith',
    category: 'engineering',
    tagline:
      'Sync LangChain runs, latency, per-project cost, and feedback from LangSmith.',
    brandColor: '#1A1A1A',
    requestIssue: 'RAW-415',
  },
  {
    id: 'resend',
    name: 'Resend',
    category: 'engineering',
    tagline:
      'Sync transactional email send volume, delivery, bounce, and complaint rates from Resend.',
    icon: 'resend',
    requestIssue: 'RAW-433',
  },
  {
    id: 'sendgrid',
    name: 'SendGrid',
    category: 'engineering',
    tagline:
      'Sync transactional email send volume, delivery, bounce, and complaint rates from SendGrid.',
    brandColor: '#1A82E2',
    requestIssue: 'RAW-429',
  },
  {
    id: 'twilio',
    name: 'Twilio',
    category: 'engineering',
    tagline:
      'Sync SMS, voice, and verify usage with delivery and error rates from Twilio.',
    brandColor: '#F22F46',
    requestIssue: 'RAW-428',
  },
  {
    id: 'vertex-ai',
    name: 'Vertex AI',
    category: 'engineering',
    tagline:
      'Sync model invocations, tokens, and spend across Vertex AI - Gemini and third-party models.',
    icon: 'googlecloud',
    requestIssue: 'RAW-413',
  },

  {
    id: 'sonarqube',
    name: 'SonarQube',
    category: 'engineering',
    tagline:
      'Sync code quality issues, coverage, and per-project quality gates from a SonarQube server.',
    brandColor: '#4E9BCD',
  },
  {
    id: 'qodana',
    name: 'Qodana',
    category: 'engineering',
    tagline:
      'Sync code inspection results, coverage, and quality gates from JetBrains Qodana.',
    brandColor: '#FA1F8E',
  },
  {
    id: 'zephyr-scale',
    name: 'Zephyr Scale',
    category: 'engineering',
    tagline:
      'Sync test cases, executions, and pass/fail breakdowns from Zephyr Scale.',
    brandColor: '#00A4E4',
  },
  {
    id: 'qtest',
    name: 'qTest',
    category: 'engineering',
    tagline:
      'Sync test runs, defects, and execution coverage from Tricentis qTest.',
    brandColor: '#00B4A0',
  },
  {
    id: 'xray',
    name: 'Xray Test Management',
    category: 'engineering',
    tagline: 'Sync test runs, coverage, and defect linkage from Xray for Jira.',
    brandColor: '#5E0EBB',
  },
  {
    id: 'semaphoreci',
    name: 'Semaphore CI',
    category: 'engineering',
    tagline: 'Sync pipelines, builds, and per-job duration from Semaphore CI.',
    icon: 'semaphoreci',
  },
  {
    id: 'drone-ci',
    name: 'Drone CI',
    category: 'engineering',
    tagline: 'Sync pipelines, builds, and per-stage durations from Drone CI.',
    icon: 'drone',
  },
  {
    id: 'woodpecker-ci',
    name: 'Woodpecker CI',
    category: 'engineering',
    tagline: 'Sync pipelines, builds, and per-step results from Woodpecker CI.',
    brandColor: '#4CAF50',
  },
  {
    id: 'travis-ci',
    name: 'Travis CI',
    category: 'engineering',
    tagline: 'Sync builds, jobs, and pass/fail rates from Travis CI.',
    icon: 'travisci',
  },
  {
    id: 'teamcity',
    name: 'TeamCity',
    category: 'engineering',
    tagline:
      'Sync builds, agents, and per-configuration health from JetBrains TeamCity.',
    icon: 'teamcity',
  },
  {
    id: 'azure-pipelines',
    name: 'Azure Pipelines',
    category: 'engineering',
    tagline:
      'Sync pipelines, runs, and per-stage durations from Azure DevOps Pipelines.',
    brandColor: '#2560E0',
  },
  {
    id: 'browserstack',
    name: 'BrowserStack',
    category: 'engineering',
    tagline:
      'Sync automated test sessions, pass/fail rates, and parallel usage from BrowserStack.',
    brandColor: '#FF6C37',
  },
  {
    id: 'saucelabs',
    name: 'Sauce Labs',
    category: 'engineering',
    tagline:
      'Sync automated test sessions, pass/fail rates, and minute usage from Sauce Labs.',
    brandColor: '#E2231A',
  },
  {
    id: 'lambdatest',
    name: 'LambdaTest',
    category: 'engineering',
    tagline:
      'Sync automated and manual test sessions, pass/fail rates, and concurrency from LambdaTest.',
    brandColor: '#0EBAC5',
  },
  {
    id: 'percy',
    name: 'Percy',
    category: 'engineering',
    tagline:
      'Sync visual snapshots, review status, and diff counts from Percy.',
    brandColor: '#9E1D8E',
  },
  {
    id: 'applitools',
    name: 'Applitools',
    category: 'engineering',
    tagline:
      'Sync visual AI checkpoints, diffs, and test runs from Applitools.',
    brandColor: '#00A39B',
  },
  {
    id: 'chromatic',
    name: 'Chromatic',
    category: 'engineering',
    tagline:
      'Sync component snapshots, review status, and visual regressions from Chromatic.',
    brandColor: '#FC521F',
  },
  {
    id: 'checkmarx',
    name: 'Checkmarx',
    category: 'engineering',
    tagline:
      'Sync SAST findings, severity counts, and scan coverage from Checkmarx.',
    icon: 'checkmarx',
  },
  {
    id: 'veracode',
    name: 'Veracode',
    category: 'engineering',
    tagline:
      'Sync application scans, flaw distribution, and policy compliance from Veracode.',
    brandColor: '#003C5B',
  },
  {
    id: 'appdynamics',
    name: 'AppDynamics',
    category: 'engineering',
    tagline:
      'Sync application performance, business transactions, and error counts from AppDynamics.',
    brandColor: '#0070D2',
  },
  {
    id: 'raygun',
    name: 'Raygun',
    category: 'engineering',
    tagline:
      'Sync errors, occurrence counts, and real-user monitoring data from Raygun.',
    brandColor: '#E03426',
  },
  {
    id: 'instabug',
    name: 'Instabug',
    category: 'engineering',
    tagline:
      'Sync mobile crashes, bug reports, and session counts from Instabug.',
    brandColor: '#F4385E',
  },
  {
    id: 'logz-io',
    name: 'Logz.io',
    category: 'engineering',
    tagline: 'Sync log volumes, alerts, and per-source rates from Logz.io.',
    brandColor: '#0AB7E6',
  },
  {
    id: 'coralogix',
    name: 'Coralogix',
    category: 'engineering',
    tagline:
      'Sync log volumes, alerts, and per-application rates from Coralogix.',
    brandColor: '#7A37C8',
  },
  {
    id: 'loggly',
    name: 'Loggly',
    category: 'engineering',
    tagline:
      'Sync log volumes, error counts, and per-source rates from SolarWinds Loggly.',
    brandColor: '#F99D1C',
  },
  {
    id: 'papertrail',
    name: 'Papertrail',
    category: 'engineering',
    tagline:
      'Sync log volumes, alert counts, and per-system rates from Papertrail.',
    brandColor: '#5B5B5B',
  },
  {
    id: 'better-stack-logs',
    name: 'Better Stack Logs',
    category: 'engineering',
    tagline: 'Sync log volumes, queries, and alerts from Better Stack Logs.',
    icon: 'betterstack',
  },
  {
    id: 'lightstep',
    name: 'Lightstep',
    category: 'engineering',
    tagline:
      'Sync trace volume, service latency, and error rate from Lightstep.',
    brandColor: '#00B5AD',
  },
  {
    id: 'aspecto',
    name: 'Aspecto',
    category: 'engineering',
    tagline: 'Sync OpenTelemetry traces, latency, and error rate from Aspecto.',
    brandColor: '#1A1A2E',
  },
  {
    id: 'helios',
    name: 'Helios',
    category: 'engineering',
    tagline:
      'Sync distributed traces, errors, and request latency from Helios.',
    brandColor: '#FF6B35',
  },
  {
    id: 'pingdom',
    name: 'Pingdom',
    category: 'engineering',
    tagline:
      'Sync uptime, response time, and page-load performance from Pingdom.',
    icon: 'pingdom',
  },
  {
    id: 'uptimerobot',
    name: 'UptimeRobot',
    category: 'engineering',
    tagline:
      'Sync monitor uptime, response time, and incident counts from UptimeRobot.',
    brandColor: '#52B956',
  },
  {
    id: 'statuscake',
    name: 'StatusCake',
    category: 'engineering',
    tagline:
      'Sync monitor uptime, response time, and downtime events from StatusCake.',
    brandColor: '#FFCC00',
  },
  {
    id: 'checkly',
    name: 'Checkly',
    category: 'engineering',
    tagline:
      'Sync synthetic check results, uptime, and API performance from Checkly.',
    brandColor: '#0075FF',
  },
  {
    id: 'site24x7',
    name: 'Site24x7',
    category: 'engineering',
    tagline:
      'Sync monitor uptime, response time, and infrastructure health from Site24x7.',
    brandColor: '#F89D2E',
  },
  {
    id: 'sematext',
    name: 'Sematext',
    category: 'engineering',
    tagline: 'Sync logs, metrics, and synthetic monitor results from Sematext.',
    brandColor: '#FF6E42',
  },
  {
    id: 'freshping',
    name: 'Freshping',
    category: 'engineering',
    tagline:
      'Sync monitor uptime, response time, and incidents from Freshping.',
    brandColor: '#26A69A',
  },
  {
    id: 'better-stack-uptime',
    name: 'Better Stack Uptime',
    category: 'engineering',
    tagline:
      'Sync monitor uptime, incidents, and on-call activity from Better Stack Uptime.',
    icon: 'betterstack',
  },
  {
    id: 'status-io',
    name: 'Status.io',
    category: 'engineering',
    tagline:
      'Sync incidents, component status, and uptime from a Status.io page.',
    brandColor: '#4A90E2',
  },
  {
    id: 'hund',
    name: 'Hund',
    category: 'engineering',
    tagline:
      'Sync incidents, component status, and uptime from a Hund status page.',
    brandColor: '#1E3A5F',
  },
  {
    id: 'healthchecks-io',
    name: 'Healthchecks.io',
    category: 'engineering',
    tagline:
      'Sync cron-job health, missed pings, and per-check status from Healthchecks.io.',
    brandColor: '#5BAF6E',
  },
  {
    id: 'cronitor',
    name: 'Cronitor',
    category: 'engineering',
    tagline:
      'Sync cron-job health, missed runs, and incident counts from Cronitor.',
    brandColor: '#FFB81C',
  },
  {
    id: 'npm-trends',
    name: 'npm trends',
    category: 'engineering',
    tagline:
      'Sync comparative weekly download trends across npm packages from npm trends.',
    brandColor: '#CB3837',
  },

  {
    id: 'linode',
    name: 'Linode',
    category: 'infrastructure',
    tagline:
      'Sync instances, volumes, and monthly spend from a Linode (Akamai) account.',
    brandColor: '#00A95C',
  },
  {
    id: 'hetzner',
    name: 'Hetzner Cloud',
    category: 'infrastructure',
    tagline:
      'Sync servers, volumes, and monthly spend from a Hetzner Cloud account.',
    icon: 'hetzner',
  },
  {
    id: 'vultr',
    name: 'Vultr',
    category: 'infrastructure',
    tagline:
      'Sync instances, block storage, and monthly spend from a Vultr account.',
    icon: 'vultr',
  },
  {
    id: 'scaleway',
    name: 'Scaleway',
    category: 'infrastructure',
    tagline:
      'Sync instances, object storage, and monthly spend from a Scaleway account.',
    icon: 'scaleway',
  },
  {
    id: 'ovhcloud',
    name: 'OVHcloud',
    category: 'infrastructure',
    tagline:
      'Sync instances, storage, and monthly spend from an OVHcloud account.',
    icon: 'ovh',
  },
  {
    id: 'aiven',
    name: 'Aiven',
    category: 'infrastructure',
    tagline:
      'Sync managed-database services, plans, and monthly spend from Aiven.',
    brandColor: '#FF6900',
  },
  {
    id: 'elastic-cloud',
    name: 'Elastic Cloud',
    category: 'infrastructure',
    tagline:
      'Sync deployments, indices, and ingest rates from an Elastic Cloud account.',
    icon: 'elasticcloud',
  },
  {
    id: 'aws-dynamodb',
    name: 'Amazon DynamoDB',
    category: 'infrastructure',
    tagline:
      'Sync table read/write capacity, throttles, and storage from Amazon DynamoDB.',
    brandColor: '#4053D6',
  },
  {
    id: 'cassandra',
    name: 'Apache Cassandra',
    category: 'infrastructure',
    tagline:
      'Sync cluster nodes, read/write throughput, and latency from an Apache Cassandra cluster.',
    icon: 'apachecassandra',
  },
  {
    id: 'couchbase',
    name: 'Couchbase',
    category: 'infrastructure',
    tagline:
      'Sync buckets, document counts, and operations-per-second from Couchbase.',
    icon: 'couchbase',
  },
  {
    id: 'fauna',
    name: 'Fauna',
    category: 'infrastructure',
    tagline:
      'Sync database read/write ops, storage, and per-collection counts from Fauna.',
    icon: 'fauna',
  },
  {
    id: 'xata',
    name: 'Xata',
    category: 'infrastructure',
    tagline: 'Sync databases, branches, and per-table row counts from Xata.',
    brandColor: '#9F87FF',
  },
  {
    id: 'motherduck',
    name: 'MotherDuck',
    category: 'infrastructure',
    tagline:
      'Sync databases, query usage, and storage from a MotherDuck workspace.',
    brandColor: '#FFD23F',
  },
  {
    id: 'firebolt',
    name: 'Firebolt',
    category: 'analytics',
    tagline:
      'Run scheduled SQL against Firebolt and sync the result rows as a metric or entity series.',
    brandColor: '#FE3464',
  },
  {
    id: 'typesense',
    name: 'Typesense',
    category: 'infrastructure',
    tagline:
      'Sync collection sizes, query counts, and latency from a Typesense cluster.',
    brandColor: '#DA4167',
  },
  {
    id: 'meilisearch',
    name: 'Meilisearch',
    category: 'infrastructure',
    tagline:
      'Sync index sizes, search query counts, and latency from Meilisearch.',
    icon: 'meilisearch',
  },
  {
    id: 'redpanda',
    name: 'Redpanda',
    category: 'infrastructure',
    tagline:
      'Sync topic message rates, consumer lag, and cluster throughput from Redpanda.',
    brandColor: '#E8485B',
  },
  {
    id: 'aws-msk',
    name: 'Amazon MSK',
    category: 'infrastructure',
    tagline:
      'Sync Kafka topic throughput, consumer lag, and broker health from Amazon MSK.',
    brandColor: '#FF9900',
  },
  {
    id: 'materialize',
    name: 'Materialize',
    category: 'infrastructure',
    tagline:
      'Sync materialized view freshness, source lag, and per-cluster throughput from Materialize.',
    brandColor: '#7F4EFF',
  },
  {
    id: 'risingwave',
    name: 'RisingWave',
    category: 'infrastructure',
    tagline: 'Sync streaming jobs, source lag, and throughput from RisingWave.',
    brandColor: '#005EFF',
  },
  {
    id: 'decodable',
    name: 'Decodable',
    category: 'infrastructure',
    tagline:
      'Sync stream pipelines, throughput, and connector status from Decodable.',
    brandColor: '#FF5C39',
  },
  {
    id: 'akamai',
    name: 'Akamai',
    category: 'infrastructure',
    tagline:
      'Sync requests, cache-hit ratio, and origin performance from Akamai.',
    icon: 'akamai',
  },
  {
    id: 'bunnycdn',
    name: 'BunnyCDN',
    category: 'infrastructure',
    tagline:
      'Sync requests, bandwidth, and cache-hit ratio across zones from BunnyCDN.',
    brandColor: '#FF8D00',
  },
  {
    id: 'keycdn',
    name: 'KeyCDN',
    category: 'infrastructure',
    tagline:
      'Sync requests, bandwidth, and cache-hit ratio across zones from KeyCDN.',
    icon: 'keycdn',
  },
  {
    id: 'aws-route53',
    name: 'Amazon Route 53',
    category: 'infrastructure',
    tagline:
      'Sync hosted zones, query volume, and health-check status from Amazon Route 53.',
    brandColor: '#8C4FFF',
  },
  {
    id: 'ns1',
    name: 'NS1',
    category: 'infrastructure',
    tagline: 'Sync zones, query volume, and health-check status from NS1.',
    brandColor: '#1B1F3B',
  },
  {
    id: 'dnsimple',
    name: 'DNSimple',
    category: 'infrastructure',
    tagline: 'Sync domains, query volume, and renewal status from DNSimple.',
    brandColor: '#1A8FE3',
  },
  {
    id: 'cloudinary',
    name: 'Cloudinary',
    category: 'infrastructure',
    tagline:
      'Sync transformations, bandwidth, and storage from a Cloudinary account.',
    icon: 'cloudinary',
  },
  {
    id: 'imgix',
    name: 'imgix',
    category: 'infrastructure',
    tagline:
      'Sync transformations, bandwidth, and origin reads from an imgix source.',
    brandColor: '#000000',
  },

  {
    id: 'lokalise',
    name: 'Lokalise',
    category: 'engineering',
    tagline:
      'Sync translation progress, untranslated key counts, and reviewer activity from Lokalise.',
    brandColor: '#2B53FF',
  },
  {
    id: 'phrase',
    name: 'Phrase',
    category: 'engineering',
    tagline:
      'Sync translation progress, untranslated key counts, and contributor activity from Phrase.',
    brandColor: '#2EAFB7',
  },
  {
    id: 'crowdin',
    name: 'Crowdin',
    category: 'engineering',
    tagline:
      'Sync translation progress, untranslated string counts, and contributor activity from Crowdin.',
    icon: 'crowdin',
  },
  {
    id: 'smartling',
    name: 'Smartling',
    category: 'engineering',
    tagline:
      'Sync translation progress, jobs, and cost-per-word from Smartling.',
    brandColor: '#1C8DC7',
  },
  {
    id: 'transifex',
    name: 'Transifex',
    category: 'engineering',
    tagline:
      'Sync translation progress, untranslated string counts, and reviewer activity from Transifex.',
    icon: 'transifex',
  },

  {
    id: 'hashicorp-vault',
    name: 'HashiCorp Vault',
    category: 'security',
    tagline:
      'Sync secret counts, lease activity, and policy usage from HashiCorp Vault.',
    brandColor: '#000000',
  },
  {
    id: 'doppler',
    name: 'Doppler',
    category: 'security',
    tagline:
      'Sync project, environment, and secret counts plus rotation activity from Doppler.',
    brandColor: '#3391FF',
  },
  {
    id: 'infisical',
    name: 'Infisical',
    category: 'security',
    tagline:
      'Sync project, environment, and secret counts plus rotation activity from Infisical.',
    brandColor: '#EBF852',
  },
  {
    id: 'bitwarden',
    name: 'Bitwarden',
    category: 'security',
    tagline:
      'Sync vault item counts, organization seats, and watchtower findings from Bitwarden.',
    icon: 'bitwarden',
  },
  {
    id: 'lastpass',
    name: 'LastPass',
    category: 'security',
    tagline: 'Sync vault item counts, seats, and security score from LastPass.',
    icon: 'lastpass',
  },
  {
    id: 'dashlane',
    name: 'Dashlane',
    category: 'security',
    tagline:
      'Sync vault item counts, seats, and password health from Dashlane.',
    icon: 'dashlane',
  },
  {
    id: 'keeper',
    name: 'Keeper Security',
    category: 'security',
    tagline:
      'Sync vault item counts, seats, and security audit findings from Keeper.',
    icon: 'keeper',
  },
  {
    id: 'hyperproof',
    name: 'Hyperproof',
    category: 'security',
    tagline:
      'Sync control status, evidence freshness, and audit readiness from Hyperproof.',
    brandColor: '#0061A0',
  },
  {
    id: 'zengrc',
    name: 'ZenGRC',
    category: 'security',
    tagline:
      'Sync control status, audit readiness, and evidence coverage from ZenGRC.',
    brandColor: '#5CC8C2',
  },
  {
    id: 'onetrust',
    name: 'OneTrust',
    category: 'security',
    tagline: 'Sync DSARs, consent status, and risk findings from OneTrust.',
    brandColor: '#41C0CB',
  },
  {
    id: 'cookiebot',
    name: 'Cookiebot',
    category: 'security',
    tagline:
      'Sync consent rates, banner views, and scan findings from Cookiebot.',
    brandColor: '#62D58C',
  },
  {
    id: 'iubenda',
    name: 'Iubenda',
    category: 'security',
    tagline:
      'Sync consent rates, policy views, and compliance status from Iubenda.',
    brandColor: '#1CC691',
  },
  {
    id: 'didomi',
    name: 'Didomi',
    category: 'security',
    tagline:
      'Sync consent rates, notice views, and compliance signals from Didomi.',
    brandColor: '#1F2A37',
  },
  {
    id: 'termly',
    name: 'Termly',
    category: 'security',
    tagline: 'Sync consent rates and policy view counts from Termly.',
    brandColor: '#3B5BDB',
  },
  {
    id: 'osano',
    name: 'Osano',
    category: 'security',
    tagline: 'Sync consent rates, DSARs, and vendor risk scores from Osano.',
    icon: 'osano',
  },
  {
    id: 'nightfall',
    name: 'Nightfall',
    category: 'security',
    tagline:
      'Sync DLP findings, sensitive-data detections, and policy violations from Nightfall.',
    brandColor: '#9F4DFF',
  },
  {
    id: 'cyberhaven',
    name: 'Cyberhaven',
    category: 'security',
    tagline:
      'Sync data flow events, insider risk signals, and policy violations from Cyberhaven.',
    brandColor: '#3D2BFF',
  },
  {
    id: 'hackerone',
    name: 'HackerOne',
    category: 'security',
    tagline:
      'Sync reports, severity distribution, bounty spend, and resolution times from HackerOne.',
    icon: 'hackerone',
  },
  {
    id: 'bugcrowd',
    name: 'Bugcrowd',
    category: 'security',
    tagline:
      'Sync submissions, severity distribution, bounty spend, and resolution times from Bugcrowd.',
    icon: 'bugcrowd',
  },
  {
    id: 'intigriti',
    name: 'Intigriti',
    category: 'security',
    tagline:
      'Sync submissions, severity distribution, and bounty spend from Intigriti.',
    icon: 'intigriti',
  },
  {
    id: 'cobalt',
    name: 'Cobalt',
    category: 'security',
    tagline: 'Sync pentests, findings, and remediation progress from Cobalt.',
    icon: 'cobalt',
  },
  {
    id: 'fossa',
    name: 'FOSSA',
    category: 'security',
    tagline:
      'Sync open-source dependency issues, license violations, and SBOM coverage from FOSSA.',
    icon: 'fossa',
  },
  {
    id: 'mend',
    name: 'Mend',
    category: 'security',
    tagline:
      'Sync open-source dependency vulnerabilities, license issues, and remediation from Mend.',
    brandColor: '#7C3AED',
  },
  {
    id: 'blackduck',
    name: 'Black Duck',
    category: 'security',
    tagline:
      'Sync open-source components, vulnerabilities, and license findings from Black Duck.',
    brandColor: '#000000',
  },
  {
    id: 'jupiterone',
    name: 'JupiterOne',
    category: 'security',
    tagline:
      'Sync asset counts, policy compliance, and security findings from JupiterOne.',
    brandColor: '#1A2533',
  },
  {
    id: 'panther',
    name: 'Panther',
    category: 'security',
    tagline: 'Sync detections, alerts, and rule activity from Panther.',
    brandColor: '#7C3AED',
  },

  {
    id: 'stytch',
    name: 'Stytch',
    category: 'security',
    tagline: 'Sync users, sign-ups, and authentication activity from Stytch.',
    brandColor: '#0577F2',
  },
  {
    id: 'frontegg',
    name: 'Frontegg',
    category: 'security',
    tagline: 'Sync tenants, users, and sign-in activity from Frontegg.',
    brandColor: '#9747FF',
  },
  {
    id: 'supertokens',
    name: 'SuperTokens',
    category: 'security',
    tagline: 'Sync users, sessions, and sign-in activity from SuperTokens.',
    brandColor: '#FF9933',
  },
  {
    id: 'onelogin',
    name: 'OneLogin',
    category: 'security',
    tagline:
      'Sync users, sign-ins, and MFA enrollment from a OneLogin account.',
    brandColor: '#1C1F2B',
  },
  {
    id: 'jumpcloud',
    name: 'JumpCloud',
    category: 'security',
    tagline: 'Sync users, devices, and SSO sign-in activity from JumpCloud.',
    brandColor: '#16ABDE',
  },
  {
    id: 'descope',
    name: 'Descope',
    category: 'security',
    tagline: 'Sync users, sign-ups, and authentication activity from Descope.',
    brandColor: '#3F8CFF',
  },
  {
    id: 'firebase-auth',
    name: 'Firebase Auth',
    category: 'security',
    tagline:
      'Sync user counts, sign-ups, and provider-mix from Firebase Authentication.',
    icon: 'firebase',
  },
  {
    id: 'aws-cognito',
    name: 'Amazon Cognito',
    category: 'security',
    tagline:
      'Sync user pools, sign-ups, MFA adoption, and sign-in activity from Amazon Cognito.',
    brandColor: '#DD344C',
  },
  {
    id: 'keycloak',
    name: 'Keycloak',
    category: 'security',
    tagline: 'Sync realms, users, and sign-in activity from a Keycloak server.',
    icon: 'keycloak',
  },
  {
    id: 'ory',
    name: 'Ory',
    category: 'security',
    tagline:
      'Sync identities, sessions, and sign-in activity from an Ory project.',
    icon: 'ory',
  },
  {
    id: 'fusionauth',
    name: 'FusionAuth',
    category: 'security',
    tagline:
      'Sync users, sign-ups, and authentication activity from FusionAuth.',
    icon: 'fusionauth',
  },

  {
    id: 'persona',
    name: 'Persona',
    category: 'security',
    tagline:
      'Sync identity verifications, pass rate, and case throughput from Persona.',
    brandColor: '#1E3DB1',
  },
  {
    id: 'onfido',
    name: 'Onfido',
    category: 'security',
    tagline:
      'Sync identity verifications, pass rate, and turnaround time from Onfido.',
    brandColor: '#3640F0',
  },
  {
    id: 'alloy',
    name: 'Alloy',
    category: 'security',
    tagline:
      'Sync onboarding decisions, KYC checks, and case review from Alloy.',
    brandColor: '#0A2540',
  },
  {
    id: 'trulioo',
    name: 'Trulioo',
    category: 'security',
    tagline:
      'Sync identity verifications, match rates, and per-country coverage from Trulioo.',
    brandColor: '#0061A8',
  },
  {
    id: 'jumio',
    name: 'Jumio',
    category: 'security',
    tagline:
      'Sync identity verifications, pass rate, and per-document-type breakdown from Jumio.',
    brandColor: '#1E2A4D',
  },
  {
    id: 'veriff',
    name: 'Veriff',
    category: 'security',
    tagline:
      'Sync identity verifications, pass rate, and turnaround time from Veriff.',
    brandColor: '#FFCD00',
  },
  {
    id: 'sumsub',
    name: 'Sumsub',
    category: 'security',
    tagline:
      'Sync identity verifications, KYC checks, and case throughput from Sumsub.',
    brandColor: '#0075FF',
  },
  {
    id: 'middesk',
    name: 'Middesk',
    category: 'security',
    tagline:
      'Sync business verifications, KYB checks, and pass rate from Middesk.',
    brandColor: '#101820',
  },

  {
    id: 'paycom',
    name: 'Paycom',
    category: 'hr',
    tagline: 'Sync employees, payroll runs, and pay-cycle spend from Paycom.',
    brandColor: '#1A6DB5',
  },
  {
    id: 'ukg',
    name: 'UKG',
    category: 'hr',
    tagline: 'Sync employees, time-and-attendance, and payroll spend from UKG.',
    brandColor: '#005EB8',
  },
  {
    id: 'paycor',
    name: 'Paycor',
    category: 'hr',
    tagline: 'Sync employees, payroll runs, and pay-cycle spend from Paycor.',
    brandColor: '#F25C19',
  },
  {
    id: 'namely',
    name: 'Namely',
    category: 'hr',
    tagline: 'Sync employees, payroll, and time-off from Namely.',
    brandColor: '#FF6543',
  },
  {
    id: 'multiplier',
    name: 'Multiplier',
    category: 'hr',
    tagline:
      'Sync employees, contractors, and payroll spend across countries from Multiplier.',
    brandColor: '#3F2DFF',
  },
  {
    id: 'papaya-global',
    name: 'Papaya Global',
    category: 'hr',
    tagline:
      'Sync employees, contractors, and global payroll spend from Papaya Global.',
    brandColor: '#0061FF',
  },
  {
    id: 'globalization-partners',
    name: 'G-P (Globalization Partners)',
    category: 'hr',
    tagline:
      'Sync EOR employees, contracts, and payroll spend across countries from G-P.',
    brandColor: '#001E62',
  },
  {
    id: 'plane-hr',
    name: 'Plane',
    category: 'hr',
    tagline:
      'Sync employees, contractors, and global payroll spend from Plane.',
    brandColor: '#0035FF',
  },
  {
    id: 'hibob',
    name: 'HiBob',
    category: 'hr',
    tagline:
      'Sync employees, tenure, time-off, and engagement signals from HiBob.',
    icon: 'hibob',
  },
  {
    id: 'sapling',
    name: 'Sapling',
    category: 'hr',
    tagline:
      'Sync employees, onboarding completion, and time-off from Sapling.',
    brandColor: '#1A7AFF',
  },
  {
    id: 'humaans',
    name: 'Humaans',
    category: 'hr',
    tagline: 'Sync employees, time-off, and compensation events from Humaans.',
    brandColor: '#0F172A',
  },
  {
    id: 'workable',
    name: 'Workable',
    category: 'hr',
    tagline:
      'Sync candidates, applications, and pipeline progression from Workable.',
    brandColor: '#1A2734',
  },
  {
    id: 'jobvite',
    name: 'Jobvite',
    category: 'hr',
    tagline: 'Sync candidates, applications, and offer activity from Jobvite.',
    brandColor: '#FF6F4D',
  },
  {
    id: 'smartrecruiters',
    name: 'SmartRecruiters',
    category: 'hr',
    tagline:
      'Sync candidates, applications, and pipeline progression from SmartRecruiters.',
    brandColor: '#00BCD4',
  },
  {
    id: 'teamtailor',
    name: 'Teamtailor',
    category: 'hr',
    tagline:
      'Sync candidates, applications, and pipeline progression from Teamtailor.',
    brandColor: '#2EAF7D',
  },
  {
    id: 'breezyhr',
    name: 'Breezy HR',
    category: 'hr',
    tagline:
      'Sync candidates, applications, and pipeline progression from Breezy HR.',
    brandColor: '#1FAD8F',
  },
  {
    id: '360learning',
    name: '360Learning',
    category: 'hr',
    tagline:
      'Sync course enrollments, completions, and reactions from 360Learning.',
    brandColor: '#1A1A1A',
  },
  {
    id: 'docebo-learn',
    name: 'Docebo Learn',
    category: 'hr',
    tagline:
      'Sync course catalog, completions, and certification status from Docebo Learn.',
    brandColor: '#FFA200',
  },
  {
    id: 'coursera-business',
    name: 'Coursera for Business',
    category: 'hr',
    tagline:
      'Sync learner activity, course completions, and skill progress from Coursera for Business.',
    icon: 'coursera',
  },
  {
    id: 'udemy-business',
    name: 'Udemy Business',
    category: 'hr',
    tagline:
      'Sync learner activity, course completions, and minutes consumed from Udemy Business.',
    icon: 'udemy',
  },
  {
    id: 'cornerstone-ondemand',
    name: 'Cornerstone OnDemand',
    category: 'hr',
    tagline:
      'Sync learner activity, course completions, and certification status from Cornerstone OnDemand.',
    brandColor: '#E81A2B',
  },

  {
    id: 'freeagent',
    name: 'FreeAgent',
    category: 'finance',
    tagline:
      'Sync invoices, expenses, and profit-and-loss figures from FreeAgent.',
    brandColor: '#5DB948',
  },
  {
    id: 'manager-accounting',
    name: 'Manager',
    category: 'finance',
    tagline:
      'Sync invoices, expenses, and profit-and-loss figures from Manager.',
    brandColor: '#1A1A1A',
  },
  {
    id: 'tesorio',
    name: 'Tesorio',
    category: 'finance',
    tagline: 'Sync AR aging, collections forecast, and DSO from Tesorio.',
    brandColor: '#1E40AF',
  },
  {
    id: 'highradius',
    name: 'HighRadius',
    category: 'finance',
    tagline: 'Sync AR aging, collections, and disputes from HighRadius.',
    brandColor: '#0072CE',
  },
  {
    id: 'upflow',
    name: 'Upflow',
    category: 'finance',
    tagline: 'Sync AR aging, collections cadence, and DSO from Upflow.',
    brandColor: '#5B4DEE',
  },
  {
    id: 'taxjar',
    name: 'TaxJar',
    category: 'finance',
    tagline:
      'Sync sales-tax liability by jurisdiction and filing status from TaxJar.',
    brandColor: '#0072CE',
  },
  {
    id: 'quaderno',
    name: 'Quaderno',
    category: 'finance',
    tagline:
      'Sync tax-compliant invoices, taxes collected, and filings from Quaderno.',
    brandColor: '#5469D4',
  },
  {
    id: 'mosaic',
    name: 'Mosaic',
    category: 'finance',
    tagline: 'Sync forecasts, plan-vs-actuals, and metric trends from Mosaic.',
    brandColor: '#1A1A2E',
  },
  {
    id: 'cube-software',
    name: 'Cube',
    category: 'finance',
    tagline: 'Sync forecasts, plan-vs-actuals, and budget variance from Cube.',
    brandColor: '#9333EA',
  },
  {
    id: 'pigment',
    name: 'Pigment',
    category: 'finance',
    tagline:
      'Sync planning model outputs, forecasts, and scenarios from Pigment.',
    brandColor: '#E94E1B',
  },
  {
    id: 'vena',
    name: 'Vena',
    category: 'finance',
    tagline: 'Sync budget vs actuals, forecasts, and scenarios from Vena.',
    brandColor: '#0072CE',
  },
  {
    id: 'anaplan',
    name: 'Anaplan',
    category: 'finance',
    tagline:
      'Sync planning model outputs, forecasts, and scenarios from Anaplan.',
    brandColor: '#1A1A1A',
  },
  {
    id: 'kyriba',
    name: 'Kyriba',
    category: 'finance',
    tagline:
      'Sync cash balances, payments, and liquidity forecasts from Kyriba.',
    brandColor: '#0E4ECF',
  },
  {
    id: 'modern-treasury',
    name: 'Modern Treasury',
    category: 'finance',
    tagline:
      'Sync payments, account balances, and reconciliation status from Modern Treasury.',
    brandColor: '#1A1A1A',
  },
  {
    id: 'finch',
    name: 'Finch',
    category: 'finance',
    tagline:
      'Sync employees, payroll, and benefits data across providers via Finch.',
    brandColor: '#0F172A',
  },
  {
    id: 'routable',
    name: 'Routable',
    category: 'finance',
    tagline: 'Sync bills, payouts, and AP automation activity from Routable.',
    brandColor: '#3B82F6',
  },
  {
    id: 'melio',
    name: 'Melio',
    category: 'finance',
    tagline: 'Sync bills, payments, and AP activity from Melio.',
    brandColor: '#3F2DFF',
  },
  {
    id: 'jeeves',
    name: 'Jeeves',
    category: 'finance',
    tagline:
      'Sync card transactions, spend by category, and FX activity from Jeeves.',
    brandColor: '#06CFB7',
  },
  {
    id: 'airwallex',
    name: 'Airwallex',
    category: 'finance',
    tagline:
      'Sync multi-currency balances, payments, and FX activity from Airwallex.',
    brandColor: '#612FFF',
  },
  {
    id: 'wise-business',
    name: 'Wise Business',
    category: 'finance',
    tagline:
      'Sync multi-currency balances, transfers, and FX activity from Wise Business.',
    icon: 'wise',
  },
  {
    id: 'pipe',
    name: 'Pipe',
    category: 'finance',
    tagline:
      'Sync trading capacity, advances, and repayment schedule from Pipe.',
    brandColor: '#11FF8E',
  },
  {
    id: 'capchase',
    name: 'Capchase',
    category: 'finance',
    tagline: 'Sync advances, repayments, and runway from Capchase.',
    brandColor: '#1F1F1F',
  },
  {
    id: 'zip',
    name: 'Zip',
    category: 'finance',
    tagline:
      'Sync intake requests, vendor approvals, and procurement cycle time from Zip.',
    brandColor: '#101010',
  },
  {
    id: 'sastrify',
    name: 'Sastrify',
    category: 'finance',
    tagline: 'Sync SaaS spend, contract renewals, and savings from Sastrify.',
    brandColor: '#5333FF',
  },
  {
    id: 'vendr',
    name: 'Vendr',
    category: 'finance',
    tagline: 'Sync SaaS spend, contract renewals, and savings from Vendr.',
    brandColor: '#101820',
  },
  {
    id: 'tropic',
    name: 'Tropic',
    category: 'finance',
    tagline:
      'Sync SaaS spend, contract renewals, and negotiated savings from Tropic.',
    brandColor: '#1A7F37',
  },
  {
    id: 'productiv',
    name: 'Productiv',
    category: 'finance',
    tagline: 'Sync SaaS spend, app usage, and renewal risk from Productiv.',
    brandColor: '#005EFF',
  },
  {
    id: 'torii',
    name: 'Torii',
    category: 'finance',
    tagline: 'Sync SaaS app inventory, spend, and usage from Torii.',
    brandColor: '#3F2DFF',
  },

  {
    id: 'linkedin-sales-navigator',
    name: 'LinkedIn Sales Navigator',
    category: 'sales',
    tagline:
      'Sync saved searches, lead activity, and InMail engagement from LinkedIn Sales Navigator.',
    brandColor: '#0A66C2',
  },
  {
    id: 'lusha',
    name: 'Lusha',
    category: 'sales',
    tagline:
      'Sync enrichment lookups, reveal activity, and credit usage from Lusha.',
    brandColor: '#1F5BFF',
  },
  {
    id: 'cognism',
    name: 'Cognism',
    category: 'sales',
    tagline:
      'Sync enrichment lookups, reveal activity, and credit usage from Cognism.',
    brandColor: '#0E1E40',
  },
  {
    id: 'seamless-ai',
    name: 'Seamless.AI',
    category: 'sales',
    tagline:
      'Sync enrichment lookups, contact discovery, and credit usage from Seamless.AI.',
    brandColor: '#0EB8A6',
  },
  {
    id: 'rocketreach',
    name: 'RocketReach',
    category: 'sales',
    tagline:
      'Sync enrichment lookups, contact discovery, and credit usage from RocketReach.',
    brandColor: '#FF4F00',
  },
  {
    id: 'hunter-io',
    name: 'Hunter',
    category: 'sales',
    tagline:
      'Sync email finder lookups, verifications, and credit usage from Hunter.',
    brandColor: '#FF6D3F',
  },
  {
    id: 'fullcontact',
    name: 'FullContact',
    category: 'sales',
    tagline:
      'Sync enrichment lookups, identity resolution, and credit usage from FullContact.',
    brandColor: '#FF6F00',
  },
  {
    id: 'people-data-labs',
    name: 'People Data Labs',
    category: 'sales',
    tagline:
      'Sync enrichment lookups, person and company records, and credit usage from People Data Labs.',
    brandColor: '#5E5BFF',
  },
  {
    id: 'demandbase',
    name: 'Demandbase',
    category: 'sales',
    tagline:
      'Sync target accounts, engagement, and intent signals from Demandbase.',
    brandColor: '#001E5E',
  },
  {
    id: '6sense',
    name: '6sense',
    category: 'sales',
    tagline:
      'Sync target accounts, buying-stage, and intent signals from 6sense.',
    brandColor: '#1A1A1A',
  },
  {
    id: 'bombora',
    name: 'Bombora',
    category: 'sales',
    tagline: 'Sync surging accounts and topic intent signals from Bombora.',
    brandColor: '#FFA632',
  },
  {
    id: 'rollworks',
    name: 'RollWorks',
    category: 'sales',
    tagline:
      'Sync ABM campaign performance, target accounts, and engagement from RollWorks.',
    brandColor: '#005DFF',
  },
  {
    id: 'terminus',
    name: 'Terminus',
    category: 'sales',
    tagline:
      'Sync ABM campaign performance, target accounts, and engagement from Terminus.',
    brandColor: '#33B2FF',
  },
  {
    id: 'leadfeeder',
    name: 'Leadfeeder',
    category: 'sales',
    tagline:
      'Sync website-visiting companies, lead activity, and account quality from Leadfeeder.',
    brandColor: '#86C440',
  },

  {
    id: 'avoma',
    name: 'Avoma',
    category: 'sales',
    tagline: 'Sync meetings, talk-time, and conversation insights from Avoma.',
    brandColor: '#5350FF',
  },
  {
    id: 'fathom',
    name: 'Fathom',
    category: 'sales',
    tagline: 'Sync meetings, summaries, and talk-time stats from Fathom.',
    icon: 'fathom',
  },
  {
    id: 'otter-ai',
    name: 'Otter.ai',
    category: 'sales',
    tagline:
      'Sync meetings, transcription volume, and per-user usage from Otter.ai.',
    brandColor: '#00B0F0',
  },
  {
    id: 'fireflies-ai',
    name: 'Fireflies.ai',
    category: 'sales',
    tagline:
      'Sync meetings, transcription volume, and conversation insights from Fireflies.ai.',
    brandColor: '#F77737',
  },
  {
    id: 'grain',
    name: 'Grain',
    category: 'sales',
    tagline: 'Sync meetings, highlights, and conversation insights from Grain.',
    brandColor: '#FF4D2E',
  },

  {
    id: 'clari',
    name: 'Clari',
    category: 'sales',
    tagline:
      'Sync forecast vs commit, pipeline coverage, and deal slippage from Clari.',
    brandColor: '#2D6CDF',
  },
  {
    id: 'aviso',
    name: 'Aviso',
    category: 'sales',
    tagline:
      'Sync forecast vs commit, deal risk, and pipeline coverage from Aviso.',
    brandColor: '#0E2A5C',
  },
  {
    id: 'boostup',
    name: 'BoostUp',
    category: 'sales',
    tagline:
      'Sync forecast vs commit, deal risk, and rep activity from BoostUp.',
    brandColor: '#5733FF',
  },
  {
    id: 'insightsquared',
    name: 'InsightSquared',
    category: 'sales',
    tagline:
      'Sync forecasts, pipeline analytics, and rep activity from InsightSquared.',
    brandColor: '#3FCEF5',
  },

  {
    id: 'highspot',
    name: 'Highspot',
    category: 'sales',
    tagline:
      'Sync content engagement, rep usage, and pitch outcomes from Highspot.',
    brandColor: '#FF7A00',
  },
  {
    id: 'seismic',
    name: 'Seismic',
    category: 'sales',
    tagline:
      'Sync content engagement, rep usage, and live-send activity from Seismic.',
    brandColor: '#FF6347',
  },
  {
    id: 'showpad',
    name: 'Showpad',
    category: 'sales',
    tagline:
      'Sync content engagement, rep usage, and learning progress from Showpad.',
    icon: 'showpad',
  },

  {
    id: 'spiff',
    name: 'Spiff',
    category: 'sales',
    tagline:
      'Sync commission calculations, payouts, and quota attainment from Spiff.',
    brandColor: '#0A1A2F',
  },
  {
    id: 'captivateiq',
    name: 'CaptivateIQ',
    category: 'sales',
    tagline:
      'Sync commission calculations, payouts, and quota attainment from CaptivateIQ.',
    brandColor: '#1A7FE3',
  },
  {
    id: 'quotapath',
    name: 'QuotaPath',
    category: 'sales',
    tagline:
      'Sync commission calculations, payouts, and quota attainment from QuotaPath.',
    brandColor: '#7C3AED',
  },
  {
    id: 'salesforce-cpq',
    name: 'Salesforce CPQ',
    category: 'sales',
    tagline:
      'Sync quotes, configurations, and approval cycle time from Salesforce CPQ.',
    brandColor: '#00A1E0',
  },
  {
    id: 'dealhub',
    name: 'DealHub',
    category: 'sales',
    tagline: 'Sync quotes, deal rooms, and approval cycle time from DealHub.',
    brandColor: '#FF6F00',
  },
  {
    id: 'subskribe',
    name: 'Subskribe',
    category: 'sales',
    tagline: 'Sync quotes, subscriptions, and renewal cycle from Subskribe.',
    brandColor: '#1A1A4E',
  },

  {
    id: 'ringcentral',
    name: 'RingCentral',
    category: 'support',
    tagline:
      'Sync calls, minutes, and per-user activity from a RingCentral account.',
    brandColor: '#0073AE',
  },
  {
    id: 'dialpad',
    name: 'Dialpad',
    category: 'support',
    tagline:
      'Sync calls, minutes, and per-user activity from a Dialpad account.',
    brandColor: '#7C52FF',
  },
  {
    id: 'aircall',
    name: 'Aircall',
    category: 'support',
    tagline: 'Sync calls, abandonment, and per-team activity from Aircall.',
    icon: 'aircall',
  },
  {
    id: 'justcall',
    name: 'JustCall',
    category: 'support',
    tagline: 'Sync calls, SMS volume, and per-user activity from JustCall.',
    brandColor: '#0E55FF',
  },
  {
    id: 'openphone',
    name: 'OpenPhone',
    category: 'support',
    tagline: 'Sync calls, SMS volume, and per-user activity from OpenPhone.',
    brandColor: '#7C3AED',
  },
  {
    id: 'talkdesk',
    name: 'Talkdesk',
    category: 'support',
    tagline:
      'Sync calls, abandonment, average handle time, and CSAT from Talkdesk.',
    brandColor: '#02265F',
  },
  {
    id: 'five9',
    name: 'Five9',
    category: 'support',
    tagline:
      'Sync calls, abandonment, average handle time, and CSAT from Five9.',
    brandColor: '#1E2B4F',
  },
  {
    id: 'nice-incontact',
    name: 'NICE CXone',
    category: 'support',
    tagline:
      'Sync contact volume, abandonment, AHT, and CSAT from NICE CXone (inContact).',
    brandColor: '#1A1A1A',
  },
  {
    id: 'vonage',
    name: 'Vonage',
    category: 'support',
    tagline:
      'Sync calls, minutes, and per-user activity from a Vonage account.',
    icon: 'vonage',
  },

  {
    id: 'plivo',
    name: 'Plivo',
    category: 'engineering',
    tagline:
      'Sync SMS, voice, and per-number usage with delivery and error rates from Plivo.',
    brandColor: '#1F8FFF',
  },
  {
    id: 'messagebird',
    name: 'MessageBird',
    category: 'engineering',
    tagline:
      'Sync SMS, voice, WhatsApp, and email usage with delivery rates from MessageBird.',
    brandColor: '#2481D7',
  },
  {
    id: 'sinch',
    name: 'Sinch',
    category: 'engineering',
    tagline:
      'Sync SMS, voice, and per-channel usage with delivery rates from Sinch.',
    brandColor: '#003F31',
  },
  {
    id: 'telnyx',
    name: 'Telnyx',
    category: 'engineering',
    tagline:
      'Sync SMS, voice, and per-number usage with delivery and error rates from Telnyx.',
    brandColor: '#00E3AA',
  },
  {
    id: 'bandwidth',
    name: 'Bandwidth',
    category: 'engineering',
    tagline:
      'Sync SMS, voice, and 911 usage with delivery rates from Bandwidth.',
    brandColor: '#0021A5',
  },

  {
    id: 'pusher-beams',
    name: 'Pusher Beams',
    category: 'marketing',
    tagline:
      'Sync push notification send volume, delivery rate, and opens from Pusher Beams.',
    icon: 'pusher',
  },
  {
    id: 'airship',
    name: 'Airship',
    category: 'marketing',
    tagline:
      'Sync push notification send volume, delivery, opens, and engagement from Airship.',
    brandColor: '#FA0F40',
  },

  {
    id: 'cloudflare-radar',
    name: 'Cloudflare Radar',
    category: 'analytics',
    tagline:
      'Sync internet traffic trends, attack signals, and domain ranking data from Cloudflare Radar.',
    icon: 'cloudflare',
  },
  {
    id: 'stack-overflow-tags',
    name: 'Stack Overflow Tags',
    category: 'marketing',
    tagline:
      'Watch question volume, answer rate, and view counts for tracked Stack Overflow tags.',
    icon: 'stackoverflow',
  },
  {
    id: 'g2',
    name: 'G2',
    category: 'marketing',
    tagline:
      'Sync overall rating, review count, and category rank from a G2 product page.',
    icon: 'g2',
  },
  {
    id: 'capterra',
    name: 'Capterra',
    category: 'marketing',
    tagline:
      'Sync overall rating, review count, and category rank from a Capterra product page.',
    brandColor: '#FF9D28',
  },
  {
    id: 'trustradius',
    name: 'TrustRadius',
    category: 'marketing',
    tagline:
      'Sync overall rating, review count, and category rank from a TrustRadius product page.',
    brandColor: '#F2683B',
  },
  {
    id: 'mention',
    name: 'Mention',
    category: 'marketing',
    tagline:
      'Sync brand mentions, reach, and sentiment across web and social from Mention.',
    brandColor: '#0084FF',
  },
  {
    id: 'brand24',
    name: 'Brand24',
    category: 'marketing',
    tagline:
      'Sync brand mentions, reach, and sentiment across web and social from Brand24.',
    brandColor: '#1ABC9C',
  },
  {
    id: 'talkwalker',
    name: 'Talkwalker',
    category: 'marketing',
    tagline:
      'Sync brand mentions, reach, sentiment, and share-of-voice from Talkwalker.',
    brandColor: '#005AFF',
  },
  {
    id: 'meltwater',
    name: 'Meltwater',
    category: 'marketing',
    tagline:
      'Sync media mentions, reach, sentiment, and share-of-voice from Meltwater.',
    brandColor: '#1A1A1A',
  },
];
