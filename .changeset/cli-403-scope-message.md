---
'@rawdash/cli': patch
---

Stop labelling every `403` from the API as "Key lacks config:write scope". The CLI now branches on the server's error `code`: the scope message is shown only for `insufficient_scope` (echoing the `required` scope), and any other `403` surfaces the server's actual message and code. Failures also print the request URL, and a slug-less `RAWDASH_URL` (e.g. `https://api.rawdash.dev` with no org slug) gets an explicit hint that the hosted service expects `https://api.rawdash.dev/<org-slug>`. The same request-context detail now appears on `secrets` command failures too.
