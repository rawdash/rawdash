---
'@rawdash/core': minor
---

**Breaking:** `filterable` is now a required field on `ResourceDefinition`.

Every resource must declare a `filterable: ResourceFilterField[]` array — use `[]`
to explicitly state that the source cannot filter any field server-side (typical for
pre-aggregated `metric`/`distribution` resources). `defineResources` now throws if
`filterable` is missing, or if any entry has an empty `field` or no operators.

Membership in `filterable` is the server-side pushdown signal: a widget filtering on a
declared field has that filter pushed to the source query; any other field is still
filtered client-side by compute (no declaration needed). Connectors now translate their
declared filters into source query params in the fetch loop (e.g. GitHub/GitLab/Bitbucket
`state`, Sentry issue `status`/`level`, Stripe subscription/invoice `status`, Vercel
deployment `state`/`target`, Netlify deploy `state`).

Third-party connector authors must add `filterable` to every resource in their
`defineResources` call.
