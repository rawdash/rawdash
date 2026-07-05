---
'@rawdash/connector-cal-com': patch
---

Add the Cal.com connector. It syncs event types as `cal_com_event_type` entities and bookings as `cal_com_booking` events (carrying status, event type, host, primary attendee, attendee/no-show counts, location, and duration), plus `cal_com_cancellation` events derived from cancelled bookings, from the Cal.com API v2 into the six-shape storage model. Bookings are synced over a configurable rolling window with cursor pagination and rewritten on every sync; booking-volume, cancellation-rate, no-show, and meeting-mix metrics are derived at the widget level from the event stream. Supports self-hosted instances via an optional `apiBaseUrl`.
