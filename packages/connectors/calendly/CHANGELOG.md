# @rawdash/connector-calendly

## 0.29.1

### Patch Changes

- 7442f64: Add the Calendly connector. Syncs event types (entities), scheduled events (booking events timestamped at their start time, carrying status, event type, host, primary invitee, and no-show counts read from the per-event invitees endpoint), and cancellations (events timestamped at cancellation time with reason and canceler) using a Calendly personal access token and an organization URI. Scheduled events and cancellations are synced over a rolling window and rewritten on every sync; a `resources` allowlist and a configurable lookback window are supported. Drives bookings and no-show stats, bookings-per-day timeseries, and per-event-type / per-host distributions.
- Updated dependencies [d83f3eb]
  - @rawdash/core@0.29.1
