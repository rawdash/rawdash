---
'@rawdash/core': patch
'@rawdash/adapter-libsql': patch
'@rawdash/server': patch
---

Cancellable per-run storage handles. `ServerStorage.getStorageHandle()` now accepts an optional `{ signal: AbortSignal }`; when the signal aborts, every subsequent write on the returned `StorageHandle` becomes a no-op with a single `console.warn`. The HTTP `/sync` route wires the per-connector timeout controller through, so a connector that times out can no longer leak tail writes into the next sync run even if it ignores its own `AbortSignal`. Reads on the handle are unaffected. `InMemoryStorage` and `LibsqlStorage` apply the wrapping automatically; external `ServerStorage` implementations get the same behavior for free if they forward the option (or by composing with the exported `withAbortSignal(handle, signal)` helper).
