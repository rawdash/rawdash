---
'@rawdash/connector-salesforce': patch
---

Use `SystemModstamp` instead of `LastModifiedDate` as the incremental cursor for the `accounts`, `leads`, and `opportunities` resources. `LastModifiedDate` only advances on user-initiated changes, so records modified by automated Salesforce processes (Flows, Process Builder, roll-up summary recalculation, lead-conversion side effects) were silently dropped from incremental syncs and left stale. `SystemModstamp` advances on both user and system changes, is always `>= LastModifiedDate`, and is indexed (avoiding non-selective query timeouts on large objects). The three resources now select, filter, and order by `SystemModstamp`, and derive their `updated_at` high-water mark from it. The `opportunity_events` resource continues to use `CreatedDate`, which is correct for immutable field-history rows.
