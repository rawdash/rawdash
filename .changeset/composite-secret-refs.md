---
'@rawdash/core': minor
'@rawdash/cli': minor
---

Support composite (object) secret values via `secret()` references.

- `@rawdash/core`: add `withSecretRef(schema)` helper for connector authors to declare credential fields that accept either a fully-resolved value (string, object, array, …) or a `{ $secret: 'NAME' }` reference. Extend `EnvSecretsResolver` with a JSON-parse heuristic: env var values starting with `{` or `[` are parsed as JSON; anything else (including PATs like `ghp_…`) stays a string. `SecretsResolver.resolve` is now typed `unknown` instead of `string | undefined` to allow resolved object/array values — implementers of the interface should widen accordingly.
- `@rawdash/cli`: `rawdash secrets set <NAME>` now accepts `--json '<inline json>'` and `--from-file <path>`. Both validate that the input parses as JSON before any network call; combining either with a positional value (or with each other) errors. The plaintext is forwarded as-is to the secret store, and the runtime resolver parses it back on use.
