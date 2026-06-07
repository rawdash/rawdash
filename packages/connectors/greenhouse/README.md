<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-greenhouse

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-greenhouse)](https://www.npmjs.com/package/@rawdash/connector-greenhouse)
[![license](https://img.shields.io/npm/l/@rawdash/connector-greenhouse)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync jobs, candidates, applications, and offers from the Greenhouse Harvest API for hiring-funnel, time-to-hire, and offer-rate analytics.

> **Cost & frequency.** Greenhouse Harvest is rate-limited to 50 requests / 10 seconds per key; on large hiring funnels the full backfill spans many pages, so syncing more often than the recommended interval can starve other integrations on the same key. Recommended sync interval: **1 hour**. Minimum sensible interval: **15 minutes**.

## Install

```sh
npm install @rawdash/connector-greenhouse
```

## Authentication

A Harvest API key with read-only access to candidates, applications, jobs, and offers. Greenhouse authenticates via HTTP Basic with the key as the username and an empty password.

1. Open Greenhouse -> Configure -> Dev Center -> API Credential Management.
2. Create a new Harvest API key with Get / List permissions for the resources you intend to sync (Candidates, Applications, Jobs, Offers).
3. Copy the key once on creation - Greenhouse never shows it again.
4. Store the key as a secret and reference it from config as `apiKey: secret("GREENHOUSE_API_KEY")`.

## Configuration

| Field       | Type   | Required | Description                                                                                                                                      |
| ----------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apiKey`    | secret | Yes      | Greenhouse Harvest API key with read-only access. Create one at Configure -> Dev Center -> API Credential Management.                            |
| `resources` | array  | No       | Which Greenhouse resources to sync. Omit to sync all resources. The Harvest key only needs Get / List permissions for the resources listed here. |

## Resources

- **`greenhouse_job`** _(entity)_ - Open, draft, and closed requisitions with department, office, and timestamps for opened / closed transitions.
  - Endpoint: `GET /v1/jobs`
  - `name`: Job title.
  - `status`: Greenhouse job status (open / closed / draft).
  - `requisitionId`: External requisition id.
  - `departments`: Flat list of department names attached to the job.
  - `offices`: Flat list of office names attached to the job.
  - `openedAt`: When the job was opened (Unix ms).
  - `closedAt`: When the job was closed (Unix ms).
  - `confidential`: Whether the job is confidential.
- **`greenhouse_candidate`** _(entity)_ - Candidate records with name, title, company, and the count of attached applications.
  - Endpoint: `GET /v1/candidates`
  - `firstName`: Candidate first name.
  - `lastName`: Candidate last name.
  - `title`: Candidate current job title.
  - `company`: Candidate current company.
  - `applicationCount`: Number of applications attached to the candidate. Useful for spotting repeat applicants.
  - `isPrivate`: Whether the candidate is marked private.
  - `createdAt`: When the candidate was created (Unix ms).
  - `lastActivityAt`: Last activity timestamp on the candidate (Unix ms).
- **`greenhouse_application`** _(entity)_ - Applications with status (active / hired / rejected), current stage, source, and the linked candidate / job.
  - Endpoint: `GET /v1/applications`
  - `candidateId`: Candidate the application belongs to.
  - `jobId`: Primary job the application is attached to.
  - `jobName`: Primary job name at sync time.
  - `status`: Application status (active / hired / rejected).
  - `currentStage`: Name of the current stage (e.g. "Phone Screen").
  - `source`: Public source name where the application originated (e.g. "LinkedIn").
  - `appliedAt`: When the application was submitted.
  - `rejectedAt`: When the application was rejected (null if not).
  - `hiredAt`: When the application was hired (derived from last_activity_at when status=hired).
  - `lastActivityAt`: Last activity timestamp on the application (Unix ms).
- **`greenhouse_application_event`** _(event)_ - Application lifecycle events (applied / hired / rejected) derived from each application timestamps. The scope is cleared and rewritten on every full sync.
  - Endpoint: `GET /v1/applications`
  - Derived from each application's applied_at / rejected_at / last_activity_at fields, not from a separate API call.
  - `applicationId`: Application the event belongs to.
  - `candidateId`: Candidate id, denormalised.
  - `jobId`: Job id, denormalised.
  - `transition`: "applied", "hired", or "rejected".
  - `source`: Application source name at the time of the event.
- **`greenhouse_offer`** _(entity)_ - Offers with status (pending / accepted / rejected), linked to their application, candidate, and job.
  - Endpoint: `GET /v1/offers`
  - `applicationId`: Linked application.
  - `candidateId`: Linked candidate.
  - `jobId`: Linked job.
  - `status`: Offer status (pending / accepted / rejected).
  - `sentAt`: When the offer was sent (Unix ms).
  - `resolvedAt`: When the offer was accepted or rejected (Unix ms; null while pending).
  - `startsAt`: Proposed start date on the offer (Unix ms).

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const greenhouse = {
  name: 'greenhouse',
  connectorId: 'greenhouse',
  config: {
    apiKey: secret('GREENHOUSE_API_KEY'),
  },
};

export default defineConfig({
  connectors: [greenhouse],
  dashboards: {
    hiring: defineDashboard({
      widgets: {
        open_roles: {
          kind: 'stat',
          title: 'Open roles',
          metric: defineMetric({
            connector: greenhouse,
            shape: 'entity',
            entityType: 'greenhouse_job',
            fn: 'count',
            filter: [{ field: 'status', op: 'eq', value: 'open' }],
          }),
        },
        offers_extended: {
          kind: 'stat',
          title: 'Offers extended',
          metric: defineMetric({
            connector: greenhouse,
            shape: 'entity',
            entityType: 'greenhouse_offer',
            fn: 'count',
          }),
        },
      },
    }),
  },
});
```

## Rate limits

Greenhouse Harvest enforces 50 requests per 10 seconds per key and surfaces remaining quota via the X-RateLimit-\* headers; the shared HTTP client backs off on 429, preferring the Retry-After header.

## Limitations

- Application stage-transition history is derived from each application's built-in timestamps (applied_at, hired_at, rejected_at, last_activity_at) rather than the per-application /activity_feed endpoint, which avoids an N+1 sync.
- Greenhouse Onboard data and Recruiting custom fields are out of scope.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors/)
- [Greenhouse API docs](https://developers.greenhouse.io/harvest.html)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
