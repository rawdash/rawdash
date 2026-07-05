---
'@rawdash/core': patch
---

Emit connector lifecycle transition events off the reducer's old→new status diff so deployments can react (alerting, product UI) without reimplementing detection. Transport stays out of core — deployments provide the sink.

New exports: `deriveConnectorLifecycleTransition(previous, next, policy?)` (a pure function returning a `ConnectorLifecycleTransition | null` for a single state change), `advanceConnectorLifecycleWithTransition(state, event, policy?)` (advances the reducer and returns `{ state, transition }`), and the `ConnectorLifecycleTransition` / `ConnectorLifecycleTransitionType` / `ConnectorLifecycleReduction` / `ConnectorLifecycleListener` types.

Transitions cover the noteworthy state changes: `paused` (first crossing the pause threshold), `still-failing` (a paused connector that keeps failing), `auth-failed` (entering `auth_failed`), and `recovered` (a failing connector returning to `idle`). Routine progress (`idle`↔`syncing`, sub-threshold transient errors) yields no transition. Detection keys off `consecutiveFailures` and the pause threshold rather than the raw status, so the interposed `syncing` state during retries does not produce spurious or duplicated events.
