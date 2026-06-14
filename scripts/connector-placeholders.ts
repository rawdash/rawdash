import type { ConnectorCategory } from '@rawdash/core';

export interface ConnectorPlaceholder {
  id: string;
  name: string;
  category: ConnectorCategory;
  tagline: string;
  icon?: string;
  brandColor?: string;
  domain: string;
  monogram?: boolean;
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
    domain: 'asana.com',
    requestIssue: 'RAW-424',
  },
  {
    id: 'basecamp',
    name: 'Basecamp',
    category: 'engineering',
    tagline:
      'Sync to-dos, message boards, and project activity from a Basecamp account.',
    icon: 'basecamp',
    domain: 'basecamp.com',
  },
  {
    id: 'bitrise',
    name: 'Bitrise',
    category: 'engineering',
    tagline:
      'Sync mobile CI builds with their state, duration, and trigger source from Bitrise.',
    icon: 'bitrise',
    domain: 'bitrise.io',
  },
  {
    id: 'buildkite',
    name: 'Buildkite',
    category: 'engineering',
    tagline:
      'Sync pipelines, builds, and jobs - including state, duration, and retries - from Buildkite.',
    icon: 'buildkite',
    domain: 'buildkite.com',
    requestIssue: 'RAW-224',
  },
  {
    id: 'clickup',
    name: 'ClickUp',
    category: 'engineering',
    tagline:
      'Sync tasks, lists, and completion throughput from a ClickUp workspace.',
    icon: 'clickup',
    domain: 'clickup.com',
    requestIssue: 'RAW-425',
  },
  {
    id: 'codacy',
    name: 'Codacy',
    category: 'engineering',
    tagline:
      'Sync code quality issues, coverage, and per-repo grades from Codacy.',
    icon: 'codacy',
    domain: 'codacy.com',
  },
  {
    id: 'codeclimate',
    name: 'Code Climate',
    category: 'engineering',
    tagline:
      'Sync maintainability, technical debt, and coverage trends from Code Climate.',
    icon: 'codeclimate',
    brandColor: '#000000',
    domain: 'codeclimate.com',
  },
  {
    id: 'codemagic',
    name: 'Codemagic',
    category: 'engineering',
    tagline:
      'Sync mobile CI builds, distributions, and test reports from Codemagic.',
    icon: 'codemagic',
    brandColor: '#7E5BEF',
    domain: 'codemagic.io',
  },
  {
    id: 'deepsource',
    name: 'DeepSource',
    category: 'engineering',
    tagline:
      'Sync issues, coverage, and per-analyzer findings from DeepSource.',
    brandColor: '#21AC7A',
    domain: 'deepsource.com',
  },
  {
    id: 'docker-hub',
    name: 'Docker Hub',
    category: 'engineering',
    tagline:
      'Sync repositories with pull counts, star counts, and last-push activity from Docker Hub.',
    icon: 'docker',
    domain: 'docker.com',
  },
  {
    id: 'dynatrace',
    name: 'Dynatrace',
    category: 'engineering',
    tagline:
      'Sync problems, hosts, and entity metrics from a Dynatrace environment.',
    icon: 'dynatrace',
    domain: 'dynatrace.com',
  },
  {
    id: 'eas-build',
    name: 'EAS Build (Expo)',
    category: 'engineering',
    tagline:
      'Sync Expo Application Services builds, updates, and submission status.',
    icon: 'expo',
    domain: 'expo.dev',
  },
  {
    id: 'github-container-registry',
    name: 'GitHub Container Registry',
    category: 'engineering',
    tagline:
      'Sync container packages, downloads, and version counts from GHCR.',
    icon: 'github',
    domain: 'github.com',
  },
  {
    id: 'grafana-cloud',
    name: 'Grafana Cloud',
    category: 'engineering',
    tagline:
      'Query Loki, Tempo, and Mimir and sync log, trace, and metric series from Grafana Cloud.',
    icon: 'grafana',
    domain: 'grafana.com',
    requestIssue: 'RAW-210',
  },
  {
    id: 'harvest',
    name: 'Harvest',
    category: 'engineering',
    tagline:
      'Sync tracked time, by-project breakdowns, and team utilization from Harvest.',
    brandColor: '#FA5D00',
    domain: 'getharvest.com',
  },
  {
    id: 'honeycomb',
    name: 'Honeycomb',
    category: 'engineering',
    tagline:
      'Sync query results, SLOs, and trigger activity from a Honeycomb environment.',
    brandColor: '#F5A623',
    domain: 'honeycomb.io',
    requestIssue: 'RAW-209',
  },
  {
    id: 'jenkins',
    name: 'Jenkins',
    category: 'engineering',
    tagline:
      'Sync jobs and builds with their result, duration, and trigger cause from a Jenkins server.',
    icon: 'jenkins',
    domain: 'jenkins.io',
    requestIssue: 'RAW-223',
  },
  {
    id: 'logrocket',
    name: 'LogRocket',
    category: 'engineering',
    tagline:
      'Sync session counts, error volume, and frontend performance from LogRocket.',
    brandColor: '#764ABC',
    domain: 'logrocket.com',
  },
  {
    id: 'mage',
    name: 'Mage',
    category: 'engineering',
    tagline: 'Sync pipeline runs, schedules, and failures from Mage.',
    brandColor: '#7B61FF',
    domain: 'mage.ai',
  },
  {
    id: 'mezmo',
    name: 'Mezmo',
    category: 'engineering',
    tagline:
      'Sync log volumes, error counts, and per-source rates from Mezmo (LogDNA).',
    icon: 'mezmo',
    brandColor: '#3B82F6',
    domain: 'mezmo.com',
  },
  {
    id: 'microsoft-app-center',
    name: 'Microsoft App Center',
    category: 'engineering',
    tagline:
      'Sync mobile builds, distributions, crashes, and analytics from App Center.',
    brandColor: '#0078D4',
    domain: 'appcenter.ms',
  },
  {
    id: 'microsoft-teams',
    name: 'Microsoft Teams',
    category: 'engineering',
    tagline:
      'Sync channel activity, message volume, and team membership from Microsoft Teams.',
    brandColor: '#4B53BC',
    domain: 'microsoft.com',
  },
  {
    id: 'monday',
    name: 'Monday.com',
    category: 'engineering',
    tagline:
      'Sync items, boards, and status throughput from a Monday.com workspace.',
    brandColor: '#FF3D57',
    domain: 'monday.com',
    requestIssue: 'RAW-426',
  },
  {
    id: 'mysql',
    name: 'MySQL',
    category: 'engineering',
    tagline:
      'Run scheduled SQL against a MySQL database and sync the result rows as a metric or entity series.',
    icon: 'mysql',
    domain: 'mysql.com',
    requestIssue: 'RAW-442',
  },
  {
    id: 'npm-stats',
    name: 'npm Stats',
    category: 'engineering',
    tagline:
      'Sync daily download counts for npm packages you maintain or depend on.',
    icon: 'npm',
    domain: 'npmjs.com',
    requestIssue: 'RAW-228',
  },
  {
    id: 'opsgenie',
    name: 'Opsgenie',
    category: 'engineering',
    tagline:
      'Sync alerts, incidents, and on-call shifts from an Opsgenie team.',
    icon: 'opsgenie',
    domain: 'atlassian.com',
    requestIssue: 'RAW-208',
  },
  {
    id: 'pagerduty',
    name: 'PagerDuty',
    category: 'engineering',
    tagline:
      'Sync incidents, on-call shifts, and escalation activity - including acknowledge and resolve times - from PagerDuty.',
    icon: 'pagerduty',
    domain: 'pagerduty.com',
    requestIssue: 'RAW-191',
  },
  {
    id: 'rollbar',
    name: 'Rollbar',
    category: 'engineering',
    tagline:
      'Sync errors, occurrence counts, and people-affected metrics from Rollbar.',
    icon: 'rollbar',
    brandColor: '#FF5A5F',
    domain: 'rollbar.com',
  },
  {
    id: 'shortcut',
    name: 'Shortcut',
    category: 'engineering',
    tagline:
      'Sync stories, epics, and cycle activity from a Shortcut workspace.',
    icon: 'shortcut',
    domain: 'shortcut.com',
  },
  {
    id: 'slack',
    name: 'Slack',
    category: 'engineering',
    tagline:
      'Sync channel activity, message volume, and member counts from a Slack workspace.',
    brandColor: '#4A154B',
    domain: 'slack.com',
  },
  {
    id: 'sonarcloud',
    name: 'SonarCloud',
    category: 'engineering',
    tagline:
      'Sync code quality issues, coverage, and per-branch grades from SonarCloud.',
    brandColor: '#F3702A',
    domain: 'sonarsource.com',
  },
  {
    id: 'splunk',
    name: 'Splunk',
    category: 'engineering',
    tagline:
      'Sync saved-search results and alert counts from a Splunk instance.',
    icon: 'splunk',
    domain: 'splunk.com',
  },
  {
    id: 'sumo-logic',
    name: 'Sumo Logic',
    category: 'engineering',
    tagline:
      'Sync search results, alert volume, and source health from Sumo Logic.',
    icon: 'sumologic',
    brandColor: '#000099',
    domain: 'sumologic.com',
  },
  {
    id: 'temporal',
    name: 'Temporal',
    category: 'engineering',
    tagline:
      'Sync workflow runs, failures, and queue depth from a Temporal cluster.',
    icon: 'temporal',
    domain: 'temporal.io',
  },
  {
    id: 'terraform-cloud',
    name: 'Terraform Cloud',
    category: 'engineering',
    tagline:
      'Sync workspace runs, plan/apply outcomes, and drift state from Terraform Cloud.',
    icon: 'terraform',
    domain: 'hashicorp.com',
  },
  {
    id: 'testrail',
    name: 'TestRail',
    category: 'engineering',
    tagline:
      'Sync test runs, pass/fail breakdowns, and milestone progress from TestRail.',
    icon: 'testrail',
    brandColor: '#65C179',
    domain: 'testrail.com',
  },
  {
    id: 'toggl',
    name: 'Toggl Track',
    category: 'engineering',
    tagline:
      'Sync tracked time, by-project hours, and team utilization from Toggl Track.',
    icon: 'toggl',
    domain: 'toggl.com',
  },
  {
    id: 'trello',
    name: 'Trello',
    category: 'engineering',
    tagline: 'Sync cards, lists, and board activity from a Trello workspace.',
    icon: 'trello',
    domain: 'trello.com',
  },
  {
    id: 'trigger-dev',
    name: 'Trigger.dev',
    category: 'engineering',
    tagline:
      'Sync job runs, schedules, and failures from a Trigger.dev project.',
    brandColor: '#7C3AED',
    domain: 'trigger.dev',
  },
  {
    id: 'wrike',
    name: 'Wrike',
    category: 'engineering',
    tagline: 'Sync tasks, projects, and workload across a Wrike account.',
    brandColor: '#0088CC',
    domain: 'wrike.com',
  },
  {
    id: 'zoom',
    name: 'Zoom',
    category: 'engineering',
    tagline:
      'Sync meeting counts, total minutes, and webinar attendance from Zoom.',
    icon: 'zoom',
    domain: 'zoom.us',
  },

  {
    id: 'airflow',
    name: 'Apache Airflow',
    category: 'infrastructure',
    tagline:
      'Sync DAG runs, task instances, and SLA miss counts from an Airflow deployment.',
    icon: 'apacheairflow',
    domain: 'airflow.apache.org',
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    category: 'infrastructure',
    tagline:
      'Pull zone analytics, Workers usage, and request/bandwidth metrics from a Cloudflare account.',
    icon: 'cloudflare',
    domain: 'cloudflare.com',
    requestIssue: 'RAW-184',
  },
  {
    id: 'cockroachdb',
    name: 'CockroachDB Cloud',
    category: 'infrastructure',
    tagline:
      'Sync cluster status, regions, and connection metrics from CockroachDB Cloud.',
    icon: 'cockroachlabs',
    domain: 'cockroachlabs.com',
  },
  {
    id: 'confluent-cloud',
    name: 'Confluent Cloud',
    category: 'infrastructure',
    tagline:
      'Sync topic message rates, consumer lag, and cluster throughput from Confluent Cloud.',
    icon: 'apachekafka',
    domain: 'confluent.io',
  },
  {
    id: 'dagster',
    name: 'Dagster',
    category: 'infrastructure',
    tagline:
      'Sync runs, asset materializations, and schedules from a Dagster deployment.',
    brandColor: '#19B5E1',
    domain: 'dagster.io',
  },
  {
    id: 'digitalocean',
    name: 'DigitalOcean',
    category: 'infrastructure',
    tagline:
      'Sync droplets, databases, app deployments, and monthly spend from DigitalOcean.',
    icon: 'digitalocean',
    domain: 'digitalocean.com',
  },
  {
    id: 'fastly',
    name: 'Fastly',
    category: 'infrastructure',
    tagline:
      'Sync requests, cache-hit ratio, and origin performance from Fastly.',
    icon: 'fastly',
    domain: 'fastly.com',
  },
  {
    id: 'fly',
    name: 'Fly.io',
    category: 'infrastructure',
    tagline:
      'Sync apps, machines, and deployments - including region and health - from Fly.io.',
    icon: 'flydotio',
    domain: 'fly.io',
    requestIssue: 'RAW-226',
  },
  {
    id: 'heroku',
    name: 'Heroku',
    category: 'infrastructure',
    tagline:
      'Sync apps, dynos, deploys, and monthly spend from a Heroku account.',
    brandColor: '#6762A6',
    domain: 'heroku.com',
  },
  {
    id: 'inngest',
    name: 'Inngest',
    category: 'infrastructure',
    tagline:
      'Sync function runs, queue depth, and failures from an Inngest workspace.',
    brandColor: '#000000',
    domain: 'inngest.com',
  },
  {
    id: 'mongodb-atlas',
    name: 'MongoDB Atlas',
    category: 'infrastructure',
    tagline:
      'Sync cluster state, connection counts, and read/write throughput from MongoDB Atlas.',
    icon: 'mongodb',
    domain: 'mongodb.com',
  },
  {
    id: 'neon',
    name: 'Neon',
    category: 'infrastructure',
    tagline: 'Sync projects, branches, and compute-hours from a Neon account.',
    icon: 'neon',
    brandColor: '#00E699',
    domain: 'neon.tech',
  },
  {
    id: 'planetscale',
    name: 'PlanetScale',
    category: 'infrastructure',
    tagline:
      'Sync database branches, deploy requests, and query latency from PlanetScale.',
    icon: 'planetscale',
    domain: 'planetscale.com',
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    category: 'infrastructure',
    tagline:
      'Run scheduled SQL against a PostgreSQL database and sync the result rows as a metric or entity series.',
    icon: 'postgresql',
    domain: 'postgresql.org',
    requestIssue: 'RAW-441',
  },
  {
    id: 'prefect',
    name: 'Prefect',
    category: 'infrastructure',
    tagline:
      'Sync flow runs, schedules, and failures from a Prefect workspace.',
    icon: 'prefect',
    domain: 'prefect.io',
  },
  {
    id: 'railway',
    name: 'Railway',
    category: 'infrastructure',
    tagline:
      'Sync projects, services, and deployments with their status from Railway.',
    icon: 'railway',
    domain: 'railway.app',
    requestIssue: 'RAW-227',
  },
  {
    id: 'redis',
    name: 'Redis',
    category: 'infrastructure',
    tagline:
      'Sync key counts, memory usage, and command throughput from a Redis instance.',
    icon: 'redis',
    domain: 'redis.io',
  },
  {
    id: 'render',
    name: 'Render',
    category: 'infrastructure',
    tagline:
      'Sync services, deploys, and their build/live state from a Render account.',
    icon: 'render',
    domain: 'render.com',
    requestIssue: 'RAW-225',
  },
  {
    id: 'statusgator',
    name: 'StatusGator',
    category: 'infrastructure',
    tagline:
      "Aggregate the public status pages of every SaaS you depend on into a single 'is anything down?' view.",
    brandColor: '#5C6BC0',
    domain: 'statusgator.com',
    requestIssue: 'RAW-452',
  },
  {
    id: 'supabase',
    name: 'Supabase',
    category: 'infrastructure',
    tagline:
      'Sync project status, auth users, and database storage from a Supabase project.',
    icon: 'supabase',
    domain: 'supabase.com',
  },
  {
    id: 'upstash',
    name: 'Upstash',
    category: 'infrastructure',
    tagline:
      'Sync request counts, bandwidth, and storage across Upstash Redis/Kafka databases.',
    icon: 'upstash',
    domain: 'upstash.com',
  },

  {
    id: '1password',
    name: '1Password',
    category: 'security',
    tagline:
      'Sync vault item counts, recently changed credentials, and watchtower findings from a 1Password account.',
    icon: '1password',
    domain: '1password.com',
  },
  {
    id: 'clerk',
    name: 'Clerk',
    category: 'security',
    tagline:
      'Sync users, organizations, and sign-in activity from a Clerk application.',
    icon: 'clerk',
    brandColor: '#6C47FF',
    domain: 'clerk.com',
    requestIssue: 'RAW-418',
  },
  {
    id: 'crowdstrike',
    name: 'CrowdStrike Falcon',
    category: 'security',
    tagline:
      'Sync detections, incidents, and host coverage from CrowdStrike Falcon.',
    brandColor: '#FA0202',
    domain: 'crowdstrike.com',
  },
  {
    id: 'drata',
    name: 'Drata',
    category: 'security',
    tagline:
      'Sync control status, failing tests, and audit-ready percentage from Drata.',
    brandColor: '#6D2BFF',
    domain: 'drata.com',
    requestIssue: 'RAW-422',
  },
  {
    id: 'entra-id',
    name: 'Microsoft Entra ID',
    category: 'security',
    tagline:
      'Sync sign-ins, risky users, and MFA adoption from a Microsoft Entra ID tenant.',
    brandColor: '#0078D4',
    domain: 'microsoft.com',
    requestIssue: 'RAW-420',
  },
  {
    id: 'have-i-been-pwned',
    name: 'Have I Been Pwned',
    category: 'security',
    tagline: 'Watch a list of company domains for new breach disclosures.',
    icon: 'haveibeenpwned',
    brandColor: '#1F4068',
    domain: 'haveibeenpwned.com',
  },
  {
    id: 'lacework',
    name: 'Lacework',
    category: 'security',
    tagline:
      'Sync cloud security findings, severity distribution, and coverage from Lacework.',
    brandColor: '#1A57F1',
    domain: 'lacework.com',
  },
  {
    id: 'microsoft-defender',
    name: 'Microsoft Defender',
    category: 'security',
    tagline:
      'Sync detections, incidents, and device exposure from Microsoft Defender.',
    brandColor: '#0078D4',
    domain: 'microsoft.com',
  },
  {
    id: 'orca-security',
    name: 'Orca Security',
    category: 'security',
    tagline:
      'Sync cloud assets, alerts, and severity counts from Orca Security.',
    brandColor: '#202020',
    domain: 'orca.security',
  },
  {
    id: 'qualys',
    name: 'Qualys',
    category: 'security',
    tagline:
      'Sync vulnerabilities, asset coverage, and compliance scan results from Qualys.',
    icon: 'qualys',
    brandColor: '#ED1C24',
    domain: 'qualys.com',
  },
  {
    id: 'rapid7-insightvm',
    name: 'Rapid7 InsightVM',
    category: 'security',
    tagline:
      'Sync vulnerabilities, asset coverage, and remediation progress from InsightVM.',
    brandColor: '#1A1A1A',
    domain: 'rapid7.com',
  },
  {
    id: 'secureframe',
    name: 'Secureframe',
    category: 'security',
    tagline:
      'Sync control status, evidence age, and audit readiness from Secureframe.',
    brandColor: '#7C3AED',
    domain: 'secureframe.com',
  },
  {
    id: 'sentinelone',
    name: 'SentinelOne',
    category: 'security',
    tagline: 'Sync threats, incidents, and endpoint coverage from SentinelOne.',
    brandColor: '#6B0AEA',
    domain: 'sentinelone.com',
  },
  {
    id: 'snyk',
    name: 'Snyk',
    category: 'security',
    tagline:
      'Sync projects and vulnerability issues - by severity, status, and fixability - from a Snyk organization.',
    icon: 'snyk',
    domain: 'snyk.io',
    requestIssue: 'RAW-229',
  },
  {
    id: 'tenable',
    name: 'Tenable',
    category: 'security',
    tagline:
      'Sync vulnerabilities, asset coverage, and scan results from Tenable.',
    brandColor: '#00B5E2',
    domain: 'tenable.com',
  },
  {
    id: 'vanta',
    name: 'Vanta',
    category: 'security',
    tagline:
      'Sync control status, failing tests, and audit-ready percentage from Vanta.',
    brandColor: '#45D5BB',
    domain: 'vanta.com',
    monogram: true,
    requestIssue: 'RAW-421',
  },
  {
    id: 'wiz',
    name: 'Wiz',
    category: 'security',
    tagline:
      'Sync cloud security findings by severity and remediation progress from Wiz.',
    brandColor: '#11253E',
    domain: 'wiz.io',
    requestIssue: 'RAW-423',
  },
  {
    id: 'freshdesk',
    name: 'Freshdesk',
    category: 'support',
    tagline:
      'Sync tickets, SLA breach counts, agent activity, and CSAT from a Freshdesk account.',
    brandColor: '#25C16F',
    domain: 'freshdesk.com',
  },
  {
    id: 'front',
    name: 'Front',
    category: 'support',
    tagline:
      'Sync conversations, tags, and response/resolution times from a Front inbox.',
    brandColor: '#001B38',
    domain: 'front.com',
    requestIssue: 'RAW-242',
  },
  {
    id: 'gladly',
    name: 'Gladly',
    category: 'support',
    tagline: 'Sync conversations, channels, and agent activity from Gladly.',
    brandColor: '#FE4F2D',
    domain: 'gladly.com',
  },
  {
    id: 'helpscout',
    name: 'Help Scout',
    category: 'support',
    tagline:
      'Sync conversations, replies, and happiness ratings from a Help Scout mailbox.',
    icon: 'helpscout',
    domain: 'helpscout.com',
    requestIssue: 'RAW-243',
  },
  {
    id: 'jira-service-management',
    name: 'Jira Service Management',
    category: 'support',
    tagline:
      'Sync service requests, SLA breach counts, and resolution times from Jira Service Management.',
    icon: 'jira',
    domain: 'atlassian.com',
    requestIssue: 'RAW-446',
  },
  {
    id: 'kayako',
    name: 'Kayako',
    category: 'support',
    tagline: 'Sync cases, replies, and CSAT from a Kayako instance.',
    brandColor: '#E62828',
    domain: 'kayako.com',
  },
  {
    id: 'servicenow',
    name: 'ServiceNow',
    category: 'support',
    tagline:
      'Sync incidents, change requests, and SLA breach counts from a ServiceNow instance.',
    brandColor: '#62D84E',
    domain: 'servicenow.com',
    requestIssue: 'RAW-445',
  },

  {
    id: 'airtable',
    name: 'Airtable',
    category: 'product',
    tagline:
      'Sync records from selected bases as entities or metric series - bring-your-own-data from Airtable.',
    icon: 'airtable',
    domain: 'airtable.com',
  },
  {
    id: 'algolia',
    name: 'Algolia',
    category: 'product',
    tagline:
      "Sync search query counts, CTR, top queries, and no-result rate from Algolia's analytics.",
    icon: 'algolia',
    domain: 'algolia.com',
    requestIssue: 'RAW-448',
  },
  {
    id: 'appcues',
    name: 'Appcues',
    category: 'product',
    tagline:
      'Sync flow engagement, completion rates, and feature adoption from Appcues.',
    brandColor: '#4F36C6',
    domain: 'appcues.com',
  },
  {
    id: 'bugsnag',
    name: 'Bugsnag',
    category: 'product',
    tagline:
      'Sync errors, occurrence counts, and people-affected metrics from Bugsnag.',
    brandColor: '#4949E4',
    domain: 'bugsnag.com',
  },
  {
    id: 'canny',
    name: 'Canny',
    category: 'product',
    tagline: 'Sync feature requests, upvotes, and roadmap status from Canny.',
    brandColor: '#FF005C',
    domain: 'canny.io',
  },
  {
    id: 'chameleon',
    name: 'Chameleon',
    category: 'product',
    tagline: 'Sync tour engagement and completion rates from Chameleon.',
    brandColor: '#3700FF',
    domain: 'chameleon.io',
  },
  {
    id: 'configcat',
    name: 'ConfigCat',
    category: 'product',
    tagline:
      'Sync feature flags, evaluations, and rollout state from ConfigCat.',
    brandColor: '#FA0F00',
    domain: 'configcat.com',
  },
  {
    id: 'delighted',
    name: 'Delighted',
    category: 'product',
    tagline: 'Sync NPS, CSAT, and CES survey responses from Delighted.',
    brandColor: '#1FB39A',
    domain: 'delighted.com',
  },
  {
    id: 'flagsmith',
    name: 'Flagsmith',
    category: 'product',
    tagline:
      'Sync feature flags, environments, and evaluations from Flagsmith.',
    brandColor: '#1A2233',
    domain: 'flagsmith.com',
  },
  {
    id: 'fullstory',
    name: 'FullStory',
    category: 'product',
    tagline:
      'Sync session counts, frustration signals, and conversion funnels from FullStory.',
    brandColor: '#F24405',
    domain: 'fullstory.com',
  },
  {
    id: 'gainsight',
    name: 'Gainsight',
    category: 'product',
    tagline:
      'Sync customer health scores, renewal risk, and CTAs from Gainsight.',
    brandColor: '#F58220',
    domain: 'gainsight.com',
  },
  {
    id: 'google-sheets',
    name: 'Google Sheets',
    category: 'product',
    tagline:
      'Sync rows from a Google Sheet as a metric or entity series - the simplest bring-your-own-data source.',
    icon: 'googlesheets',
    domain: 'google.com',
  },
  {
    id: 'growthbook',
    name: 'GrowthBook',
    category: 'product',
    tagline: 'Sync feature flags and experiment results from GrowthBook.',
    brandColor: '#6F4DBC',
    domain: 'growthbook.io',
  },
  {
    id: 'heap',
    name: 'Heap',
    category: 'product',
    tagline: 'Sync DAU, event volume, and funnel results from Heap.',
    brandColor: '#15ADDE',
    domain: 'heap.io',
  },
  {
    id: 'hotjar',
    name: 'Hotjar',
    category: 'product',
    tagline: 'Sync survey response volume and NPS scores from Hotjar.',
    icon: 'hotjar',
    domain: 'hotjar.com',
  },
  {
    id: 'microsoft-clarity',
    name: 'Microsoft Clarity',
    category: 'product',
    tagline:
      'Sync session counts, rage clicks, dead clicks, and frustration signals from Microsoft Clarity.',
    brandColor: '#2D3FED',
    domain: 'clarity.microsoft.com',
  },
  {
    id: 'notion',
    name: 'Notion',
    category: 'product',
    tagline:
      'Sync database rows and page properties from a Notion workspace as entities you can chart.',
    icon: 'notion',
    domain: 'notion.so',
  },
  {
    id: 'optimizely',
    name: 'Optimizely',
    category: 'product',
    tagline:
      'Sync experiments, variations, and lift estimates from Optimizely.',
    brandColor: '#0037FF',
    domain: 'optimizely.com',
  },
  {
    id: 'pendo',
    name: 'Pendo',
    category: 'product',
    tagline: 'Sync feature adoption, guide engagement, and NPS from Pendo.',
    brandColor: '#FF4876',
    domain: 'pendo.io',
  },
  {
    id: 'productboard',
    name: 'Productboard',
    category: 'product',
    tagline:
      'Sync features, notes, and prioritization scores from Productboard.',
    brandColor: '#3F4060',
    domain: 'productboard.com',
  },
  {
    id: 'survicate',
    name: 'Survicate',
    category: 'product',
    tagline: 'Sync survey responses, NPS, and CSAT from Survicate.',
    brandColor: '#FF8C42',
    domain: 'survicate.com',
  },
  {
    id: 'typeform',
    name: 'Typeform',
    category: 'product',
    tagline:
      'Sync form submissions, completion rates, and answer distribution from Typeform.',
    icon: 'typeform',
    domain: 'typeform.com',
  },
  {
    id: 'unleash',
    name: 'Unleash',
    category: 'product',
    tagline:
      'Sync feature toggles, evaluations, and environments from Unleash.',
    brandColor: '#1A2333',
    domain: 'getunleash.io',
  },
  {
    id: 'userpilot',
    name: 'Userpilot',
    category: 'product',
    tagline:
      'Sync onboarding flow completion and feature adoption from Userpilot.',
    brandColor: '#7438FF',
    domain: 'userpilot.com',
  },
  {
    id: 'vwo',
    name: 'VWO',
    category: 'product',
    tagline: 'Sync A/B tests, variations, and conversion lift from VWO.',
    brandColor: '#EE3F46',
    domain: 'vwo.com',
  },

  {
    id: 'bigquery',
    name: 'Google BigQuery',
    category: 'analytics',
    tagline:
      'Run scheduled SQL against BigQuery and sync the result rows as metric or entity series.',
    icon: 'googlebigquery',
    domain: 'cloud.google.com',
    requestIssue: 'RAW-444',
  },
  {
    id: 'snowflake',
    name: 'Snowflake',
    category: 'analytics',
    tagline:
      'Run scheduled SQL against a Snowflake warehouse and sync the result rows as metric or entity series.',
    icon: 'snowflake',
    domain: 'snowflake.com',
    requestIssue: 'RAW-443',
  },

  {
    id: 'activecampaign',
    name: 'ActiveCampaign',
    category: 'marketing',
    tagline:
      'Sync campaigns, sends, open/click rates, and automations from ActiveCampaign.',
    brandColor: '#356AE6',
    domain: 'activecampaign.com',
  },
  {
    id: 'agorapulse',
    name: 'Agorapulse',
    category: 'marketing',
    tagline:
      'Sync scheduled posts, engagement, and inbox volume from Agorapulse.',
    brandColor: '#56A7DB',
    domain: 'agorapulse.com',
  },
  {
    id: 'ahrefs',
    name: 'Ahrefs',
    category: 'marketing',
    tagline:
      'Sync organic traffic, keyword rankings, and backlink counts from an Ahrefs project.',
    brandColor: '#054ADA',
    domain: 'ahrefs.com',
    requestIssue: 'RAW-233',
  },
  {
    id: 'beehiiv',
    name: 'Beehiiv',
    category: 'marketing',
    tagline:
      'Sync newsletter subscribers, opens, clicks, and revenue from Beehiiv.',
    brandColor: '#F1D52F',
    domain: 'beehiiv.com',
  },
  {
    id: 'braze',
    name: 'Braze',
    category: 'marketing',
    tagline:
      'Sync campaigns, message volume, opens, clicks, and conversions from Braze.',
    brandColor: '#FA9810',
    domain: 'braze.com',
  },
  {
    id: 'buffer',
    name: 'Buffer',
    category: 'marketing',
    tagline: 'Sync scheduled posts and per-channel engagement from Buffer.',
    icon: 'buffer',
    domain: 'buffer.com',
  },
  {
    id: 'buttondown',
    name: 'Buttondown',
    category: 'marketing',
    tagline: 'Sync newsletter subscribers, opens, and clicks from Buttondown.',
    brandColor: '#000000',
    domain: 'buttondown.com',
  },
  {
    id: 'buy-me-a-coffee',
    name: 'Buy Me a Coffee',
    category: 'marketing',
    tagline:
      'Sync supporter count and monthly contributions from Buy Me a Coffee.',
    icon: 'buymeacoffee',
    brandColor: '#FFDD00',
    domain: 'buymeacoffee.com',
  },
  {
    id: 'circle',
    name: 'Circle',
    category: 'marketing',
    tagline:
      'Sync members, posts, and engagement across spaces in a Circle community.',
    icon: 'circle',
    brandColor: '#000000',
    domain: 'circle.so',
  },
  {
    id: 'constant-contact',
    name: 'Constant Contact',
    category: 'marketing',
    tagline: 'Sync campaigns, sends, opens, and clicks from Constant Contact.',
    brandColor: '#1856ED',
    domain: 'constantcontact.com',
  },
  {
    id: 'convertkit',
    name: 'ConvertKit / Kit',
    category: 'marketing',
    tagline:
      'Sync subscribers, broadcasts, sequences, and revenue from ConvertKit / Kit.',
    brandColor: '#FB6970',
    domain: 'kit.com',
  },
  {
    id: 'crunchbase',
    name: 'Crunchbase',
    category: 'marketing',
    tagline:
      'Watch competitor companies for funding events and news velocity from Crunchbase.',
    icon: 'crunchbase',
    domain: 'crunchbase.com',
  },
  {
    id: 'customer-io',
    name: 'Customer.io',
    category: 'marketing',
    tagline:
      'Sync campaigns, broadcasts, and per-message engagement from Customer.io.',
    brandColor: '#7C3AED',
    domain: 'customer.io',
    requestIssue: 'RAW-232',
  },
  {
    id: 'discord',
    name: 'Discord',
    category: 'marketing',
    tagline:
      'Sync member count, DAU, joins, and message volume across channels in a Discord server.',
    icon: 'discord',
    domain: 'discord.com',
    requestIssue: 'RAW-447',
  },
  {
    id: 'discourse',
    name: 'Discourse',
    category: 'marketing',
    tagline:
      'Sync topics, posts, daily active users, and trust-level distribution from a Discourse community.',
    icon: 'discourse',
    domain: 'discourse.org',
  },
  {
    id: 'drip',
    name: 'Drip',
    category: 'marketing',
    tagline: 'Sync campaigns, sends, opens, and revenue from Drip.',
    brandColor: '#EC568B',
    domain: 'drip.com',
  },
  {
    id: 'eventbrite',
    name: 'Eventbrite',
    category: 'marketing',
    tagline: 'Sync events, tickets sold, and revenue from Eventbrite.',
    brandColor: '#F05537',
    domain: 'eventbrite.com',
  },
  {
    id: 'facebook-pages',
    name: 'Facebook Pages',
    category: 'marketing',
    tagline: 'Sync followers, post engagement, and reach from a Facebook Page.',
    icon: 'facebook',
    domain: 'facebook.com',
  },
  {
    id: 'firebase-cloud-messaging',
    name: 'Firebase Cloud Messaging',
    category: 'marketing',
    tagline:
      'Sync push send volume, delivery rate, and opens from Firebase Cloud Messaging.',
    icon: 'firebase',
    domain: 'firebase.google.com',
    requestIssue: 'RAW-450',
  },
  {
    id: 'getresponse',
    name: 'GetResponse',
    category: 'marketing',
    tagline: 'Sync campaigns, list growth, opens, and clicks from GetResponse.',
    brandColor: '#00BAFF',
    domain: 'getresponse.com',
  },
  {
    id: 'github-sponsors',
    name: 'GitHub Sponsors',
    category: 'marketing',
    tagline:
      'Sync active sponsors, monthly recurring sponsorship, and tier distribution from GitHub Sponsors.',
    icon: 'github',
    domain: 'github.com',
  },
  {
    id: 'glassdoor',
    name: 'Glassdoor',
    category: 'marketing',
    tagline:
      'Sync employer ratings, review count, and rating-category trends from Glassdoor.',
    icon: 'glassdoor',
    domain: 'glassdoor.com',
  },
  {
    id: 'hacker-news',
    name: 'Hacker News',
    category: 'marketing',
    tagline:
      'Watch HN for submissions of your domain and mentions in comments - points, comments, rank.',
    brandColor: '#FF6600',
    domain: 'ycombinator.com',
    requestIssue: 'RAW-455',
  },
  {
    id: 'hootsuite',
    name: 'Hootsuite',
    category: 'marketing',
    tagline:
      'Sync scheduled posts and engagement across channels from Hootsuite.',
    icon: 'hootsuite',
    domain: 'hootsuite.com',
  },
  {
    id: 'instagram-graph',
    name: 'Instagram',
    category: 'marketing',
    tagline:
      'Sync followers, post engagement, and reach via the Instagram Graph API.',
    icon: 'instagram',
    domain: 'instagram.com',
  },
  {
    id: 'iterable',
    name: 'Iterable',
    category: 'marketing',
    tagline:
      'Sync campaigns, sends, opens, clicks, and conversions from Iterable.',
    brandColor: '#3650FA',
    domain: 'iterable.com',
  },
  {
    id: 'ko-fi',
    name: 'Ko-fi',
    category: 'marketing',
    tagline:
      'Sync supporters, one-off contributions, and membership tiers from Ko-fi.',
    icon: 'kofi',
    brandColor: '#FF5E5B',
    domain: 'ko-fi.com',
  },
  {
    id: 'later',
    name: 'Later',
    category: 'marketing',
    tagline: 'Sync scheduled posts and engagement across channels from Later.',
    brandColor: '#5D5DFF',
    domain: 'later.com',
  },
  {
    id: 'linkedin-ads',
    name: 'LinkedIn Ads',
    category: 'marketing',
    tagline:
      'Sync campaign metrics - impressions, clicks, cost, conversions - from LinkedIn Ads.',
    brandColor: '#0A66C2',
    domain: 'linkedin.com',
    requestIssue: 'RAW-230',
  },
  {
    id: 'linkedin-pages',
    name: 'LinkedIn Pages',
    category: 'marketing',
    tagline:
      'Sync followers, post engagement, and impressions for a LinkedIn Page.',
    brandColor: '#0A66C2',
    domain: 'linkedin.com',
  },
  {
    id: 'lob',
    name: 'Lob',
    category: 'marketing',
    tagline:
      'Sync direct-mail sends, delivery status, and per-template performance from Lob.',
    brandColor: '#0099D8',
    domain: 'lob.com',
  },
  {
    id: 'luma',
    name: 'Luma',
    category: 'marketing',
    tagline:
      'Sync events, registrations, and check-in counts from Luma (lu.ma).',
    brandColor: '#5E5BFF',
    domain: 'lu.ma',
  },
  {
    id: 'mailerlite',
    name: 'MailerLite',
    category: 'marketing',
    tagline: 'Sync subscribers, campaigns, opens, and clicks from MailerLite.',
    brandColor: '#1A82E0',
    domain: 'mailerlite.com',
  },
  {
    id: 'marketo',
    name: 'Marketo',
    category: 'marketing',
    tagline:
      'Sync programs, leads, email engagement, and pipeline contribution from Marketo.',
    brandColor: '#5C4C9F',
    domain: 'marketo.com',
  },
  {
    id: 'moengage',
    name: 'MoEngage',
    category: 'marketing',
    tagline: 'Sync campaigns, message volume, and conversions from MoEngage.',
    brandColor: '#FF665A',
    domain: 'moengage.com',
  },
  {
    id: 'onesignal',
    name: 'OneSignal',
    category: 'marketing',
    tagline:
      'Sync push send volume, delivery rate, opt-ins, and per-notification conversions from OneSignal.',
    brandColor: '#E54B4D',
    domain: 'onesignal.com',
    requestIssue: 'RAW-449',
  },
  {
    id: 'opencollective',
    name: 'Open Collective',
    category: 'marketing',
    tagline: 'Sync sponsors, MRR, and balance for an Open Collective.',
    icon: 'opencollective',
    brandColor: '#1869F4',
    domain: 'opencollective.com',
  },
  {
    id: 'oss-insight',
    name: 'OSS Insight',
    category: 'marketing',
    tagline:
      'Sync GitHub star trajectory, contributor growth, and comparative position vs peer repos.',
    brandColor: '#FF8800',
    domain: 'ossinsight.io',
    requestIssue: 'RAW-453',
  },
  {
    id: 'pardot',
    name: 'Pardot (Account Engagement)',
    category: 'marketing',
    tagline:
      'Sync prospects, emails, forms, and pipeline contribution from Pardot.',
    brandColor: '#00A1E0',
    domain: 'pardot.com',
  },
  {
    id: 'patreon',
    name: 'Patreon',
    category: 'marketing',
    tagline:
      'Sync active patrons, MRR, tier distribution, and pledges from Patreon.',
    icon: 'patreon',
    domain: 'patreon.com',
  },
  {
    id: 'pinterest',
    name: 'Pinterest',
    category: 'marketing',
    tagline:
      'Sync followers, impressions, and pin engagement from a Pinterest business account.',
    icon: 'pinterest',
    domain: 'pinterest.com',
  },
  {
    id: 'polar',
    name: 'Polar',
    category: 'marketing',
    tagline:
      'Sync OSS funding subscribers, MRR, and per-tier breakdown from Polar.',
    brandColor: '#0062FF',
    domain: 'polar.sh',
  },
  {
    id: 'product-hunt',
    name: 'Product Hunt',
    category: 'marketing',
    tagline:
      'Sync upvote velocity, rank trajectory, and comments on Product Hunt launches.',
    icon: 'producthunt',
    domain: 'producthunt.com',
    requestIssue: 'RAW-454',
  },
  {
    id: 'reddit',
    name: 'Reddit',
    category: 'marketing',
    tagline:
      'Sync subreddit subscriber growth, post activity, and karma flow for tracked communities.',
    icon: 'reddit',
    domain: 'reddit.com',
  },
  {
    id: 'sendinblue',
    name: 'Brevo (Sendinblue)',
    category: 'marketing',
    tagline:
      'Sync campaigns, sends, opens, clicks, and contact growth from Brevo.',
    icon: 'brevo',
    domain: 'brevo.com',
  },
  {
    id: 'similarweb',
    name: 'SimilarWeb',
    category: 'marketing',
    tagline:
      'Sync competitor traffic estimates, engagement, and traffic-source mix from SimilarWeb.',
    icon: 'similarweb',
    brandColor: '#092540',
    domain: 'similarweb.com',
  },
  {
    id: 'spotify-for-podcasters',
    name: 'Spotify for Podcasters',
    category: 'marketing',
    tagline:
      'Sync plays, unique listeners, and follower growth across episodes from Spotify for Podcasters.',
    icon: 'spotify',
    domain: 'spotify.com',
  },
  {
    id: 'sprout-social',
    name: 'Sprout Social',
    category: 'marketing',
    tagline:
      'Sync scheduled posts, per-channel engagement, and inbox volume from Sprout Social.',
    brandColor: '#75DD66',
    domain: 'sproutsocial.com',
  },
  {
    id: 'substack',
    name: 'Substack',
    category: 'marketing',
    tagline:
      'Sync subscribers, opens, paid conversions, and revenue from a Substack publication.',
    icon: 'substack',
    domain: 'substack.com',
  },
  {
    id: 'tidelift',
    name: 'Tidelift',
    category: 'marketing',
    tagline:
      'Sync subscriber counts and lifter income for OSS packages on Tidelift.',
    brandColor: '#F46524',
    domain: 'tidelift.com',
  },
  {
    id: 'tiktok-ads',
    name: 'TikTok Ads',
    category: 'marketing',
    tagline:
      'Sync campaign spend, impressions, clicks, and conversions from TikTok Ads.',
    icon: 'tiktok',
    domain: 'tiktok.com',
    requestIssue: 'RAW-231',
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    category: 'marketing',
    tagline:
      'Sync follower growth, post views, and engagement from a TikTok business account.',
    icon: 'tiktok',
    domain: 'tiktok.com',
  },
  {
    id: 'trustpilot',
    name: 'Trustpilot',
    category: 'marketing',
    tagline:
      'Sync overall rating, review count, and rating-category trends from Trustpilot.',
    icon: 'trustpilot',
    domain: 'trustpilot.com',
  },
  {
    id: 'twitch',
    name: 'Twitch',
    category: 'marketing',
    tagline:
      'Sync followers, subscribers, peak viewers, and stream activity from a Twitch channel.',
    icon: 'twitch',
    domain: 'twitch.tv',
  },
  {
    id: 'twitter-x',
    name: 'Twitter / X',
    category: 'marketing',
    tagline:
      'Sync followers, post engagement, and mention volume from Twitter / X.',
    icon: 'x',
    domain: 'x.com',
  },
  {
    id: 'webflow',
    name: 'Webflow',
    category: 'marketing',
    tagline:
      'Sync site form submissions and CMS collection items from a Webflow site.',
    icon: 'webflow',
    domain: 'webflow.com',
    requestIssue: 'RAW-235',
  },
  {
    id: 'wistia',
    name: 'Wistia',
    category: 'marketing',
    tagline: 'Sync video plays, play rate, and engagement from Wistia.',
    icon: 'wistia',
    domain: 'wistia.com',
  },
  {
    id: 'youtube',
    name: 'YouTube',
    category: 'marketing',
    tagline:
      'Sync channel subscribers, views, watch-time, and per-video performance from YouTube.',
    icon: 'youtube',
    domain: 'youtube.com',
  },
  {
    id: 'semrush',
    name: 'Semrush',
    category: 'marketing',
    tagline:
      'Sync domain visibility, keyword positions, and traffic estimates from Semrush.',
    icon: 'semrush',
    domain: 'semrush.com',
    requestIssue: 'RAW-234',
  },

  {
    id: 'apollo',
    name: 'Apollo.io',
    category: 'sales',
    tagline:
      'Sync sequences, contacts, and outreach activity from an Apollo.io account.',
    brandColor: '#2E2E5E',
    domain: 'apollo.io',
    requestIssue: 'RAW-237',
  },
  {
    id: 'cal-com',
    name: 'Cal.com',
    category: 'sales',
    tagline:
      'Sync bookings, no-shows, and per-event-type performance from Cal.com.',
    icon: 'caldotcom',
    domain: 'cal.com',
    requestIssue: 'RAW-438',
  },
  {
    id: 'calendly',
    name: 'Calendly',
    category: 'sales',
    tagline:
      'Sync bookings, no-shows, and per-event-type performance from Calendly.',
    icon: 'calendly',
    domain: 'calendly.com',
    requestIssue: 'RAW-437',
  },
  {
    id: 'chorus',
    name: 'Chorus',
    category: 'sales',
    tagline: 'Sync calls and conversation activity from Chorus.',
    brandColor: '#19BC9C',
    domain: 'chorus.ai',
    requestIssue: 'RAW-239',
  },
  {
    id: 'clearbit',
    name: 'Clearbit',
    category: 'sales',
    tagline:
      'Sync enrichment lookups and reveal activity from a Clearbit account.',
    brandColor: '#2D2D2D',
    domain: 'clearbit.com',
    requestIssue: 'RAW-241',
  },
  {
    id: 'gong',
    name: 'Gong',
    category: 'sales',
    tagline:
      'Sync calls, deal activity, and conversation stats from a Gong workspace.',
    brandColor: '#7C3AED',
    domain: 'gong.io',
    requestIssue: 'RAW-238',
  },
  {
    id: 'outreach',
    name: 'Outreach',
    category: 'sales',
    tagline:
      'Sync sequences, prospects, and rep activity from an Outreach account.',
    brandColor: '#5951FF',
    domain: 'outreach.io',
    requestIssue: 'RAW-236',
  },
  {
    id: 'pipedrive',
    name: 'Pipedrive',
    category: 'sales',
    tagline:
      'Sync deals, pipeline stages, and activities - including win rate and stage age - from Pipedrive.',
    brandColor: '#2A8C3C',
    domain: 'pipedrive.com',
    requestIssue: 'RAW-207',
  },
  {
    id: 'shopify',
    name: 'Shopify',
    category: 'sales',
    tagline:
      'Sync orders, customers, and products plus revenue and order-volume metrics from a Shopify store.',
    icon: 'shopify',
    domain: 'shopify.com',
    requestIssue: 'RAW-427',
  },
  {
    id: 'zoominfo',
    name: 'ZoomInfo',
    category: 'sales',
    tagline: 'Sync enrichment and intent activity from a ZoomInfo account.',
    brandColor: '#E22B33',
    domain: 'zoominfo.com',
    requestIssue: 'RAW-240',
  },

  {
    id: 'bigcommerce',
    name: 'BigCommerce',
    category: 'sales',
    tagline: 'Sync orders, customers, and revenue from a BigCommerce store.',
    icon: 'bigcommerce',
    domain: 'bigcommerce.com',
  },
  {
    id: 'lemon-squeezy',
    name: 'Lemon Squeezy',
    category: 'sales',
    tagline: 'Sync orders, MRR, and refunds from a Lemon Squeezy store.',
    icon: 'lemonsqueezy',
    brandColor: '#FFC233',
    domain: 'lemonsqueezy.com',
  },
  {
    id: 'paddle',
    name: 'Paddle',
    category: 'sales',
    tagline: 'Sync transactions, MRR, and refunds from Paddle.',
    icon: 'paddle',
    domain: 'paddle.com',
  },
  {
    id: 'salesloft',
    name: 'Salesloft',
    category: 'sales',
    tagline: 'Sync cadences, prospects, and rep activity from Salesloft.',
    brandColor: '#003C7A',
    domain: 'salesloft.com',
  },
  {
    id: 'square',
    name: 'Square',
    category: 'sales',
    tagline: 'Sync orders, transactions, and revenue from a Square account.',
    icon: 'square',
    domain: 'squareup.com',
  },
  {
    id: 'woocommerce',
    name: 'WooCommerce',
    category: 'sales',
    tagline: 'Sync orders, customers, and revenue from a WooCommerce store.',
    icon: 'woocommerce',
    domain: 'woocommerce.com',
  },

  {
    id: 'adyen',
    name: 'Adyen',
    category: 'finance',
    tagline: 'Sync payments, refunds, and chargebacks from an Adyen account.',
    icon: 'adyen',
    domain: 'adyen.com',
  },
  {
    id: 'airbase',
    name: 'Airbase',
    category: 'finance',
    tagline:
      'Sync card transactions, AP automation, and spend by category from Airbase.',
    brandColor: '#16395A',
    domain: 'airbase.com',
  },
  {
    id: 'aws-ses',
    name: 'Amazon SES',
    category: 'engineering',
    tagline:
      'Sync send volume, delivery, bounce, and complaint rates from Amazon SES.',
    brandColor: '#FF9900',
    domain: 'aws.amazon.com',
    requestIssue: 'RAW-432',
  },
  {
    id: 'bamboohr',
    name: 'BambooHR',
    category: 'hr',
    tagline: 'Sync employees, tenure, time-off, and attrition from BambooHR.',
    brandColor: '#71B340',
    domain: 'bamboohr.com',
    requestIssue: 'RAW-246',
  },
  {
    id: 'ashby',
    name: 'Ashby',
    category: 'hr',
    tagline: 'Sync candidates, applications, and offer activity from Ashby.',
    brandColor: '#101010',
    domain: 'ashbyhq.com',
    requestIssue: 'RAW-245',
  },
  {
    id: 'lever',
    name: 'Lever',
    category: 'hr',
    tagline:
      'Sync candidates, opportunities, and pipeline progression from Lever.',
    brandColor: '#1F1F1F',
    domain: 'lever.co',
    requestIssue: 'RAW-244',
  },
  {
    id: 'rippling',
    name: 'Rippling',
    category: 'hr',
    tagline: 'Sync employees, departments, and time-off across Rippling.',
    brandColor: '#1A1A1A',
    domain: 'rippling.com',
    requestIssue: 'RAW-247',
  },
  {
    id: 'gusto',
    name: 'Gusto',
    category: 'hr',
    tagline: 'Sync employees, payroll runs, and pay-cycle spend from Gusto.',
    icon: 'gusto',
    domain: 'gusto.com',
    requestIssue: 'RAW-248',
  },
  {
    id: 'workday',
    name: 'Workday',
    category: 'hr',
    tagline: 'Sync workers, headcount, and attrition from Workday.',
    brandColor: '#0875E1',
    domain: 'workday.com',
    requestIssue: 'RAW-249',
  },
  {
    id: 'lattice',
    name: 'Lattice',
    category: 'hr',
    tagline: 'Sync reviews, goals, and engagement-score trends from Lattice.',
    brandColor: '#5750FF',
    domain: 'lattice.com',
    requestIssue: 'RAW-250',
  },
  {
    id: '15five',
    name: '15Five',
    category: 'hr',
    tagline: 'Sync check-ins, reviews, and completion rates from 15Five.',
    brandColor: '#FF6358',
    domain: '15five.com',
    requestIssue: 'RAW-251',
  },
  {
    id: 'cultureamp',
    name: 'Culture Amp',
    category: 'hr',
    tagline:
      'Sync engagement scores, eNPS, and survey response rates from Culture Amp.',
    brandColor: '#000000',
    domain: 'cultureamp.com',
    requestIssue: 'RAW-252',
  },
  {
    id: 'adp',
    name: 'ADP',
    category: 'hr',
    tagline:
      'Sync workers, payroll runs, and pay-cycle spend from ADP Workforce Now.',
    icon: 'adp',
    domain: 'adp.com',
    requestIssue: 'RAW-440',
  },
  {
    id: 'deel',
    name: 'Deel',
    category: 'hr',
    tagline:
      'Sync people, contracts, and payroll spend across countries from Deel.',
    brandColor: '#15D27C',
    domain: 'deel.com',
    requestIssue: 'RAW-439',
  },
  {
    id: 'paychex',
    name: 'Paychex',
    category: 'hr',
    tagline: 'Sync workers, payroll runs, and pay-cycle spend from Paychex.',
    icon: 'paychex',
    brandColor: '#0072CE',
    domain: 'paychex.com',
  },
  {
    id: 'paylocity',
    name: 'Paylocity',
    category: 'hr',
    tagline: 'Sync workers, payroll runs, and pay-cycle spend from Paylocity.',
    brandColor: '#1B5180',
    domain: 'paylocity.com',
  },
  {
    id: 'justworks',
    name: 'Justworks',
    category: 'hr',
    tagline: 'Sync employees, payroll, and benefits from Justworks.',
    brandColor: '#1A3F4C',
    domain: 'justworks.com',
  },
  {
    id: 'trinet',
    name: 'TriNet',
    category: 'hr',
    tagline: 'Sync employees, payroll, and benefits from TriNet.',
    brandColor: '#D6232C',
    domain: 'trinet.com',
  },
  {
    id: 'remote',
    name: 'Remote',
    category: 'hr',
    tagline:
      'Sync employees, contractors, and payroll spend across countries from Remote.',
    brandColor: '#625BF6',
    domain: 'remote.com',
  },
  {
    id: 'oyster',
    name: 'Oyster',
    category: 'hr',
    tagline:
      'Sync team members, contracts, and payroll spend across countries from Oyster.',
    brandColor: '#08243A',
    domain: 'oysterhr.com',
  },
  {
    id: 'checkr',
    name: 'Checkr',
    category: 'hr',
    tagline:
      'Sync background-check reports, status, and turnaround from Checkr.',
    brandColor: '#322987',
    domain: 'checkr.com',
  },
  {
    id: 'sterling',
    name: 'Sterling',
    category: 'hr',
    tagline:
      'Sync background-check reports, status, and turnaround from Sterling.',
    brandColor: '#003478',
    domain: 'sterlingcheck.com',
  },
  {
    id: 'docebo',
    name: 'Docebo',
    category: 'hr',
    tagline:
      'Sync course enrollments, completions, and compliance training from Docebo.',
    brandColor: '#FFA200',
    domain: 'docebo.com',
  },
  {
    id: 'linkedin-learning',
    name: 'LinkedIn Learning',
    category: 'hr',
    tagline:
      'Sync learner activity, course completions, and assignment progress from LinkedIn Learning.',
    brandColor: '#0A66C2',
    domain: 'linkedin.com',
  },

  {
    id: 'brex',
    name: 'Brex',
    category: 'finance',
    tagline:
      'Sync card transactions, spend by category, and budget usage from a Brex account.',
    icon: 'brex',
    domain: 'brex.com',
    requestIssue: 'RAW-220',
  },
  {
    id: 'bill',
    name: 'Bill.com',
    category: 'finance',
    tagline: 'Sync bills pending, AP aging, and vendor spend from Bill.com.',
    brandColor: '#005DAA',
    domain: 'bill.com',
    requestIssue: 'RAW-434',
  },
  {
    id: 'baremetrics',
    name: 'Baremetrics',
    category: 'finance',
    tagline:
      'Sync MRR, churn, ARPU, LTV, and cohort retention from Baremetrics.',
    icon: 'baremetrics',
    brandColor: '#0070FF',
    domain: 'baremetrics.com',
  },
  {
    id: 'braintree',
    name: 'Braintree',
    category: 'finance',
    tagline: 'Sync payments, refunds, and disputes from Braintree.',
    icon: 'braintree',
    brandColor: '#000000',
    domain: 'braintreepayments.com',
  },
  {
    id: 'causal',
    name: 'Causal',
    category: 'finance',
    tagline:
      'Sync model outputs, scenarios, and forecast vs actuals from a Causal model.',
    brandColor: '#0E4A8A',
    domain: 'causal.app',
  },
  {
    id: 'chargebee',
    name: 'Chargebee',
    category: 'finance',
    tagline:
      'Sync subscriptions, invoices, and MRR/churn metrics from a Chargebee site.',
    brandColor: '#FF7B45',
    domain: 'chargebee.com',
    requestIssue: 'RAW-215',
  },
  {
    id: 'chartmogul',
    name: 'ChartMogul',
    category: 'finance',
    tagline: 'Sync MRR, churn, ARPU, and cohort retention from ChartMogul.',
    icon: 'chartmogul',
    brandColor: '#FF3266',
    domain: 'chartmogul.com',
  },
  {
    id: 'crypto-coingecko',
    name: 'CoinGecko',
    category: 'finance',
    tagline:
      'Sync prices and market caps for a watched set of cryptocurrencies from CoinGecko.',
    brandColor: '#8DC647',
    domain: 'coingecko.com',
  },
  {
    id: 'expensify',
    name: 'Expensify',
    category: 'finance',
    tagline:
      'Sync reports, expense submissions, and policy violations from Expensify.',
    icon: 'expensify',
    domain: 'expensify.com',
    requestIssue: 'RAW-435',
  },
  {
    id: 'fixer',
    name: 'Fixer (FX rates)',
    category: 'finance',
    tagline:
      'Sync foreign-exchange rates from Fixer for multi-currency dashboards.',
    brandColor: '#1C1C1E',
    domain: 'fixer.io',
  },
  {
    id: 'freshbooks',
    name: 'FreshBooks',
    category: 'finance',
    tagline: 'Sync invoices, expenses, and revenue from FreshBooks.',
    brandColor: '#1CBC9C',
    domain: 'freshbooks.com',
  },
  {
    id: 'gocardless',
    name: 'GoCardless',
    category: 'finance',
    tagline: 'Sync mandates, payments, and failures from GoCardless.',
    brandColor: '#1AA5E1',
    domain: 'gocardless.com',
  },
  {
    id: 'mercury',
    name: 'Mercury',
    category: 'finance',
    tagline:
      'Sync account balances and transactions from a Mercury banking account.',
    brandColor: '#5266EB',
    domain: 'mercury.com',
    requestIssue: 'RAW-222',
  },
  {
    id: 'navan',
    name: 'Navan',
    category: 'finance',
    tagline:
      'Sync travel and expense spend by category and traveler from Navan.',
    brandColor: '#1A1A1A',
    domain: 'navan.com',
  },
  {
    id: 'netsuite',
    name: 'NetSuite',
    category: 'finance',
    tagline: 'Sync invoices, transactions, and P&L from a NetSuite tenant.',
    brandColor: '#00467F',
    domain: 'netsuite.com',
    requestIssue: 'RAW-219',
  },
  {
    id: 'paypal',
    name: 'PayPal',
    category: 'finance',
    tagline:
      'Sync transactions, refunds, and balance from a PayPal business account.',
    icon: 'paypal',
    domain: 'paypal.com',
  },
  {
    id: 'plaid',
    name: 'Plaid',
    category: 'finance',
    tagline:
      'Sync linked accounts, balances, and categorized transactions across banks via Plaid.',
    brandColor: '#111111',
    domain: 'plaid.com',
    requestIssue: 'RAW-436',
  },
  {
    id: 'pleo',
    name: 'Pleo',
    category: 'finance',
    tagline:
      'Sync card transactions, spend by category, and pocket money from Pleo.',
    brandColor: '#EB6FBD',
    domain: 'pleo.io',
  },
  {
    id: 'profitwell',
    name: 'ProfitWell (Paddle Metrics)',
    category: 'finance',
    tagline: 'Sync MRR, churn, ARPU, and cohort retention from ProfitWell.',
    brandColor: '#21B287',
    domain: 'profitwell.com',
  },
  {
    id: 'quickbooks',
    name: 'QuickBooks',
    category: 'finance',
    tagline:
      'Sync invoices, expenses, and profit-and-loss figures from QuickBooks Online.',
    icon: 'quickbooks',
    domain: 'quickbooks.intuit.com',
    requestIssue: 'RAW-217',
  },
  {
    id: 'ramp',
    name: 'Ramp',
    category: 'finance',
    tagline:
      'Sync card transactions, spend by category, and budget usage from a Ramp account.',
    brandColor: '#1A1A1A',
    domain: 'ramp.com',
    requestIssue: 'RAW-221',
  },
  {
    id: 'recurly',
    name: 'Recurly',
    category: 'finance',
    tagline:
      'Sync subscriptions, invoices, and MRR/churn metrics from Recurly.',
    brandColor: '#F8423A',
    domain: 'recurly.com',
    requestIssue: 'RAW-216',
  },
  {
    id: 'sage-intacct',
    name: 'Sage Intacct',
    category: 'finance',
    tagline: 'Sync invoices, expenses, and P&L from Sage Intacct.',
    icon: 'sage',
    domain: 'sage.com',
  },
  {
    id: 'soldo',
    name: 'Soldo',
    category: 'finance',
    tagline: 'Sync card transactions and spend by team from Soldo.',
    brandColor: '#FF5151',
    domain: 'soldo.com',
  },
  {
    id: 'spendesk',
    name: 'Spendesk',
    category: 'finance',
    tagline:
      'Sync card transactions, requests, and per-team spend from Spendesk.',
    brandColor: '#1F1F4E',
    domain: 'spendesk.com',
  },
  {
    id: 'subscript',
    name: 'Subscript',
    category: 'finance',
    tagline: 'Sync MRR, churn, and revenue waterfall from Subscript.',
    brandColor: '#3F2DFF',
    domain: 'subscript.com',
  },
  {
    id: 'tipalti',
    name: 'Tipalti',
    category: 'finance',
    tagline: 'Sync bills, payments, and supplier activity from Tipalti.',
    brandColor: '#161A2E',
    domain: 'tipalti.com',
  },
  {
    id: 'wave',
    name: 'Wave Accounting',
    category: 'finance',
    tagline: 'Sync invoices, expenses, and revenue from Wave.',
    brandColor: '#27488A',
    domain: 'waveapps.com',
  },
  {
    id: 'xero',
    name: 'Xero',
    category: 'finance',
    tagline:
      'Sync invoices, bills, and profit-and-loss figures from a Xero organization.',
    icon: 'xero',
    domain: 'xero.com',
    requestIssue: 'RAW-218',
  },
  {
    id: 'zoho-books',
    name: 'Zoho Books',
    category: 'finance',
    tagline: 'Sync invoices, expenses, and revenue from Zoho Books.',
    icon: 'zoho',
    domain: 'zoho.com',
  },
  {
    id: 'avalara',
    name: 'Avalara',
    category: 'finance',
    tagline:
      'Sync tax liability by jurisdiction and filing status from Avalara.',
    brandColor: '#FF5616',
    domain: 'avalara.com',
  },
  {
    id: 'anrok',
    name: 'Anrok',
    category: 'finance',
    tagline:
      'Sync sales-tax liability and filing status for SaaS revenue from Anrok.',
    brandColor: '#000000',
    domain: 'anrok.com',
  },
  {
    id: 'carta',
    name: 'Carta',
    category: 'finance',
    tagline:
      'Sync shareholders, option grants, and dilution across rounds from Carta.',
    brandColor: '#FE6027',
    domain: 'carta.com',
  },
  {
    id: 'pilot',
    name: 'Pilot',
    category: 'finance',
    tagline:
      'Sync monthly financial summaries and bookkeeping status from Pilot.',
    brandColor: '#2E62F3',
    domain: 'pilot.com',
  },

  {
    id: 'mailgun',
    name: 'Mailgun',
    category: 'engineering',
    tagline:
      'Sync transactional email send volume, delivery, bounce, and complaint rates from Mailgun.',
    icon: 'mailgun',
    domain: 'mailgun.com',
    requestIssue: 'RAW-431',
  },
  {
    id: 'postmark',
    name: 'Postmark',
    category: 'engineering',
    tagline:
      'Sync transactional email send volume, delivery, bounce, and complaint rates from Postmark.',
    brandColor: '#FFCC00',
    domain: 'postmarkapp.com',
    requestIssue: 'RAW-430',
  },
  {
    id: 'resend',
    name: 'Resend',
    category: 'engineering',
    tagline:
      'Sync transactional email send volume, delivery, bounce, and complaint rates from Resend.',
    icon: 'resend',
    domain: 'resend.com',
    requestIssue: 'RAW-433',
  },
  {
    id: 'sendgrid',
    name: 'SendGrid',
    category: 'engineering',
    tagline:
      'Sync transactional email send volume, delivery, bounce, and complaint rates from SendGrid.',
    brandColor: '#1A82E2',
    domain: 'sendgrid.com',
    requestIssue: 'RAW-429',
  },
  {
    id: 'twilio',
    name: 'Twilio',
    category: 'engineering',
    tagline:
      'Sync SMS, voice, and verify usage with delivery and error rates from Twilio.',
    brandColor: '#F22F46',
    domain: 'twilio.com',
    requestIssue: 'RAW-428',
  },
  {
    id: 'sonarqube',
    name: 'SonarQube',
    category: 'engineering',
    tagline:
      'Sync code quality issues, coverage, and per-project quality gates from a SonarQube server.',
    brandColor: '#4E9BCD',
    domain: 'sonarsource.com',
  },
  {
    id: 'qodana',
    name: 'Qodana',
    category: 'engineering',
    tagline:
      'Sync code inspection results, coverage, and quality gates from JetBrains Qodana.',
    brandColor: '#FA1F8E',
    domain: 'jetbrains.com',
  },
  {
    id: 'zephyr-scale',
    name: 'Zephyr Scale',
    category: 'engineering',
    tagline:
      'Sync test cases, executions, and pass/fail breakdowns from Zephyr Scale.',
    brandColor: '#00A4E4',
    domain: 'smartbear.com',
  },
  {
    id: 'qtest',
    name: 'qTest',
    category: 'engineering',
    tagline:
      'Sync test runs, defects, and execution coverage from Tricentis qTest.',
    brandColor: '#00B4A0',
    domain: 'tricentis.com',
  },
  {
    id: 'xray',
    name: 'Xray Test Management',
    category: 'engineering',
    tagline: 'Sync test runs, coverage, and defect linkage from Xray for Jira.',
    brandColor: '#5E0EBB',
    domain: 'getxray.app',
  },
  {
    id: 'semaphoreci',
    name: 'Semaphore CI',
    category: 'engineering',
    tagline: 'Sync pipelines, builds, and per-job duration from Semaphore CI.',
    icon: 'semaphoreci',
    domain: 'semaphoreci.com',
  },
  {
    id: 'drone-ci',
    name: 'Drone CI',
    category: 'engineering',
    tagline: 'Sync pipelines, builds, and per-stage durations from Drone CI.',
    icon: 'drone',
    domain: 'drone.io',
  },
  {
    id: 'woodpecker-ci',
    name: 'Woodpecker CI',
    category: 'engineering',
    tagline: 'Sync pipelines, builds, and per-step results from Woodpecker CI.',
    brandColor: '#4CAF50',
    domain: 'woodpecker-ci.org',
  },
  {
    id: 'travis-ci',
    name: 'Travis CI',
    category: 'engineering',
    tagline: 'Sync builds, jobs, and pass/fail rates from Travis CI.',
    icon: 'travisci',
    domain: 'travis-ci.com',
  },
  {
    id: 'teamcity',
    name: 'TeamCity',
    category: 'engineering',
    tagline:
      'Sync builds, agents, and per-configuration health from JetBrains TeamCity.',
    icon: 'teamcity',
    domain: 'jetbrains.com',
  },
  {
    id: 'azure-pipelines',
    name: 'Azure Pipelines',
    category: 'engineering',
    tagline:
      'Sync pipelines, runs, and per-stage durations from Azure DevOps Pipelines.',
    brandColor: '#2560E0',
    domain: 'azure.microsoft.com',
  },
  {
    id: 'browserstack',
    name: 'BrowserStack',
    category: 'engineering',
    tagline:
      'Sync automated test sessions, pass/fail rates, and parallel usage from BrowserStack.',
    brandColor: '#FF6C37',
    domain: 'browserstack.com',
  },
  {
    id: 'saucelabs',
    name: 'Sauce Labs',
    category: 'engineering',
    tagline:
      'Sync automated test sessions, pass/fail rates, and minute usage from Sauce Labs.',
    icon: 'saucelabs',
    brandColor: '#E2231A',
    domain: 'saucelabs.com',
  },
  {
    id: 'lambdatest',
    name: 'LambdaTest',
    category: 'engineering',
    tagline:
      'Sync automated and manual test sessions, pass/fail rates, and concurrency from LambdaTest.',
    brandColor: '#0EBAC5',
    domain: 'lambdatest.com',
  },
  {
    id: 'percy',
    name: 'Percy',
    category: 'engineering',
    tagline:
      'Sync visual snapshots, review status, and diff counts from Percy.',
    icon: 'percy',
    brandColor: '#9E1D8E',
    domain: 'percy.io',
  },
  {
    id: 'applitools',
    name: 'Applitools',
    category: 'engineering',
    tagline:
      'Sync visual AI checkpoints, diffs, and test runs from Applitools.',
    brandColor: '#00A39B',
    domain: 'applitools.com',
  },
  {
    id: 'chromatic',
    name: 'Chromatic',
    category: 'engineering',
    tagline:
      'Sync component snapshots, review status, and visual regressions from Chromatic.',
    icon: 'chromatic',
    brandColor: '#FC521F',
    domain: 'chromatic.com',
  },
  {
    id: 'checkmarx',
    name: 'Checkmarx',
    category: 'engineering',
    tagline:
      'Sync SAST findings, severity counts, and scan coverage from Checkmarx.',
    icon: 'checkmarx',
    domain: 'checkmarx.com',
  },
  {
    id: 'veracode',
    name: 'Veracode',
    category: 'engineering',
    tagline:
      'Sync application scans, flaw distribution, and policy compliance from Veracode.',
    brandColor: '#003C5B',
    domain: 'veracode.com',
  },
  {
    id: 'appdynamics',
    name: 'AppDynamics',
    category: 'engineering',
    tagline:
      'Sync application performance, business transactions, and error counts from AppDynamics.',
    brandColor: '#0070D2',
    domain: 'appdynamics.com',
  },
  {
    id: 'raygun',
    name: 'Raygun',
    category: 'engineering',
    tagline:
      'Sync errors, occurrence counts, and real-user monitoring data from Raygun.',
    brandColor: '#E03426',
    domain: 'raygun.com',
  },
  {
    id: 'instabug',
    name: 'Instabug',
    category: 'engineering',
    tagline:
      'Sync mobile crashes, bug reports, and session counts from Instabug.',
    brandColor: '#F4385E',
    domain: 'instabug.com',
  },
  {
    id: 'logz-io',
    name: 'Logz.io',
    category: 'engineering',
    tagline: 'Sync log volumes, alerts, and per-source rates from Logz.io.',
    brandColor: '#0AB7E6',
    domain: 'logz.io',
  },
  {
    id: 'coralogix',
    name: 'Coralogix',
    category: 'engineering',
    tagline:
      'Sync log volumes, alerts, and per-application rates from Coralogix.',
    brandColor: '#7A37C8',
    domain: 'coralogix.com',
  },
  {
    id: 'loggly',
    name: 'Loggly',
    category: 'engineering',
    tagline:
      'Sync log volumes, error counts, and per-source rates from SolarWinds Loggly.',
    brandColor: '#F99D1C',
    domain: 'loggly.com',
  },
  {
    id: 'papertrail',
    name: 'Papertrail',
    category: 'engineering',
    tagline:
      'Sync log volumes, alert counts, and per-system rates from Papertrail.',
    brandColor: '#5B5B5B',
    domain: 'papertrail.com',
  },
  {
    id: 'better-stack-logs',
    name: 'Better Stack Logs',
    category: 'engineering',
    tagline: 'Sync log volumes, queries, and alerts from Better Stack Logs.',
    icon: 'betterstack',
    domain: 'betterstack.com',
  },
  {
    id: 'lightstep',
    name: 'Lightstep',
    category: 'engineering',
    tagline:
      'Sync trace volume, service latency, and error rate from Lightstep.',
    brandColor: '#00B5AD',
    domain: 'lightstep.com',
  },
  {
    id: 'aspecto',
    name: 'Aspecto',
    category: 'engineering',
    tagline: 'Sync OpenTelemetry traces, latency, and error rate from Aspecto.',
    brandColor: '#1A1A2E',
    domain: 'aspecto.io',
  },
  {
    id: 'helios',
    name: 'Helios',
    category: 'engineering',
    tagline:
      'Sync distributed traces, errors, and request latency from Helios.',
    brandColor: '#FF6B35',
    domain: 'gethelios.dev',
    monogram: true,
  },
  {
    id: 'pingdom',
    name: 'Pingdom',
    category: 'engineering',
    tagline:
      'Sync uptime, response time, and page-load performance from Pingdom.',
    icon: 'pingdom',
    domain: 'pingdom.com',
  },
  {
    id: 'uptimerobot',
    name: 'UptimeRobot',
    category: 'engineering',
    tagline:
      'Sync monitor uptime, response time, and incident counts from UptimeRobot.',
    brandColor: '#52B956',
    domain: 'uptimerobot.com',
  },
  {
    id: 'statuscake',
    name: 'StatusCake',
    category: 'engineering',
    tagline:
      'Sync monitor uptime, response time, and downtime events from StatusCake.',
    brandColor: '#FFCC00',
    domain: 'statuscake.com',
  },
  {
    id: 'checkly',
    name: 'Checkly',
    category: 'engineering',
    tagline:
      'Sync synthetic check results, uptime, and API performance from Checkly.',
    brandColor: '#0075FF',
    domain: 'checklyhq.com',
  },
  {
    id: 'site24x7',
    name: 'Site24x7',
    category: 'engineering',
    tagline:
      'Sync monitor uptime, response time, and infrastructure health from Site24x7.',
    brandColor: '#F89D2E',
    domain: 'site24x7.com',
  },
  {
    id: 'sematext',
    name: 'Sematext',
    category: 'engineering',
    tagline: 'Sync logs, metrics, and synthetic monitor results from Sematext.',
    brandColor: '#FF6E42',
    domain: 'sematext.com',
  },
  {
    id: 'freshping',
    name: 'Freshping',
    category: 'engineering',
    tagline:
      'Sync monitor uptime, response time, and incidents from Freshping.',
    brandColor: '#26A69A',
    domain: 'freshping.io',
  },
  {
    id: 'better-stack-uptime',
    name: 'Better Stack Uptime',
    category: 'engineering',
    tagline:
      'Sync monitor uptime, incidents, and on-call activity from Better Stack Uptime.',
    icon: 'betterstack',
    domain: 'betterstack.com',
  },
  {
    id: 'status-io',
    name: 'Status.io',
    category: 'engineering',
    tagline:
      'Sync incidents, component status, and uptime from a Status.io page.',
    brandColor: '#4A90E2',
    domain: 'status.io',
  },
  {
    id: 'hund',
    name: 'Hund',
    category: 'engineering',
    tagline:
      'Sync incidents, component status, and uptime from a Hund status page.',
    brandColor: '#1E3A5F',
    domain: 'hund.io',
  },
  {
    id: 'healthchecks-io',
    name: 'Healthchecks.io',
    category: 'engineering',
    tagline:
      'Sync cron-job health, missed pings, and per-check status from Healthchecks.io.',
    brandColor: '#5BAF6E',
    domain: 'healthchecks.io',
  },
  {
    id: 'cronitor',
    name: 'Cronitor',
    category: 'engineering',
    tagline:
      'Sync cron-job health, missed runs, and incident counts from Cronitor.',
    brandColor: '#FFB81C',
    domain: 'cronitor.io',
  },
  {
    id: 'npm-trends',
    name: 'npm trends',
    category: 'engineering',
    tagline:
      'Sync comparative weekly download trends across npm packages from npm trends.',
    brandColor: '#CB3837',
    domain: 'npmtrends.com',
    monogram: true,
  },

  {
    id: 'linode',
    name: 'Linode',
    category: 'infrastructure',
    tagline:
      'Sync instances, volumes, and monthly spend from a Linode (Akamai) account.',
    brandColor: '#00A95C',
    domain: 'linode.com',
  },
  {
    id: 'hetzner',
    name: 'Hetzner Cloud',
    category: 'infrastructure',
    tagline:
      'Sync servers, volumes, and monthly spend from a Hetzner Cloud account.',
    icon: 'hetzner',
    domain: 'hetzner.com',
  },
  {
    id: 'vultr',
    name: 'Vultr',
    category: 'infrastructure',
    tagline:
      'Sync instances, block storage, and monthly spend from a Vultr account.',
    icon: 'vultr',
    domain: 'vultr.com',
  },
  {
    id: 'scaleway',
    name: 'Scaleway',
    category: 'infrastructure',
    tagline:
      'Sync instances, object storage, and monthly spend from a Scaleway account.',
    icon: 'scaleway',
    domain: 'scaleway.com',
  },
  {
    id: 'ovhcloud',
    name: 'OVHcloud',
    category: 'infrastructure',
    tagline:
      'Sync instances, storage, and monthly spend from an OVHcloud account.',
    icon: 'ovh',
    domain: 'ovhcloud.com',
  },
  {
    id: 'aiven',
    name: 'Aiven',
    category: 'infrastructure',
    tagline:
      'Sync managed-database services, plans, and monthly spend from Aiven.',
    brandColor: '#FF6900',
    domain: 'aiven.io',
  },
  {
    id: 'elastic-cloud',
    name: 'Elastic Cloud',
    category: 'infrastructure',
    tagline:
      'Sync deployments, indices, and ingest rates from an Elastic Cloud account.',
    icon: 'elasticcloud',
    domain: 'elastic.co',
  },
  {
    id: 'aws-dynamodb',
    name: 'Amazon DynamoDB',
    category: 'infrastructure',
    tagline:
      'Sync table read/write capacity, throttles, and storage from Amazon DynamoDB.',
    brandColor: '#4053D6',
    domain: 'aws.amazon.com',
  },
  {
    id: 'cassandra',
    name: 'Apache Cassandra',
    category: 'infrastructure',
    tagline:
      'Sync cluster nodes, read/write throughput, and latency from an Apache Cassandra cluster.',
    icon: 'apachecassandra',
    domain: 'cassandra.apache.org',
  },
  {
    id: 'couchbase',
    name: 'Couchbase',
    category: 'infrastructure',
    tagline:
      'Sync buckets, document counts, and operations-per-second from Couchbase.',
    icon: 'couchbase',
    domain: 'couchbase.com',
  },
  {
    id: 'fauna',
    name: 'Fauna',
    category: 'infrastructure',
    tagline:
      'Sync database read/write ops, storage, and per-collection counts from Fauna.',
    icon: 'fauna',
    domain: 'fauna.com',
  },
  {
    id: 'xata',
    name: 'Xata',
    category: 'infrastructure',
    tagline: 'Sync databases, branches, and per-table row counts from Xata.',
    brandColor: '#9F87FF',
    domain: 'xata.io',
  },
  {
    id: 'motherduck',
    name: 'MotherDuck',
    category: 'infrastructure',
    tagline:
      'Sync databases, query usage, and storage from a MotherDuck workspace.',
    brandColor: '#FFD23F',
    domain: 'motherduck.com',
  },
  {
    id: 'firebolt',
    name: 'Firebolt',
    category: 'analytics',
    tagline:
      'Run scheduled SQL against Firebolt and sync the result rows as a metric or entity series.',
    brandColor: '#FE3464',
    domain: 'firebolt.io',
  },
  {
    id: 'typesense',
    name: 'Typesense',
    category: 'infrastructure',
    tagline:
      'Sync collection sizes, query counts, and latency from a Typesense cluster.',
    brandColor: '#DA4167',
    domain: 'typesense.org',
  },
  {
    id: 'meilisearch',
    name: 'Meilisearch',
    category: 'infrastructure',
    tagline:
      'Sync index sizes, search query counts, and latency from Meilisearch.',
    icon: 'meilisearch',
    domain: 'meilisearch.com',
  },
  {
    id: 'redpanda',
    name: 'Redpanda',
    category: 'infrastructure',
    tagline:
      'Sync topic message rates, consumer lag, and cluster throughput from Redpanda.',
    brandColor: '#E8485B',
    domain: 'redpanda.com',
  },
  {
    id: 'aws-msk',
    name: 'Amazon MSK',
    category: 'infrastructure',
    tagline:
      'Sync Kafka topic throughput, consumer lag, and broker health from Amazon MSK.',
    brandColor: '#FF9900',
    domain: 'aws.amazon.com',
  },
  {
    id: 'materialize',
    name: 'Materialize',
    category: 'infrastructure',
    tagline:
      'Sync materialized view freshness, source lag, and per-cluster throughput from Materialize.',
    brandColor: '#7F4EFF',
    domain: 'materialize.com',
  },
  {
    id: 'risingwave',
    name: 'RisingWave',
    category: 'infrastructure',
    tagline: 'Sync streaming jobs, source lag, and throughput from RisingWave.',
    brandColor: '#005EFF',
    domain: 'risingwave.com',
  },
  {
    id: 'decodable',
    name: 'Decodable',
    category: 'infrastructure',
    tagline:
      'Sync stream pipelines, throughput, and connector status from Decodable.',
    brandColor: '#FF5C39',
    domain: 'decodable.co',
  },
  {
    id: 'akamai',
    name: 'Akamai',
    category: 'infrastructure',
    tagline:
      'Sync requests, cache-hit ratio, and origin performance from Akamai.',
    icon: 'akamai',
    domain: 'akamai.com',
  },
  {
    id: 'bunnycdn',
    name: 'BunnyCDN',
    category: 'infrastructure',
    tagline:
      'Sync requests, bandwidth, and cache-hit ratio across zones from BunnyCDN.',
    brandColor: '#FF8D00',
    domain: 'bunny.net',
  },
  {
    id: 'keycdn',
    name: 'KeyCDN',
    category: 'infrastructure',
    tagline:
      'Sync requests, bandwidth, and cache-hit ratio across zones from KeyCDN.',
    icon: 'keycdn',
    domain: 'keycdn.com',
  },
  {
    id: 'aws-route53',
    name: 'Amazon Route 53',
    category: 'infrastructure',
    tagline:
      'Sync hosted zones, query volume, and health-check status from Amazon Route 53.',
    brandColor: '#8C4FFF',
    domain: 'aws.amazon.com',
  },
  {
    id: 'ns1',
    name: 'NS1',
    category: 'infrastructure',
    tagline: 'Sync zones, query volume, and health-check status from NS1.',
    brandColor: '#1B1F3B',
    domain: 'ns1.com',
    monogram: true,
  },
  {
    id: 'dnsimple',
    name: 'DNSimple',
    category: 'infrastructure',
    tagline: 'Sync domains, query volume, and renewal status from DNSimple.',
    brandColor: '#1A8FE3',
    domain: 'dnsimple.com',
  },
  {
    id: 'cloudinary',
    name: 'Cloudinary',
    category: 'infrastructure',
    tagline:
      'Sync transformations, bandwidth, and storage from a Cloudinary account.',
    icon: 'cloudinary',
    domain: 'cloudinary.com',
  },
  {
    id: 'imgix',
    name: 'imgix',
    category: 'infrastructure',
    tagline:
      'Sync transformations, bandwidth, and origin reads from an imgix source.',
    brandColor: '#000000',
    domain: 'imgix.com',
  },

  {
    id: 'lokalise',
    name: 'Lokalise',
    category: 'engineering',
    tagline:
      'Sync translation progress, untranslated key counts, and reviewer activity from Lokalise.',
    brandColor: '#2B53FF',
    domain: 'lokalise.com',
  },
  {
    id: 'phrase',
    name: 'Phrase',
    category: 'engineering',
    tagline:
      'Sync translation progress, untranslated key counts, and contributor activity from Phrase.',
    brandColor: '#2EAFB7',
    domain: 'phrase.com',
  },
  {
    id: 'crowdin',
    name: 'Crowdin',
    category: 'engineering',
    tagline:
      'Sync translation progress, untranslated string counts, and contributor activity from Crowdin.',
    icon: 'crowdin',
    domain: 'crowdin.com',
  },
  {
    id: 'smartling',
    name: 'Smartling',
    category: 'engineering',
    tagline:
      'Sync translation progress, jobs, and cost-per-word from Smartling.',
    brandColor: '#1C8DC7',
    domain: 'smartling.com',
  },
  {
    id: 'transifex',
    name: 'Transifex',
    category: 'engineering',
    tagline:
      'Sync translation progress, untranslated string counts, and reviewer activity from Transifex.',
    icon: 'transifex',
    domain: 'transifex.com',
  },

  {
    id: 'hashicorp-vault',
    name: 'HashiCorp Vault',
    category: 'security',
    tagline:
      'Sync secret counts, lease activity, and policy usage from HashiCorp Vault.',
    brandColor: '#000000',
    domain: 'vaultproject.io',
  },
  {
    id: 'doppler',
    name: 'Doppler',
    category: 'security',
    tagline:
      'Sync project, environment, and secret counts plus rotation activity from Doppler.',
    brandColor: '#3391FF',
    domain: 'doppler.com',
  },
  {
    id: 'infisical',
    name: 'Infisical',
    category: 'security',
    tagline:
      'Sync project, environment, and secret counts plus rotation activity from Infisical.',
    brandColor: '#EBF852',
    domain: 'infisical.com',
  },
  {
    id: 'bitwarden',
    name: 'Bitwarden',
    category: 'security',
    tagline:
      'Sync vault item counts, organization seats, and watchtower findings from Bitwarden.',
    icon: 'bitwarden',
    domain: 'bitwarden.com',
  },
  {
    id: 'lastpass',
    name: 'LastPass',
    category: 'security',
    tagline: 'Sync vault item counts, seats, and security score from LastPass.',
    icon: 'lastpass',
    domain: 'lastpass.com',
  },
  {
    id: 'dashlane',
    name: 'Dashlane',
    category: 'security',
    tagline:
      'Sync vault item counts, seats, and password health from Dashlane.',
    icon: 'dashlane',
    domain: 'dashlane.com',
  },
  {
    id: 'keeper',
    name: 'Keeper Security',
    category: 'security',
    tagline:
      'Sync vault item counts, seats, and security audit findings from Keeper.',
    icon: 'keeper',
    domain: 'keepersecurity.com',
  },
  {
    id: 'hyperproof',
    name: 'Hyperproof',
    category: 'security',
    tagline:
      'Sync control status, evidence freshness, and audit readiness from Hyperproof.',
    brandColor: '#0061A0',
    domain: 'hyperproof.io',
  },
  {
    id: 'zengrc',
    name: 'ZenGRC',
    category: 'security',
    tagline:
      'Sync control status, audit readiness, and evidence coverage from ZenGRC.',
    brandColor: '#5CC8C2',
    domain: 'zengrc.com',
  },
  {
    id: 'onetrust',
    name: 'OneTrust',
    category: 'security',
    tagline: 'Sync DSARs, consent status, and risk findings from OneTrust.',
    brandColor: '#41C0CB',
    domain: 'onetrust.com',
  },
  {
    id: 'cookiebot',
    name: 'Cookiebot',
    category: 'security',
    tagline:
      'Sync consent rates, banner views, and scan findings from Cookiebot.',
    brandColor: '#62D58C',
    domain: 'cookiebot.com',
  },
  {
    id: 'iubenda',
    name: 'Iubenda',
    category: 'security',
    tagline:
      'Sync consent rates, policy views, and compliance status from Iubenda.',
    brandColor: '#1CC691',
    domain: 'iubenda.com',
  },
  {
    id: 'didomi',
    name: 'Didomi',
    category: 'security',
    tagline:
      'Sync consent rates, notice views, and compliance signals from Didomi.',
    brandColor: '#1F2A37',
    domain: 'didomi.io',
  },
  {
    id: 'termly',
    name: 'Termly',
    category: 'security',
    tagline: 'Sync consent rates and policy view counts from Termly.',
    brandColor: '#3B5BDB',
    domain: 'termly.io',
  },
  {
    id: 'osano',
    name: 'Osano',
    category: 'security',
    tagline: 'Sync consent rates, DSARs, and vendor risk scores from Osano.',
    icon: 'osano',
    domain: 'osano.com',
  },
  {
    id: 'nightfall',
    name: 'Nightfall',
    category: 'security',
    tagline:
      'Sync DLP findings, sensitive-data detections, and policy violations from Nightfall.',
    brandColor: '#9F4DFF',
    domain: 'nightfall.ai',
    monogram: true,
  },
  {
    id: 'cyberhaven',
    name: 'Cyberhaven',
    category: 'security',
    tagline:
      'Sync data flow events, insider risk signals, and policy violations from Cyberhaven.',
    brandColor: '#3D2BFF',
    domain: 'cyberhaven.com',
  },
  {
    id: 'hackerone',
    name: 'HackerOne',
    category: 'security',
    tagline:
      'Sync reports, severity distribution, bounty spend, and resolution times from HackerOne.',
    icon: 'hackerone',
    domain: 'hackerone.com',
  },
  {
    id: 'bugcrowd',
    name: 'Bugcrowd',
    category: 'security',
    tagline:
      'Sync submissions, severity distribution, bounty spend, and resolution times from Bugcrowd.',
    icon: 'bugcrowd',
    domain: 'bugcrowd.com',
  },
  {
    id: 'intigriti',
    name: 'Intigriti',
    category: 'security',
    tagline:
      'Sync submissions, severity distribution, and bounty spend from Intigriti.',
    icon: 'intigriti',
    domain: 'intigriti.com',
  },
  {
    id: 'cobalt',
    name: 'Cobalt',
    category: 'security',
    tagline: 'Sync pentests, findings, and remediation progress from Cobalt.',
    icon: 'cobalt',
    domain: 'cobalt.io',
  },
  {
    id: 'fossa',
    name: 'FOSSA',
    category: 'security',
    tagline:
      'Sync open-source dependency issues, license violations, and SBOM coverage from FOSSA.',
    icon: 'fossa',
    domain: 'fossa.com',
  },
  {
    id: 'mend',
    name: 'Mend',
    category: 'security',
    tagline:
      'Sync open-source dependency vulnerabilities, license issues, and remediation from Mend.',
    brandColor: '#7C3AED',
    domain: 'mend.io',
  },
  {
    id: 'blackduck',
    name: 'Black Duck',
    category: 'security',
    tagline:
      'Sync open-source components, vulnerabilities, and license findings from Black Duck.',
    brandColor: '#000000',
    domain: 'blackduck.com',
  },
  {
    id: 'jupiterone',
    name: 'JupiterOne',
    category: 'security',
    tagline:
      'Sync asset counts, policy compliance, and security findings from JupiterOne.',
    brandColor: '#1A2533',
    domain: 'jupiterone.com',
  },
  {
    id: 'panther',
    name: 'Panther',
    category: 'security',
    tagline: 'Sync detections, alerts, and rule activity from Panther.',
    brandColor: '#7C3AED',
    domain: 'panther.com',
  },

  {
    id: 'stytch',
    name: 'Stytch',
    category: 'security',
    tagline: 'Sync users, sign-ups, and authentication activity from Stytch.',
    brandColor: '#0577F2',
    domain: 'stytch.com',
  },
  {
    id: 'frontegg',
    name: 'Frontegg',
    category: 'security',
    tagline: 'Sync tenants, users, and sign-in activity from Frontegg.',
    brandColor: '#9747FF',
    domain: 'frontegg.com',
  },
  {
    id: 'supertokens',
    name: 'SuperTokens',
    category: 'security',
    tagline: 'Sync users, sessions, and sign-in activity from SuperTokens.',
    brandColor: '#FF9933',
    domain: 'supertokens.com',
  },
  {
    id: 'onelogin',
    name: 'OneLogin',
    category: 'security',
    tagline:
      'Sync users, sign-ins, and MFA enrollment from a OneLogin account.',
    brandColor: '#1C1F2B',
    domain: 'onelogin.com',
  },
  {
    id: 'jumpcloud',
    name: 'JumpCloud',
    category: 'security',
    tagline: 'Sync users, devices, and SSO sign-in activity from JumpCloud.',
    brandColor: '#16ABDE',
    domain: 'jumpcloud.com',
  },
  {
    id: 'descope',
    name: 'Descope',
    category: 'security',
    tagline: 'Sync users, sign-ups, and authentication activity from Descope.',
    brandColor: '#3F8CFF',
    domain: 'descope.com',
  },
  {
    id: 'firebase-auth',
    name: 'Firebase Auth',
    category: 'security',
    tagline:
      'Sync user counts, sign-ups, and provider-mix from Firebase Authentication.',
    icon: 'firebase',
    domain: 'firebase.google.com',
  },
  {
    id: 'aws-cognito',
    name: 'Amazon Cognito',
    category: 'security',
    tagline:
      'Sync user pools, sign-ups, MFA adoption, and sign-in activity from Amazon Cognito.',
    brandColor: '#DD344C',
    domain: 'aws.amazon.com',
  },
  {
    id: 'keycloak',
    name: 'Keycloak',
    category: 'security',
    tagline: 'Sync realms, users, and sign-in activity from a Keycloak server.',
    icon: 'keycloak',
    domain: 'keycloak.org',
  },
  {
    id: 'ory',
    name: 'Ory',
    category: 'security',
    tagline:
      'Sync identities, sessions, and sign-in activity from an Ory project.',
    icon: 'ory',
    domain: 'ory.sh',
  },
  {
    id: 'fusionauth',
    name: 'FusionAuth',
    category: 'security',
    tagline:
      'Sync users, sign-ups, and authentication activity from FusionAuth.',
    icon: 'fusionauth',
    domain: 'fusionauth.io',
  },

  {
    id: 'persona',
    name: 'Persona',
    category: 'security',
    tagline:
      'Sync identity verifications, pass rate, and case throughput from Persona.',
    brandColor: '#1E3DB1',
    domain: 'withpersona.com',
  },
  {
    id: 'onfido',
    name: 'Onfido',
    category: 'security',
    tagline:
      'Sync identity verifications, pass rate, and turnaround time from Onfido.',
    brandColor: '#3640F0',
    domain: 'onfido.com',
  },
  {
    id: 'alloy',
    name: 'Alloy',
    category: 'security',
    tagline:
      'Sync onboarding decisions, KYC checks, and case review from Alloy.',
    brandColor: '#0A2540',
    domain: 'alloy.com',
  },
  {
    id: 'trulioo',
    name: 'Trulioo',
    category: 'security',
    tagline:
      'Sync identity verifications, match rates, and per-country coverage from Trulioo.',
    brandColor: '#0061A8',
    domain: 'trulioo.com',
  },
  {
    id: 'jumio',
    name: 'Jumio',
    category: 'security',
    tagline:
      'Sync identity verifications, pass rate, and per-document-type breakdown from Jumio.',
    brandColor: '#1E2A4D',
    domain: 'jumio.com',
  },
  {
    id: 'veriff',
    name: 'Veriff',
    category: 'security',
    tagline:
      'Sync identity verifications, pass rate, and turnaround time from Veriff.',
    brandColor: '#FFCD00',
    domain: 'veriff.com',
  },
  {
    id: 'sumsub',
    name: 'Sumsub',
    category: 'security',
    tagline:
      'Sync identity verifications, KYC checks, and case throughput from Sumsub.',
    brandColor: '#0075FF',
    domain: 'sumsub.com',
  },
  {
    id: 'middesk',
    name: 'Middesk',
    category: 'security',
    tagline:
      'Sync business verifications, KYB checks, and pass rate from Middesk.',
    brandColor: '#101820',
    domain: 'middesk.com',
  },

  {
    id: 'paycom',
    name: 'Paycom',
    category: 'hr',
    tagline: 'Sync employees, payroll runs, and pay-cycle spend from Paycom.',
    brandColor: '#1A6DB5',
    domain: 'paycom.com',
  },
  {
    id: 'ukg',
    name: 'UKG',
    category: 'hr',
    tagline: 'Sync employees, time-and-attendance, and payroll spend from UKG.',
    brandColor: '#005EB8',
    domain: 'ukg.com',
  },
  {
    id: 'paycor',
    name: 'Paycor',
    category: 'hr',
    tagline: 'Sync employees, payroll runs, and pay-cycle spend from Paycor.',
    brandColor: '#F25C19',
    domain: 'paycor.com',
  },
  {
    id: 'namely',
    name: 'Namely',
    category: 'hr',
    tagline: 'Sync employees, payroll, and time-off from Namely.',
    brandColor: '#FF6543',
    domain: 'namely.com',
  },
  {
    id: 'multiplier',
    name: 'Multiplier',
    category: 'hr',
    tagline:
      'Sync employees, contractors, and payroll spend across countries from Multiplier.',
    brandColor: '#3F2DFF',
    domain: 'usemultiplier.com',
  },
  {
    id: 'papaya-global',
    name: 'Papaya Global',
    category: 'hr',
    tagline:
      'Sync employees, contractors, and global payroll spend from Papaya Global.',
    brandColor: '#0061FF',
    domain: 'papayaglobal.com',
  },
  {
    id: 'globalization-partners',
    name: 'G-P (Globalization Partners)',
    category: 'hr',
    tagline:
      'Sync EOR employees, contracts, and payroll spend across countries from G-P.',
    brandColor: '#001E62',
    domain: 'g-p.com',
    monogram: true,
  },
  {
    id: 'plane-hr',
    name: 'Plane',
    category: 'hr',
    tagline:
      'Sync employees, contractors, and global payroll spend from Plane.',
    brandColor: '#0035FF',
    domain: 'plane.com',
  },
  {
    id: 'hibob',
    name: 'HiBob',
    category: 'hr',
    tagline:
      'Sync employees, tenure, time-off, and engagement signals from HiBob.',
    icon: 'hibob',
    domain: 'hibob.com',
  },
  {
    id: 'sapling',
    name: 'Sapling',
    category: 'hr',
    tagline:
      'Sync employees, onboarding completion, and time-off from Sapling.',
    brandColor: '#1A7AFF',
    domain: 'saplinghr.com',
  },
  {
    id: 'humaans',
    name: 'Humaans',
    category: 'hr',
    tagline: 'Sync employees, time-off, and compensation events from Humaans.',
    brandColor: '#0F172A',
    domain: 'humaans.io',
  },
  {
    id: 'workable',
    name: 'Workable',
    category: 'hr',
    tagline:
      'Sync candidates, applications, and pipeline progression from Workable.',
    brandColor: '#1A2734',
    domain: 'workable.com',
  },
  {
    id: 'jobvite',
    name: 'Jobvite',
    category: 'hr',
    tagline: 'Sync candidates, applications, and offer activity from Jobvite.',
    brandColor: '#FF6F4D',
    domain: 'jobvite.com',
  },
  {
    id: 'smartrecruiters',
    name: 'SmartRecruiters',
    category: 'hr',
    tagline:
      'Sync candidates, applications, and pipeline progression from SmartRecruiters.',
    brandColor: '#00BCD4',
    domain: 'smartrecruiters.com',
  },
  {
    id: 'teamtailor',
    name: 'Teamtailor',
    category: 'hr',
    tagline:
      'Sync candidates, applications, and pipeline progression from Teamtailor.',
    brandColor: '#2EAF7D',
    domain: 'teamtailor.com',
  },
  {
    id: 'breezyhr',
    name: 'Breezy HR',
    category: 'hr',
    tagline:
      'Sync candidates, applications, and pipeline progression from Breezy HR.',
    brandColor: '#1FAD8F',
    domain: 'breezy.hr',
  },
  {
    id: '360learning',
    name: '360Learning',
    category: 'hr',
    tagline:
      'Sync course enrollments, completions, and reactions from 360Learning.',
    brandColor: '#1A1A1A',
    domain: '360learning.com',
  },
  {
    id: 'docebo-learn',
    name: 'Docebo Learn',
    category: 'hr',
    tagline:
      'Sync course catalog, completions, and certification status from Docebo Learn.',
    brandColor: '#FFA200',
    domain: 'docebo.com',
  },
  {
    id: 'coursera-business',
    name: 'Coursera for Business',
    category: 'hr',
    tagline:
      'Sync learner activity, course completions, and skill progress from Coursera for Business.',
    icon: 'coursera',
    domain: 'coursera.org',
  },
  {
    id: 'udemy-business',
    name: 'Udemy Business',
    category: 'hr',
    tagline:
      'Sync learner activity, course completions, and minutes consumed from Udemy Business.',
    icon: 'udemy',
    domain: 'udemy.com',
  },
  {
    id: 'cornerstone-ondemand',
    name: 'Cornerstone OnDemand',
    category: 'hr',
    tagline:
      'Sync learner activity, course completions, and certification status from Cornerstone OnDemand.',
    brandColor: '#E81A2B',
    domain: 'cornerstoneondemand.com',
  },

  {
    id: 'freeagent',
    name: 'FreeAgent',
    category: 'finance',
    tagline:
      'Sync invoices, expenses, and profit-and-loss figures from FreeAgent.',
    brandColor: '#5DB948',
    domain: 'freeagent.com',
  },
  {
    id: 'manager-accounting',
    name: 'Manager',
    category: 'finance',
    tagline:
      'Sync invoices, expenses, and profit-and-loss figures from Manager.',
    brandColor: '#1A1A1A',
    domain: 'manager.io',
  },
  {
    id: 'tesorio',
    name: 'Tesorio',
    category: 'finance',
    tagline: 'Sync AR aging, collections forecast, and DSO from Tesorio.',
    brandColor: '#1E40AF',
    domain: 'tesorio.com',
  },
  {
    id: 'highradius',
    name: 'HighRadius',
    category: 'finance',
    tagline: 'Sync AR aging, collections, and disputes from HighRadius.',
    brandColor: '#0072CE',
    domain: 'highradius.com',
  },
  {
    id: 'upflow',
    name: 'Upflow',
    category: 'finance',
    tagline: 'Sync AR aging, collections cadence, and DSO from Upflow.',
    brandColor: '#5B4DEE',
    domain: 'upflow.io',
  },
  {
    id: 'taxjar',
    name: 'TaxJar',
    category: 'finance',
    tagline:
      'Sync sales-tax liability by jurisdiction and filing status from TaxJar.',
    brandColor: '#0072CE',
    domain: 'taxjar.com',
  },
  {
    id: 'quaderno',
    name: 'Quaderno',
    category: 'finance',
    tagline:
      'Sync tax-compliant invoices, taxes collected, and filings from Quaderno.',
    brandColor: '#5469D4',
    domain: 'quaderno.io',
  },
  {
    id: 'mosaic',
    name: 'Mosaic',
    category: 'finance',
    tagline: 'Sync forecasts, plan-vs-actuals, and metric trends from Mosaic.',
    brandColor: '#1A1A2E',
    domain: 'mosaic.tech',
  },
  {
    id: 'cube-software',
    name: 'Cube',
    category: 'finance',
    tagline: 'Sync forecasts, plan-vs-actuals, and budget variance from Cube.',
    brandColor: '#9333EA',
    domain: 'cubesoftware.com',
  },
  {
    id: 'pigment',
    name: 'Pigment',
    category: 'finance',
    tagline:
      'Sync planning model outputs, forecasts, and scenarios from Pigment.',
    brandColor: '#E94E1B',
    domain: 'pigment.com',
  },
  {
    id: 'vena',
    name: 'Vena',
    category: 'finance',
    tagline: 'Sync budget vs actuals, forecasts, and scenarios from Vena.',
    brandColor: '#0072CE',
    domain: 'venasolutions.com',
  },
  {
    id: 'anaplan',
    name: 'Anaplan',
    category: 'finance',
    tagline:
      'Sync planning model outputs, forecasts, and scenarios from Anaplan.',
    brandColor: '#1A1A1A',
    domain: 'anaplan.com',
  },
  {
    id: 'kyriba',
    name: 'Kyriba',
    category: 'finance',
    tagline:
      'Sync cash balances, payments, and liquidity forecasts from Kyriba.',
    brandColor: '#0E4ECF',
    domain: 'kyriba.com',
  },
  {
    id: 'modern-treasury',
    name: 'Modern Treasury',
    category: 'finance',
    tagline:
      'Sync payments, account balances, and reconciliation status from Modern Treasury.',
    brandColor: '#1A1A1A',
    domain: 'moderntreasury.com',
  },
  {
    id: 'finch',
    name: 'Finch',
    category: 'finance',
    tagline:
      'Sync employees, payroll, and benefits data across providers via Finch.',
    brandColor: '#0F172A',
    domain: 'tryfinch.com',
  },
  {
    id: 'routable',
    name: 'Routable',
    category: 'finance',
    tagline: 'Sync bills, payouts, and AP automation activity from Routable.',
    brandColor: '#3B82F6',
    domain: 'routable.com',
  },
  {
    id: 'melio',
    name: 'Melio',
    category: 'finance',
    tagline: 'Sync bills, payments, and AP activity from Melio.',
    brandColor: '#3F2DFF',
    domain: 'meliopayments.com',
  },
  {
    id: 'jeeves',
    name: 'Jeeves',
    category: 'finance',
    tagline:
      'Sync card transactions, spend by category, and FX activity from Jeeves.',
    brandColor: '#06CFB7',
    domain: 'tryjeeves.com',
  },
  {
    id: 'airwallex',
    name: 'Airwallex',
    category: 'finance',
    tagline:
      'Sync multi-currency balances, payments, and FX activity from Airwallex.',
    brandColor: '#612FFF',
    domain: 'airwallex.com',
  },
  {
    id: 'wise-business',
    name: 'Wise Business',
    category: 'finance',
    tagline:
      'Sync multi-currency balances, transfers, and FX activity from Wise Business.',
    icon: 'wise',
    domain: 'wise.com',
  },
  {
    id: 'pipe',
    name: 'Pipe',
    category: 'finance',
    tagline:
      'Sync trading capacity, advances, and repayment schedule from Pipe.',
    brandColor: '#11FF8E',
    domain: 'pipe.com',
  },
  {
    id: 'capchase',
    name: 'Capchase',
    category: 'finance',
    tagline: 'Sync advances, repayments, and runway from Capchase.',
    brandColor: '#1F1F1F',
    domain: 'capchase.com',
  },
  {
    id: 'zip',
    name: 'Zip',
    category: 'finance',
    tagline:
      'Sync intake requests, vendor approvals, and procurement cycle time from Zip.',
    brandColor: '#101010',
    domain: 'ziphq.com',
  },
  {
    id: 'sastrify',
    name: 'Sastrify',
    category: 'finance',
    tagline: 'Sync SaaS spend, contract renewals, and savings from Sastrify.',
    brandColor: '#5333FF',
    domain: 'sastrify.com',
  },
  {
    id: 'vendr',
    name: 'Vendr',
    category: 'finance',
    tagline: 'Sync SaaS spend, contract renewals, and savings from Vendr.',
    brandColor: '#101820',
    domain: 'vendr.com',
  },
  {
    id: 'tropic',
    name: 'Tropic',
    category: 'finance',
    tagline:
      'Sync SaaS spend, contract renewals, and negotiated savings from Tropic.',
    brandColor: '#1A7F37',
    domain: 'tropicapp.io',
  },
  {
    id: 'productiv',
    name: 'Productiv',
    category: 'finance',
    tagline: 'Sync SaaS spend, app usage, and renewal risk from Productiv.',
    brandColor: '#005EFF',
    domain: 'productiv.com',
  },
  {
    id: 'torii',
    name: 'Torii',
    category: 'finance',
    tagline: 'Sync SaaS app inventory, spend, and usage from Torii.',
    brandColor: '#3F2DFF',
    domain: 'toriihq.com',
  },

  {
    id: 'linkedin-sales-navigator',
    name: 'LinkedIn Sales Navigator',
    category: 'sales',
    tagline:
      'Sync saved searches, lead activity, and InMail engagement from LinkedIn Sales Navigator.',
    brandColor: '#0A66C2',
    domain: 'linkedin.com',
  },
  {
    id: 'lusha',
    name: 'Lusha',
    category: 'sales',
    tagline:
      'Sync enrichment lookups, reveal activity, and credit usage from Lusha.',
    brandColor: '#1F5BFF',
    domain: 'lusha.com',
    monogram: true,
  },
  {
    id: 'cognism',
    name: 'Cognism',
    category: 'sales',
    tagline:
      'Sync enrichment lookups, reveal activity, and credit usage from Cognism.',
    brandColor: '#0E1E40',
    domain: 'cognism.com',
  },
  {
    id: 'seamless-ai',
    name: 'Seamless.AI',
    category: 'sales',
    tagline:
      'Sync enrichment lookups, contact discovery, and credit usage from Seamless.AI.',
    brandColor: '#0EB8A6',
    domain: 'seamless.ai',
  },
  {
    id: 'rocketreach',
    name: 'RocketReach',
    category: 'sales',
    tagline:
      'Sync enrichment lookups, contact discovery, and credit usage from RocketReach.',
    brandColor: '#FF4F00',
    domain: 'rocketreach.co',
  },
  {
    id: 'hunter-io',
    name: 'Hunter',
    category: 'sales',
    tagline:
      'Sync email finder lookups, verifications, and credit usage from Hunter.',
    brandColor: '#FF6D3F',
    domain: 'hunter.io',
  },
  {
    id: 'fullcontact',
    name: 'FullContact',
    category: 'sales',
    tagline:
      'Sync enrichment lookups, identity resolution, and credit usage from FullContact.',
    brandColor: '#FF6F00',
    domain: 'fullcontact.com',
  },
  {
    id: 'people-data-labs',
    name: 'People Data Labs',
    category: 'sales',
    tagline:
      'Sync enrichment lookups, person and company records, and credit usage from People Data Labs.',
    brandColor: '#5E5BFF',
    domain: 'peopledatalabs.com',
  },
  {
    id: 'demandbase',
    name: 'Demandbase',
    category: 'sales',
    tagline:
      'Sync target accounts, engagement, and intent signals from Demandbase.',
    brandColor: '#001E5E',
    domain: 'demandbase.com',
  },
  {
    id: '6sense',
    name: '6sense',
    category: 'sales',
    tagline:
      'Sync target accounts, buying-stage, and intent signals from 6sense.',
    brandColor: '#1A1A1A',
    domain: '6sense.com',
  },
  {
    id: 'bombora',
    name: 'Bombora',
    category: 'sales',
    tagline: 'Sync surging accounts and topic intent signals from Bombora.',
    brandColor: '#FFA632',
    domain: 'bombora.com',
  },
  {
    id: 'rollworks',
    name: 'RollWorks',
    category: 'sales',
    tagline:
      'Sync ABM campaign performance, target accounts, and engagement from RollWorks.',
    brandColor: '#005DFF',
    domain: 'rollworks.com',
  },
  {
    id: 'terminus',
    name: 'Terminus',
    category: 'sales',
    tagline:
      'Sync ABM campaign performance, target accounts, and engagement from Terminus.',
    brandColor: '#33B2FF',
    domain: 'terminus.com',
  },
  {
    id: 'leadfeeder',
    name: 'Leadfeeder',
    category: 'sales',
    tagline:
      'Sync website-visiting companies, lead activity, and account quality from Leadfeeder.',
    brandColor: '#86C440',
    domain: 'leadfeeder.com',
  },

  {
    id: 'avoma',
    name: 'Avoma',
    category: 'sales',
    tagline: 'Sync meetings, talk-time, and conversation insights from Avoma.',
    brandColor: '#5350FF',
    domain: 'avoma.com',
  },
  {
    id: 'fathom',
    name: 'Fathom',
    category: 'sales',
    tagline: 'Sync meetings, summaries, and talk-time stats from Fathom.',
    icon: 'fathom',
    domain: 'fathom.video',
  },
  {
    id: 'otter-ai',
    name: 'Otter.ai',
    category: 'sales',
    tagline:
      'Sync meetings, transcription volume, and per-user usage from Otter.ai.',
    brandColor: '#00B0F0',
    domain: 'otter.ai',
  },
  {
    id: 'fireflies-ai',
    name: 'Fireflies.ai',
    category: 'sales',
    tagline:
      'Sync meetings, transcription volume, and conversation insights from Fireflies.ai.',
    brandColor: '#F77737',
    domain: 'fireflies.ai',
  },
  {
    id: 'grain',
    name: 'Grain',
    category: 'sales',
    tagline: 'Sync meetings, highlights, and conversation insights from Grain.',
    brandColor: '#FF4D2E',
    domain: 'grain.com',
  },

  {
    id: 'clari',
    name: 'Clari',
    category: 'sales',
    tagline:
      'Sync forecast vs commit, pipeline coverage, and deal slippage from Clari.',
    brandColor: '#2D6CDF',
    domain: 'clari.com',
  },
  {
    id: 'aviso',
    name: 'Aviso',
    category: 'sales',
    tagline:
      'Sync forecast vs commit, deal risk, and pipeline coverage from Aviso.',
    brandColor: '#0E2A5C',
    domain: 'aviso.com',
  },
  {
    id: 'boostup',
    name: 'BoostUp',
    category: 'sales',
    tagline:
      'Sync forecast vs commit, deal risk, and rep activity from BoostUp.',
    brandColor: '#5733FF',
    domain: 'boostup.ai',
  },
  {
    id: 'insightsquared',
    name: 'InsightSquared',
    category: 'sales',
    tagline:
      'Sync forecasts, pipeline analytics, and rep activity from InsightSquared.',
    brandColor: '#3FCEF5',
    domain: 'insightsquared.com',
  },

  {
    id: 'highspot',
    name: 'Highspot',
    category: 'sales',
    tagline:
      'Sync content engagement, rep usage, and pitch outcomes from Highspot.',
    brandColor: '#FF7A00',
    domain: 'highspot.com',
  },
  {
    id: 'seismic',
    name: 'Seismic',
    category: 'sales',
    tagline:
      'Sync content engagement, rep usage, and live-send activity from Seismic.',
    brandColor: '#FF6347',
    domain: 'seismic.com',
  },
  {
    id: 'showpad',
    name: 'Showpad',
    category: 'sales',
    tagline:
      'Sync content engagement, rep usage, and learning progress from Showpad.',
    icon: 'showpad',
    domain: 'showpad.com',
  },

  {
    id: 'spiff',
    name: 'Spiff',
    category: 'sales',
    tagline:
      'Sync commission calculations, payouts, and quota attainment from Spiff.',
    brandColor: '#0A1A2F',
    domain: 'spiff.com',
  },
  {
    id: 'captivateiq',
    name: 'CaptivateIQ',
    category: 'sales',
    tagline:
      'Sync commission calculations, payouts, and quota attainment from CaptivateIQ.',
    brandColor: '#1A7FE3',
    domain: 'captivateiq.com',
  },
  {
    id: 'quotapath',
    name: 'QuotaPath',
    category: 'sales',
    tagline:
      'Sync commission calculations, payouts, and quota attainment from QuotaPath.',
    brandColor: '#7C3AED',
    domain: 'quotapath.com',
  },
  {
    id: 'salesforce-cpq',
    name: 'Salesforce CPQ',
    category: 'sales',
    tagline:
      'Sync quotes, configurations, and approval cycle time from Salesforce CPQ.',
    brandColor: '#00A1E0',
    domain: 'salesforce.com',
  },
  {
    id: 'dealhub',
    name: 'DealHub',
    category: 'sales',
    tagline: 'Sync quotes, deal rooms, and approval cycle time from DealHub.',
    brandColor: '#FF6F00',
    domain: 'dealhub.io',
  },
  {
    id: 'subskribe',
    name: 'Subskribe',
    category: 'sales',
    tagline: 'Sync quotes, subscriptions, and renewal cycle from Subskribe.',
    brandColor: '#1A1A4E',
    domain: 'subskribe.com',
  },

  {
    id: 'ringcentral',
    name: 'RingCentral',
    category: 'support',
    tagline:
      'Sync calls, minutes, and per-user activity from a RingCentral account.',
    brandColor: '#0073AE',
    domain: 'ringcentral.com',
  },
  {
    id: 'dialpad',
    name: 'Dialpad',
    category: 'support',
    tagline:
      'Sync calls, minutes, and per-user activity from a Dialpad account.',
    brandColor: '#7C52FF',
    domain: 'dialpad.com',
  },
  {
    id: 'aircall',
    name: 'Aircall',
    category: 'support',
    tagline: 'Sync calls, abandonment, and per-team activity from Aircall.',
    icon: 'aircall',
    domain: 'aircall.io',
  },
  {
    id: 'justcall',
    name: 'JustCall',
    category: 'support',
    tagline: 'Sync calls, SMS volume, and per-user activity from JustCall.',
    brandColor: '#0E55FF',
    domain: 'justcall.io',
  },
  {
    id: 'openphone',
    name: 'OpenPhone',
    category: 'support',
    tagline: 'Sync calls, SMS volume, and per-user activity from OpenPhone.',
    brandColor: '#7C3AED',
    domain: 'openphone.com',
  },
  {
    id: 'talkdesk',
    name: 'Talkdesk',
    category: 'support',
    tagline:
      'Sync calls, abandonment, average handle time, and CSAT from Talkdesk.',
    brandColor: '#02265F',
    domain: 'talkdesk.com',
  },
  {
    id: 'five9',
    name: 'Five9',
    category: 'support',
    tagline:
      'Sync calls, abandonment, average handle time, and CSAT from Five9.',
    brandColor: '#1E2B4F',
    domain: 'five9.com',
  },
  {
    id: 'nice-incontact',
    name: 'NICE CXone',
    category: 'support',
    tagline:
      'Sync contact volume, abandonment, AHT, and CSAT from NICE CXone (inContact).',
    brandColor: '#1A1A1A',
    domain: 'nice.com',
  },
  {
    id: 'vonage',
    name: 'Vonage',
    category: 'support',
    tagline:
      'Sync calls, minutes, and per-user activity from a Vonage account.',
    icon: 'vonage',
    domain: 'vonage.com',
  },

  {
    id: 'plivo',
    name: 'Plivo',
    category: 'engineering',
    tagline:
      'Sync SMS, voice, and per-number usage with delivery and error rates from Plivo.',
    brandColor: '#1F8FFF',
    domain: 'plivo.com',
  },
  {
    id: 'messagebird',
    name: 'MessageBird',
    category: 'engineering',
    tagline:
      'Sync SMS, voice, WhatsApp, and email usage with delivery rates from MessageBird.',
    brandColor: '#2481D7',
    domain: 'bird.com',
  },
  {
    id: 'sinch',
    name: 'Sinch',
    category: 'engineering',
    tagline:
      'Sync SMS, voice, and per-channel usage with delivery rates from Sinch.',
    brandColor: '#003F31',
    domain: 'sinch.com',
  },
  {
    id: 'telnyx',
    name: 'Telnyx',
    category: 'engineering',
    tagline:
      'Sync SMS, voice, and per-number usage with delivery and error rates from Telnyx.',
    brandColor: '#00E3AA',
    domain: 'telnyx.com',
  },
  {
    id: 'bandwidth',
    name: 'Bandwidth',
    category: 'engineering',
    tagline:
      'Sync SMS, voice, and 911 usage with delivery rates from Bandwidth.',
    brandColor: '#0021A5',
    domain: 'bandwidth.com',
  },

  {
    id: 'pusher-beams',
    name: 'Pusher Beams',
    category: 'marketing',
    tagline:
      'Sync push notification send volume, delivery rate, and opens from Pusher Beams.',
    icon: 'pusher',
    domain: 'pusher.com',
  },
  {
    id: 'airship',
    name: 'Airship',
    category: 'marketing',
    tagline:
      'Sync push notification send volume, delivery, opens, and engagement from Airship.',
    brandColor: '#FA0F40',
    domain: 'airship.com',
  },

  {
    id: 'cloudflare-radar',
    name: 'Cloudflare Radar',
    category: 'analytics',
    tagline:
      'Sync internet traffic trends, attack signals, and domain ranking data from Cloudflare Radar.',
    icon: 'cloudflare',
    domain: 'cloudflare.com',
  },
  {
    id: 'stack-overflow-tags',
    name: 'Stack Overflow Tags',
    category: 'marketing',
    tagline:
      'Watch question volume, answer rate, and view counts for tracked Stack Overflow tags.',
    icon: 'stackoverflow',
    domain: 'stackoverflow.com',
  },
  {
    id: 'g2',
    name: 'G2',
    category: 'marketing',
    tagline:
      'Sync overall rating, review count, and category rank from a G2 product page.',
    icon: 'g2',
    domain: 'g2.com',
  },
  {
    id: 'capterra',
    name: 'Capterra',
    category: 'marketing',
    tagline:
      'Sync overall rating, review count, and category rank from a Capterra product page.',
    brandColor: '#FF9D28',
    domain: 'capterra.com',
  },
  {
    id: 'trustradius',
    name: 'TrustRadius',
    category: 'marketing',
    tagline:
      'Sync overall rating, review count, and category rank from a TrustRadius product page.',
    brandColor: '#F2683B',
    domain: 'trustradius.com',
  },
  {
    id: 'mention',
    name: 'Mention',
    category: 'marketing',
    tagline:
      'Sync brand mentions, reach, and sentiment across web and social from Mention.',
    brandColor: '#0084FF',
    domain: 'mention.com',
  },
  {
    id: 'brand24',
    name: 'Brand24',
    category: 'marketing',
    tagline:
      'Sync brand mentions, reach, and sentiment across web and social from Brand24.',
    brandColor: '#1ABC9C',
    domain: 'brand24.com',
  },
  {
    id: 'talkwalker',
    name: 'Talkwalker',
    category: 'marketing',
    tagline:
      'Sync brand mentions, reach, sentiment, and share-of-voice from Talkwalker.',
    brandColor: '#005AFF',
    domain: 'talkwalker.com',
  },
  {
    id: 'meltwater',
    name: 'Meltwater',
    category: 'marketing',
    tagline:
      'Sync media mentions, reach, sentiment, and share-of-voice from Meltwater.',
    brandColor: '#1A1A1A',
    domain: 'meltwater.com',
  },
];
