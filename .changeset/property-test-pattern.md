---
'@rawdash/connector-github': patch
'@rawdash/connector-linear': patch
'@rawdash/connector-stripe': patch
'@rawdash/connector-google-analytics': patch
---

Add fast-check property tests for connector `sync()` invariants. Each connector now has a `property.test.ts` that generates synthetic API payloads from Zod schemas and asserts universal invariants (non-empty entity ids, finite event timestamps, no `undefined` reaching storage, no throws on any valid input) against `InMemoryStorage`. The reusable helper lives in the new internal `@rawdash/connector-test-utils` package.
