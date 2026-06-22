# @rawdash/connector-monday

## 0.28.0

### Patch Changes

- 880a584: Add the monday.com connector. Syncs boards and items as entities and item activity events from the monday.com GraphQL API using an API token. Walks one board at a time, pages items via `items_page`/`next_items_page`, and filters activity logs server-side by date for incremental syncs. Backfill and incremental modes are both supported.
- Updated dependencies [0e4102e]
- Updated dependencies [204204a]
  - @rawdash/core@0.28.0
