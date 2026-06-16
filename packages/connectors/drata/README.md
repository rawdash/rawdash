<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-drata

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-drata)](https://www.npmjs.com/package/@rawdash/connector-drata)
[![license](https://img.shields.io/npm/l/@rawdash/connector-drata)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync controls, tests, personnel, and test findings from Drata for audit-ready %, failing-test count, training-completion, and open-finding compliance dashboards.

## Install

```sh
npm install @rawdash/connector-drata
```

## Authentication

Bearer-token auth with a Drata Public API key. Read access to the resources you sync is sufficient.

1. Sign in to Drata as an admin and open Settings -> Integrations -> Public API.
2. Create a new API key; grant it read access to the resources you intend to sync (controls, tests, personnel, findings).
3. Copy the generated key. Drata only shows the key once.
4. Store the key as a rawdash secret and reference it from the connector config as `apiKey: secret("DRATA_API_KEY")`.

## Configuration

| Field                  | Type   | Required | Description                                                                                                                                 |
| ---------------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiKey`               | secret | Yes      | Drata Public API key. Generated under Settings -> Integrations -> Public API. Treated as a bearer token. Stored as a secret.                |
| `baseUrl`              | string | No       | Override the Drata Public API base URL. Defaults to "https://public-api.drata.com". Useful for sandbox / region-specific tenants.           |
| `resources`            | array  | No       | Which Drata resources to sync. Omit to sync all of them. The API key only needs read access to the resources listed here.                   |
| `findingsLookbackDays` | number | No       | How many days of test findings to refresh on each full sync. Defaults to 90. Incremental syncs use the run watermark and ignore this field. |

## Resources

- **`drata_control`** _(entity)_ - Drata controls keyed by id. Each control belongs to one or more frameworks (SOC 2, HIPAA, ISO 27001, etc.) and has a roll-up status of PASSING, FAILING, or NEEDS_ATTENTION.
  - Endpoint: `GET /v1/controls`
  - Cursor pagination via cursor / limit. Controls are a full-snapshot resource: a full sync rewrites the scope on first page.
  - `name`: Human-readable control name.
  - `status`: Roll-up status (PASSING, FAILING, NEEDS_ATTENTION, or DEACTIVATED).
  - `framework`: Name of the first framework the control is mapped to (e.g. "SOC 2"). Use the framework dimension for distributions when a control maps to several frameworks.
  - `frameworks`: Comma-separated list of every framework the control is mapped to.
  - `lastEvaluated`: When Drata last evaluated the control (Unix ms).
- **`drata_test`** _(entity)_ - Drata tests keyed by id. A test is the smallest unit of evaluation in Drata and may be mapped to multiple controls.
  - Endpoint: `GET /v1/tests`
  - Cursor pagination via cursor / limit. Tests are a full-snapshot resource.
  - `name`: Human-readable test name.
  - `status`: Test status (OK, NEEDS_ATTENTION, DEACTIVATED, or IN_PROGRESS).
  - `controlId`: First control id the test is mapped to (a test may be mapped to several controls).
  - `controlCount`: Number of controls the test is mapped to.
  - `evidenceCount`: Number of distinct evidence rows backing the test (counter maintained by Drata).
  - `lastTested`: When Drata last ran the test (Unix ms).
- **`drata_personnel`** _(entity)_ - Drata personnel records keyed by id. Surfaces employment status, role, training completion, and training-completed timestamp for compliance-training dashboards.
  - Endpoint: `GET /v1/personnel`
  - Cursor pagination via cursor / limit. Personnel is a full-snapshot resource.
  - `email`: Work email address.
  - `name`: Full name ("firstName lastName").
  - `role`: Reported role / job title.
  - `employmentStatus`: Reported employment status (e.g. ACTIVE, ONBOARDING, OFFBOARDED).
  - `trainingStatus`: Reported security-training status (e.g. COMPLETED, IN_PROGRESS, NOT_STARTED, OVERDUE).
  - `trainingCompleted`: When the most recent training was marked completed (Unix ms).
  - `startDate`: Reported employment start date (Unix ms).
- **`drata_test_finding`** _(event)_ - Test findings (one event per finding row), with severity, the test it came from, and resolved-at when applicable. Useful for open-finding counts and MTTR-to-resolution timeseries.
  - Endpoint: `GET /v1/findings`
  - Cursor pagination via cursor / limit. Full syncs walk back findingsLookbackDays days; incremental syncs use the sync `since` watermark.
  - `findingId`: Drata finding id.
  - `severity`: Finding severity (LOW, MEDIUM, HIGH, CRITICAL).
  - `status`: Finding status (OPEN, RESOLVED, DEFERRED, WONT_FIX).
  - `testId`: Id of the test that produced the finding.
  - `controlId`: First control id the finding is mapped to (via its test).
  - `resolvedAt`: Resolution timestamp (Unix ms) when resolved.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const drata = {
  name: 'drata',
  connectorId: 'drata',
  config: {
    apiKey: secret('DRATA_API_KEY'),
  },
};

export default defineConfig({
  connectors: [drata],
  dashboards: {
    compliance: defineDashboard({
      widgets: {
        failing_controls: {
          kind: 'stat',
          title: 'Failing controls',
          metric: defineMetric({
            connector: drata,
            shape: 'entity',
            entityType: 'drata_control',
            fn: 'count',
            filter: [{ field: 'status', op: 'eq', value: 'FAILING' }],
          }),
        },
        open_findings: {
          kind: 'stat',
          title: 'Open findings',
          metric: defineMetric({
            connector: drata,
            shape: 'event',
            name: 'drata_test_finding',
            fn: 'count',
            filter: [{ field: 'status', op: 'eq', value: 'OPEN' }],
          }),
        },
      },
    }),
  },
});
```

## Rate limits

Drata enforces a per-tenant quota and responds with 429 + Retry-After when exceeded; the shared HTTP client honors Retry-After when scheduling the next request.

## Limitations

- Only controls, tests, personnel, and test findings are synced. Frameworks, risks, vendors, audits, and document-evidence resources are out of scope.
- Controls, tests, and personnel are full-snapshot resources: every sync re-reads the whole list and rewrites the entity scope on the first page. Tenants with very large catalogs (10k+ controls/tests) should run the connector less often.
- Test findings before the configured lookback window (default 90 days) are not refreshed; they remain whatever the most recent sync that did see them wrote.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [Drata API docs](https://developers.drata.com/)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
