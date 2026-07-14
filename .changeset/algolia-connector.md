---
'@rawdash/connector-algolia': patch
---

Add the Algolia connector. It syncs Algolia site-search analytics into the six-shape storage model as daily metric series per index — search volume (`algolia_search_count`), click-through rate (`algolia_click_through_rate`), no-result rate (`algolia_no_results_rate`), and average click position (`algolia_average_click_position`) — plus window-aggregated top queries (`algolia_top_queries`) and no-result queries (`algolia_no_result_queries`). Authenticates with an Application ID and an analytics-scoped API key, supports the US and EU analytics regions, and does backfill plus incremental (`latest`) syncs with a configurable lookback window.
