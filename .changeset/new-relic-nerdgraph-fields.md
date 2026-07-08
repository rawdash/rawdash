---
'@rawdash/connector-new-relic': patch
---

Fix two field-name errors that made the alert-condition and alert-violation resources return no data against a real New Relic account.

- Alert conditions: the NerdGraph `nrqlConditionsSearch` query selected `createdAt` and `updatedAt` on each condition. Those are not fields on the NRQL condition type, so NerdGraph rejected the whole query with a validation error and every alert-conditions sync failed. Those fields (and the `createdAt`/`modifiedAt` entity attributes derived from them) are removed; the entity's `updated_at` now falls back to sync time.
- Alert violations (`NrAiIncident`): the NRQL query selected and filtered on attributes that do not exist on the event type — `openedAt`, `closedAt`, `state`, `entityGuid`, `conditionFamilyId`. Because `WHERE openedAt > …` never matched, the incidents phase silently returned zero rows on every sync. It now uses the real attributes `openTime`, `closeTime`, `event`, `entity.guid`, and `conditionId` across the SELECT, `WHERE`, `ORDER BY`, and keyset pagination cursor, and maps them into the violation event's `start_ts`/`end_ts` and attributes.

The example config's `newrelic_alert_violation` filter is updated from the nonexistent `state` attribute to the real `event` attribute.
