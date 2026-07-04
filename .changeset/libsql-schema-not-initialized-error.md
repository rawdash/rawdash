---
'@rawdash/adapter-libsql': patch
---

Throw a typed `SchemaNotInitializedError` (newly exported) when a read hits a missing engine table or column on an unmigrated database, instead of surfacing the raw libSQL driver error. Integrators can now branch on `err instanceof SchemaNotInitializedError` rather than string-matching driver error text.
