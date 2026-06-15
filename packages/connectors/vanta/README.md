<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-vanta

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-vanta)](https://www.npmjs.com/package/@rawdash/connector-vanta)
[![license](https://img.shields.io/npm/l/@rawdash/connector-vanta)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync controls, tests, and test findings from a Vanta workspace for audit-ready %, failing-test count, and open-finding compliance dashboards.

## Install

```sh
npm install @rawdash/connector-vanta
```

## Authentication

OAuth 2.0 client-credentials flow against a Vanta Public API application. Read-only scopes are sufficient.

1. Sign in to Vanta as an admin and open Settings -> Connect -> Public API.
2. Create a new application; grant it read access to the resources you intend to sync (controls, tests, findings).
3. Copy the generated Client ID and Client Secret. Vanta only shows the secret once.
4. Store the client secret as a rawdash secret and reference it from the connector config as `clientSecret: secret("VANTA_CLIENT_SECRET")`.

## Configuration

| Field                  | Type   | Required | Description                                                                                                                                           |
| ---------------------- | ------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clientId`             | string | Yes      | Client ID of the Vanta OAuth application authorized for the Public API. Created under Settings -> Connect -> Public API in Vanta.                     |
| `clientSecret`         | secret | Yes      | Client secret of the Vanta OAuth application. Stored as a secret.                                                                                     |
| `scope`                | string | No       | Space-delimited OAuth scopes requested when minting a token. Defaults to "vanta-api.all:read", which covers every read endpoint this connector calls. |
| `resources`            | array  | No       | Which Vanta resources to sync. Omit to sync all of them. The OAuth client only needs the read scope for the resources listed here.                    |
| `findingsLookbackDays` | number | No       | How many days of test findings to refresh on each full sync. Defaults to 90. Incremental syncs use the run watermark and ignore this field.           |

## Resources

- **`vanta_control`** _(entity)_ - Vanta controls keyed by id. Each control belongs to one or more frameworks (SOC 2, HIPAA, ISO 27001, etc.) and has a roll-up status of PASSING, FAILING, or NEEDS_ATTENTION.
  - Endpoint: `GET /v1/controls`
  - Cursor pagination via pageCursor / pageSize. Controls are a full-snapshot resource: a full sync rewrites the scope on first page.
  - `name`: Human-readable control name.
  - `status`: Roll-up status (PASSING, FAILING, or NEEDS_ATTENTION).
  - `framework`: Name of the first framework the control is mapped to (e.g. "SOC 2"). Use the framework dimension for distributions when a control maps to several frameworks.
  - `frameworks`: Comma-separated list of every framework the control is mapped to.
  - `lastEvaluated`: When Vanta last evaluated the control (Unix ms).
- **`vanta_test`** _(entity)_ - Vanta tests keyed by id. A test is the smallest unit of evaluation in Vanta and may be mapped to multiple controls.
  - Endpoint: `GET /v1/tests`
  - Cursor pagination via pageCursor / pageSize. Tests are a full-snapshot resource.
  - `name`: Human-readable test name.
  - `status`: Test status (OK, NEEDS_ATTENTION, DEACTIVATED, or IN_PROGRESS).
  - `controlId`: First control id the test is mapped to (a test may be mapped to several controls).
  - `controlCount`: Number of controls the test is mapped to.
  - `evidenceCount`: Number of distinct evidence rows backing the test (counter maintained by Vanta).
  - `lastTested`: When Vanta last ran the test (Unix ms).
- **`vanta_test_finding`** _(event)_ - Test findings (one event per finding row), with severity, the test it came from, and resolved-at when applicable. Useful for open-finding counts and MTTR-to-resolution timeseries.
  - Endpoint: `GET /v1/test-findings`
  - Cursor pagination via pageCursor / pageSize. Full syncs walk back findingsLookbackDays days; incremental syncs use the sync `since` watermark.
  - `findingId`: Vanta finding id.
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

const vanta = {
  name: 'vanta',
  connectorId: 'vanta',
  config: {
    clientId: 'vci_AbCdEf...',
    clientSecret: secret('VANTA_CLIENT_SECRET'),
  },
};

export default defineConfig({
  connectors: [vanta],
  dashboards: {
    compliance: defineDashboard({
      widgets: {
        failing_controls: {
          kind: 'stat',
          title: 'Failing controls',
          metric: defineMetric({
            connector: vanta,
            shape: 'entity',
            entityType: 'vanta_control',
            fn: 'count',
            filter: [{ field: 'status', op: 'eq', value: 'FAILING' }],
          }),
        },
        open_findings: {
          kind: 'stat',
          title: 'Open findings',
          metric: defineMetric({
            connector: vanta,
            shape: 'event',
            name: 'vanta_test_finding',
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

Vanta enforces a per-application quota (50 requests per minute on the default tier) and responds with 429 + Retry-After when exceeded; the shared HTTP client honors Retry-After when scheduling the next request.

## Limitations

- Only controls, tests, and test findings are synced. Frameworks, risks, vendors, audits, people, and document-evidence resources are out of scope.
- Controls and tests are full-snapshot resources: every sync re-reads the whole list and rewrites the entity scope on the first page. Tenants with very large catalogs (10k+ controls/tests) should run the connector less often.
- Test findings before the configured lookback window (default 90 days) are not refreshed; they remain whatever the most recent sync that did see them wrote.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [Vanta API docs](https://developer.vanta.com/)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
