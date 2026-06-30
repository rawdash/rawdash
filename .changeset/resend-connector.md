---
'@rawdash/connector-resend': patch
---

Add the Resend connector. It syncs sent-email activity as `resend_email` events (carrying the sender, sending domain, subject, recipient count, and latest delivery state) and sending domains as `resend_domain` entities (verification status, region, capabilities) from the Resend API into the six-shape storage model, with newest-first paging, an incremental `since` short-circuit, and a configurable full-sync lookback window. Send volume, delivery, and bounce rates are derived at the widget level from the email event stream, since Resend exposes no aggregate-stats API.
