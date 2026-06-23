---
'@rawdash/connector-google-play-console': patch
---

Add install/uninstall statistics to the Google Play Console connector. New `gplay_installs_*` resources (overview, country, app_version, device, os_version, language, carrier) read the monthly `stats/installs` CSV reports from your Play Console Cloud Storage bucket and emit daily install/uninstall/upgrade metrics. Set the new `installsBucketId` config field and grant the service account Storage Object Viewer on that bucket to enable them; the existing vitals and ratings resources are unchanged and work without it.
