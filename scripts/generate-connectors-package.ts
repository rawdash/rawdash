/**
 * Generate the `@rawdash/connectors` umbrella package from the connector
 * packages in this monorepo.
 *
 * Single source of truth = the connector packages under `packages/connectors/`.
 * Adding a connector there flows into the umbrella automatically — consumers
 * depend on the one umbrella package instead of N individual ones, with no
 * consumer-side changes and no version drift.
 *
 * Emits three build-time artifacts in the umbrella package:
 *   - `src/metadata.generated.ts` — re-exports each connector's metadata
 *     (`id`, `doc`, `configFields`, `resources`, `cost`). This is the
 *     metadata-only surface the cloud catalog consumes; it never re-exports
 *     sync logic, and combined with `sideEffects:false` the connector class
 *     bodies tree-shake out of a metadata-only bundle.
 *   - `src/registry.generated.ts` — a map of connector id → lazy
 *     `() => import('@rawdash/connector-*')` loader, preserving the
 *     per-connector lazy-load boundary for sync consumers.
 *   - `package.json` `dependencies` — the `@rawdash/connector-*` set, kept in
 *     lockstep with the discovered connectors.
 *
 * Run with the source condition so workspace packages resolve to their TS
 * source (no prior build needed):
 *   NODE_OPTIONS=--conditions=@rawdash/source tsx scripts/generate-connectors-package.ts
 *
 * Pass --check to fail (non-zero exit) if regenerating would change any file —
 * this is the CI drift guard.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as prettier from 'prettier';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONNECTORS_DIR = join(ROOT, 'packages', 'connectors');
const PKG_DIR = join(ROOT, 'packages', 'connectors-umbrella');
const SRC_DIR = join(PKG_DIR, 'src');
const PKG_JSON_PATH = join(PKG_DIR, 'package.json');

// Directories under packages/connectors that are not themselves connectors.
const NOT_A_CONNECTOR = new Set(['aws-shared']);

const GENERATED_MESSAGE =
  'This file is generated from the connector packages by scripts/generate-connectors-package.ts. Do not edit by hand.';
const GENERATED_NOTE_TS = `// ${GENERATED_MESSAGE}`;

interface LoadedConnector {
  dir: string;
  packageName: string;
  id: string;
  hasCost: boolean;
  /** camelCase identifier prefix used for generated import bindings. */
  ident: string;
}

// The umbrella's metadata entry imports only these named exports — never the
// default connector class — so a metadata-only consumer never bundles connector
// sync code. Each connector must therefore expose its metadata as standalone
// named exports (`id`, `doc`, `configFields`, `resources`, and optionally
// `cost`) rather than only as class statics.
interface ConnectorModule {
  default?: unknown;
  id?: string;
  doc?: unknown;
  configFields?: unknown;
  resources?: unknown;
  cost?: unknown;
}

// Deterministic, locale-independent string order. `localeCompare` collation
// varies across platforms/ICU builds (macOS vs CI Linux), which would make the
// generated ordering drift between machines; a code-unit compare never does.
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function listConnectorDirs(): string[] {
  return readdirSync(CONNECTORS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !NOT_A_CONNECTOR.has(d.name))
    .map((d) => d.name)
    .sort();
}

function toIdent(dir: string): string {
  return dir.replace(/[-_]+([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

async function loadConnector(dir: string): Promise<LoadedConnector> {
  const pkgPath = join(CONNECTORS_DIR, dir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name: string };
  const entry = join(CONNECTORS_DIR, dir, 'src', 'index.ts');
  const mod = (await import(pathToFileURL(entry).href)) as ConnectorModule;
  if (!mod.default) {
    throw new Error(
      `Connector "${dir}" (${pkg.name}) has no default export. ` +
        `Every connector must export its BaseConnector subclass as the default export.`,
    );
  }
  for (const name of ['id', 'doc', 'configFields', 'resources'] as const) {
    if (mod[name] === undefined) {
      throw new Error(
        `Connector "${dir}" (${pkg.name}) does not export \`${name}\` as a named export. ` +
          `The umbrella's metadata entry imports metadata by name (never off the ` +
          `connector class) so a metadata-only consumer never bundles connector ` +
          `sync code; expose \`id\`, \`doc\`, \`configFields\`, and \`resources\` ` +
          `(and optionally \`cost\`) as named exports.`,
      );
    }
  }
  return {
    dir,
    packageName: pkg.name,
    id: mod.id as string,
    hasCost: mod.cost !== undefined,
    ident: toIdent(dir),
  };
}

function renderMetadataModule(connectors: LoadedConnector[]): string {
  const imports = connectors
    .map((c) => {
      const specifiers = [
        `  configFields as ${c.ident}ConfigFields,`,
        `  doc as ${c.ident}Doc,`,
        `  id as ${c.ident}Id,`,
        `  resources as ${c.ident}Resources,`,
      ];
      if (c.hasCost) {
        specifiers.push(`  cost as ${c.ident}Cost,`);
      }
      return [`import {`, ...specifiers, `} from '${c.packageName}';`].join(
        '\n',
      );
    })
    .join('\n');
  const entries = connectors
    .map((c) => {
      const lines = [
        `  {`,
        `    id: ${c.ident}Id,`,
        `    packageName: '${c.packageName}',`,
        `    doc: ${c.ident}Doc,`,
        `    configFields: ${c.ident}ConfigFields,`,
        `    resources: ${c.ident}Resources,`,
      ];
      if (c.hasCost) {
        lines.push(`    cost: ${c.ident}Cost,`);
      }
      lines.push(`  },`);
      return lines.join('\n');
    })
    .join('\n');
  return [
    GENERATED_NOTE_TS,
    '',
    `import type { ConnectorMetadata } from './types';`,
    '',
    imports,
    '',
    `export const connectorMetadata: ConnectorMetadata[] = [`,
    entries,
    `];`,
    '',
  ].join('\n');
}

function renderRegistryModule(connectors: LoadedConnector[]): string {
  const entries = connectors
    .map(
      (c) =>
        `  '${c.id}': () =>\n` +
        `    import('${c.packageName}').then((m) => m.default),`,
    )
    .join('\n');
  return [
    GENERATED_NOTE_TS,
    '',
    `import type { ConnectorClass } from '@rawdash/core';`,
    '',
    `export const connectorLoaders: Record<`,
    `  string,`,
    `  () => Promise<ConnectorClass>`,
    `> = {`,
    entries,
    `};`,
    '',
  ].join('\n');
}

// Rewrite the umbrella package.json so its @rawdash/connector-* dependencies
// exactly match the discovered connector set (lockstep, no drift). Non-connector
// dependencies (@rawdash/core, zod) and every other field are preserved.
function renderPackageJson(connectors: LoadedConnector[]): string {
  const pkg = JSON.parse(readFileSync(PKG_JSON_PATH, 'utf8')) as {
    dependencies?: Record<string, string>;
    [k: string]: unknown;
  };
  const deps = pkg.dependencies ?? {};
  const kept = Object.fromEntries(
    Object.entries(deps).filter(
      ([name]) => !name.startsWith('@rawdash/connector-'),
    ),
  );
  const connectorDeps = Object.fromEntries(
    connectors.map((c) => [c.packageName, 'workspace:*']),
  );
  pkg.dependencies = Object.fromEntries(
    [...Object.entries(connectorDeps), ...Object.entries(kept)].sort(
      ([a], [b]) => byCodeUnit(a, b),
    ),
  );
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

interface OutFile {
  path: string;
  content: string;
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const dirs = listConnectorDirs();
  const connectors: LoadedConnector[] = [];
  for (const dir of dirs) {
    connectors.push(await loadConnector(dir));
  }
  connectors.sort((a, b) => byCodeUnit(a.id, b.id));

  const outputs: OutFile[] = [
    {
      path: join(SRC_DIR, 'metadata.generated.ts'),
      content: renderMetadataModule(connectors),
    },
    {
      path: join(SRC_DIR, 'registry.generated.ts'),
      content: renderRegistryModule(connectors),
    },
    {
      path: PKG_JSON_PATH,
      content: renderPackageJson(connectors),
    },
  ];

  const drifted: string[] = [];
  for (const file of outputs) {
    const config = await prettier.resolveConfig(file.path);
    const formatted = await prettier.format(file.content, {
      ...config,
      filepath: file.path,
    });
    let existing: string | null = null;
    try {
      existing = readFileSync(file.path, 'utf8');
    } catch {
      existing = null;
    }
    if (existing === formatted) {
      continue;
    }
    if (check) {
      drifted.push(file.path);
      const expected = (formatted ?? '').split('\n');
      const actual = (existing ?? '').split('\n');
      const max = Math.max(expected.length, actual.length);
      for (let i = 0; i < max; i++) {
        if (expected[i] !== actual[i]) {
          console.error(
            `\nFirst diff in ${file.path.replace(`${ROOT}/`, '')} at line ${i + 1}:\n` +
              `  committed: ${JSON.stringify(actual[i])}\n` +
              `  generated: ${JSON.stringify(expected[i])}`,
          );
          break;
        }
      }
    } else {
      writeFileSync(file.path, formatted);
    }
  }

  if (check) {
    if (drifted.length > 0) {
      console.error(
        `\n@rawdash/connectors umbrella package is out of date. Run ` +
          `\`pnpm gen:connectors-package\` and commit the result.\nDrifted files:\n${drifted
            .map((p) => `  - ${p.replace(`${ROOT}/`, '')}`)
            .join('\n')}`,
      );
      process.exit(1);
    }
    console.log(
      `@rawdash/connectors umbrella package is up to date (${connectors.length} connectors).`,
    );
  } else {
    console.log(
      `Generated @rawdash/connectors umbrella package for ${connectors.length} connectors.`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
