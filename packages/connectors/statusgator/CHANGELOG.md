# @rawdash/connector-statusgator

## 0.29.2

### Patch Changes

- Add `@rawdash/connector-statusgator`, a connector for StatusGator that aggregates the public status pages of the third-party services you depend on into a single "is anything down?" view. It syncs two resources: `statusgator_service` (entities — the services watched on your boards, each with its current aggregated health) and `statusgator_status_change` (events — status transitions derived from board history, with `from`/`to`/`occurredAt`). Authenticates with a StatusGator API token, syncs a single board or every board on the account, supports an optional service allow-list, and does backfill plus incremental (poll) sync.
