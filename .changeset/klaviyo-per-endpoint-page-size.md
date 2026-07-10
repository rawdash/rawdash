---
'@rawdash/connector-klaviyo': patch
---

Cap `page[size]` at each Klaviyo endpoint's documented maximum (lists 10, segments 10, flows 50, campaigns 100) instead of a fixed 100. The lists, segments, and flows endpoints reject `page[size]=100` with an HTTP 400, so those three resources previously returned no data on every sync.
