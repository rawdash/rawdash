---
'@rawdash/connector-aws-cloudwatch': patch
'@rawdash/connector-aws-cost': patch
---

Fix the AWS connectors' build so their default export extends the real `@rawdash/core` `BaseConnector`. `@rawdash/connector-aws-shared` listed `@rawdash/core` as a devDependency, so tsup bundled a duplicate `BaseConnector` into its dist; the AWS connectors then inlined that duplicate, and the publish-time default-export check (which compares by prototype identity) failed. `@rawdash/core` is now kept external in the aws-shared build, so there is a single `BaseConnector` instance through the bundled base class.
