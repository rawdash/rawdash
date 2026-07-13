---
'@rawdash/connector-google-search-console': patch
---

Fix three Search Console API-correctness issues. Search Console only returns finalized data by default, which is unavailable for the most recent 2-3 days, so the previous 3-day incremental window (`[now-2, now]`) sat entirely inside that lag and never re-covered the day that just finalized — recent metrics only appeared after a full sync. Incremental syncs now refetch a trailing window that spans the finalization lag plus a revision buffer. Search Console also reports all dates in the America/Los_Angeles time zone; window bounds were computed in UTC, shifting the window by a day near the boundary, and are now anchored on the Pacific calendar date. Finally, `options.resources` is now honored by resource (metric) name, so a scoped sync no longer queries and rewrites all four metrics.
