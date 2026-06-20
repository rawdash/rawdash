---
'@rawdash/connector-monday': minor
---

Add the monday.com connector. Syncs boards and items as entities and item activity events from the monday.com GraphQL API using an API token. Walks one board at a time, pages items via `items_page`/`next_items_page`, and filters activity logs server-side by date for incremental syncs. Backfill and incremental modes are both supported.
