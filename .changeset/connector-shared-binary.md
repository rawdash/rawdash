---
'@rawdash/connector-shared': patch
---

Add a `binary` option to `HttpRequest` so connectors can read raw `Uint8Array` response bodies (e.g. UTF-16 CSV downloads) instead of decoded text.
