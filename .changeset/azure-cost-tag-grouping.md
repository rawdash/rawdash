---
'@rawdash/connector-azure-cost': patch
---

Fix `TAG:<key>` group-bys sending an invalid Cost Management grouping type. The `QueryGrouping.type` enum only accepts `Dimension` or `TagKey`, but tag group-bys were emitting `Tag`, so the Cost Management query API rejected (or silently dropped) the grouping. Tag group-bys now send `type: 'TagKey'`.
