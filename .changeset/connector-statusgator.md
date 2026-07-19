---
'@rawdash/connector-statusgator': minor
---

Add `@rawdash/connector-statusgator`, a connector for StatusGator that aggregates the public status pages of the third-party services you depend on into a single "is anything down?" view. It syncs two resources: `statusgator_service` (entities — the services watched on your boards, each with its current aggregated health: up / warn / down / maintenance) and `statusgator_status_change` (events — status transitions derived from board history, carrying `from`, `to`, and the service the transition belongs to). Authenticates with a StatusGator API token, syncs a single board (`boardId`) or every board on the account, supports an optional `services` allow-list, and does backfill plus incremental (poll) sync.
