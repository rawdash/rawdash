---
'@rawdash/connector-gcp-monitoring': patch
---

Stop wiping metric history on incremental syncs and honor `options.resources`. Each sync fetches only a trailing time window of Cloud Monitoring points (roughly the last few alignment periods on a `latest` sync, `[since, now]` incrementally), but persisted them with a replace-by-name write that deleted every previously stored sample for the configured metric types. The write now scopes the replacement to the fetched `[start, end]` interval via `replaceWindow`, so samples outside the window survive. Additionally, `sync` now filters the configured metric queries by `options.resources` (matched against each query's metric type), skipping unrequested metric types and writing nothing when no configured metric type matches.
