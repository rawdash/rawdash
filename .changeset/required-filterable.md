---
'@rawdash/core': minor
---

**Breaking:** `filterable` is now a required field on `entity` and `event` resources.

Resources with `shape: 'entity'` or `shape: 'event'` must declare a
`filterable: ResourceFilterField[]` array — use `[]` to explicitly state that the source
cannot filter any field server-side. `metric`, `distribution`, and `edge` resources do
**not** carry `filterable` (they are pre-aggregated / structural, so there is nothing to
push down). `defineResources` throws if an entity/event resource omits `filterable`, or if
any entry has an empty `field` or no operators.

Membership in `filterable` is the server-side pushdown signal: a widget filtering on a
declared field has that filter pushed to the source query; any other field is still
filtered client-side by compute (no declaration needed). Connectors translate their
declared filters into source query params in the fetch loop (e.g. GitHub/GitLab/Bitbucket
`state`, Sentry issue `status`/`level`, Stripe subscription/invoice `status`, Vercel
deployment `state`/`target`, Netlify deploy `state`, Jira/Linear/HubSpot/Datadog/Intercom
status/stage filters).

Third-party connector authors must add `filterable` to every entity/event resource in
their `defineResources` call.
