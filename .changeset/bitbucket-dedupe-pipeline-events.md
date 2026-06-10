---
'@rawdash/connector-bitbucket': patch
---

Deduplicate Bitbucket pipeline writes by uuid within a sync so a pipeline that repeats across pages (or within a single page) yields exactly one `pipeline` entity and one `pipeline_event`, instead of double-counting events. Entities already deduped via last-write-wins on their id, but `pipeline_event` rows were appended once per occurrence.
