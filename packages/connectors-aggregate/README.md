# @rawdash/connectors

[![npm version](https://img.shields.io/npm/v/@rawdash/connectors)](https://www.npmjs.com/package/@rawdash/connectors)
[![license](https://img.shields.io/npm/l/@rawdash/connectors)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Aggregate package that bundles every built-in Rawdash connector. Depend on
this one package instead of listing each `@rawdash/connector-*` package
individually — adding a connector to the monorepo flows into the aggregate
automatically, with no consumer-side changes and no version drift.

The contents are generated at build time from the connector packages by
`scripts/generate-connectors-package.ts`.

## Install

```sh
npm install @rawdash/connectors
```

## Entry points

The package has two subpath exports, deliberately split so a metadata-only
consumer never bundles connector sync logic:

### `@rawdash/connectors/metadata`

Metadata only — the display, configuration, and cost descriptors a catalog
needs, never the runnable connector class. Combined with `sideEffects: false`,
a bundler tree-shakes the connector class bodies out of a metadata-only build.

```ts
import {
  connectorMetadata,
  connectorMetadataById,
} from '@rawdash/connectors/metadata';

for (const c of connectorMetadata) {
  console.log(c.id, c.doc.displayName);
}

const github = connectorMetadataById['github-actions'];
```

Each entry exposes `id`, `packageName`, `doc`, `configFields`, `resources`, and
(where the connector declares one) `cost`.

### `@rawdash/connectors/registry`

The runnable connector classes, behind per-connector lazy loaders. The dynamic
`import()` per connector preserves the lazy-load boundary: resolving one
connector never pulls the others' class or sync code into the same chunk.

```ts
import {
  connectorIds,
  connectorLoaders,
  loadConnector,
} from '@rawdash/connectors/registry';

const GitHubConnector = await loadConnector('github-actions');
```

## License

Apache-2.0
