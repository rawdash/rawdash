---
'@rawdash/connector-hubspot': patch
---

Fix HubSpot CRM Search backfills exceeding 10,000 records and broaden email campaign coverage. CRM contact/company/deal syncs now re-anchor the modified-date filter when the Search API's 10,000-result ceiling is reached, instead of failing with an HTTP 400 once pagination crosses that boundary. Email campaigns and stats now enumerate via the all-campaigns endpoint so campaigns without recent activity are no longer silently omitted.
