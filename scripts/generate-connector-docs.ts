/**
 * Generate connector documentation from connector metadata.
 *
 * Single source of truth = each connector's exported metadata:
 *   - `configFields` (Zod schema)  → the configuration table
 *   - `default` connector class    → id + resource schemas
 *   - `doc` (defineConnectorDoc)   → display name, auth, per-resource docs, example
 *
 * Renders, for every `@rawdash/connector-*` package (except the shared helper):
 *   - the package README.md
 *   - a Starlight docs page at apps/website/src/content/docs/docs/connectors/<id>.mdx
 *   - a connectors catalog index page (cross-connector index, docs superset)
 *
 * Run with the source condition so workspace packages resolve to their TS source:
 *   NODE_OPTIONS=--conditions=@rawdash/source tsx scripts/generate-connector-docs.ts
 *
 * Pass --check to fail (non-zero exit) if regenerating would change any file —
 * this is the CI drift guard.
 */
import type {
  ConnectorCost,
  ConnectorDoc,
  ResourceDefinition,
  ResourceDefinitions,
} from '@rawdash/core';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as prettier from 'prettier';
import { z } from 'zod';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONNECTORS_DIR = join(ROOT, 'packages', 'connectors');
const WEBSITE_DIR = join(ROOT, 'apps', 'website');
const DOCS_CONNECTORS_DIR = join(
  WEBSITE_DIR,
  'src',
  'content',
  'docs',
  'docs',
  'connectors',
);
const PUBLIC_ICONS_DIR = join(WEBSITE_DIR, 'public', 'connectors');
const LANDING_DATA_FILE = join(
  WEBSITE_DIR,
  'src',
  'generated',
  'connectors.ts',
);
// Directories under packages/connectors that are not themselves connectors.
const NOT_A_CONNECTOR = new Set(['aws-shared', 'gcp-shared']);

interface ConnectorModule {
  default: {
    readonly id: string;
    readonly resources?: ResourceDefinitions;
    readonly cost?: ConnectorCost;
  };
  configFields: z.ZodObject<z.ZodRawShape>;
  doc: ConnectorDoc;
}

interface LoadedConnector {
  dir: string;
  packageName: string;
  id: string;
  configFields: z.ZodObject<z.ZodRawShape>;
  doc: ConnectorDoc;
  resources: ResourceDefinitions;
  cost?: ConnectorCost;
  example: string;
  iconSvg: string;
}

interface ConfigField {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  engineering: 'Engineering',
  product: 'Product',
  analytics: 'Analytics',
  marketing: 'Marketing',
  sales: 'Sales',
  support: 'Support',
  finance: 'Finance',
  infrastructure: 'Infrastructure',
  security: 'Security',
};

const SHAPE_LABELS: Record<ResourceDefinition['shape'], string> = {
  entity: 'entity',
  event: 'event',
  metric: 'metric',
  distribution: 'distribution',
  edge: 'edge',
};

function listConnectorDirs(): string[] {
  const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
  return readdirSync(CONNECTORS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !NOT_A_CONNECTOR.has(d.name))
    .map((d) => d.name)
    .filter((name) => !only || only.has(name))
    .sort();
}

async function loadConnector(dir: string): Promise<LoadedConnector> {
  const pkgPath = join(CONNECTORS_DIR, dir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name: string };
  const entry = join(CONNECTORS_DIR, dir, 'src', 'index.ts');
  const mod = (await import(pathToFileURL(entry).href)) as ConnectorModule;
  if (!mod.doc) {
    throw new Error(
      `Connector "${dir}" (${pkg.name}) does not export a \`doc\`. ` +
        `Every connector must declare one via defineConnectorDoc(). ` +
        `If this package is not a connector, add it to NOT_A_CONNECTOR in scripts/generate-connector-docs.ts.`,
    );
  }
  if (!mod.configFields) {
    throw new Error(
      `Connector "${dir}" (${pkg.name}) does not export \`configFields\`.`,
    );
  }
  if (!mod.default.resources) {
    throw new Error(
      `Connector "${dir}" (${pkg.name}) does not declare \`static resources\`. ` +
        `Define them with defineResources() and expose them on the connector class.`,
    );
  }
  const iconPath = join(CONNECTORS_DIR, dir, 'icon.svg');
  if (!existsSync(iconPath)) {
    throw new Error(
      `Connector "${dir}" (${pkg.name}) is missing \`icon.svg\`. ` +
        `Every connector must co-locate a brand icon (see existing connectors; ` +
        `Simple Icons or the vendor's official icon set are good sources).`,
    );
  }
  const examplePath = join(CONNECTORS_DIR, dir, 'src', 'example.config.ts');
  if (!existsSync(examplePath)) {
    throw new Error(
      `Connector "${dir}" (${pkg.name}) is missing \`src/example.config.ts\`. ` +
        `Add a type-checked example config; it is inlined into the docs.`,
    );
  }
  return {
    dir,
    packageName: pkg.name,
    id: mod.default.id,
    configFields: mod.configFields,
    doc: mod.doc,
    resources: mod.default.resources,
    cost: mod.default.cost,
    example: readFileSync(examplePath, 'utf8').trimEnd(),
    iconSvg: readFileSync(iconPath, 'utf8'),
  };
}

function describeConfigFields(
  schema: z.ZodObject<z.ZodRawShape>,
): ConfigField[] {
  const fields: ConfigField[] = [];
  for (const [name, raw] of Object.entries(schema.shape)) {
    const field = raw as z.ZodType;
    const meta = (field.meta?.() ?? {}) as {
      label?: string;
      description?: string;
      secret?: boolean;
    };
    const required = !field.safeParse(undefined).success;
    let inner: z.ZodType = field;
    while (
      inner instanceof z.ZodOptional ||
      inner instanceof z.ZodNullable ||
      inner instanceof z.ZodDefault
    ) {
      inner = inner.unwrap();
    }
    let type: string;
    if (meta.secret) {
      type = 'secret';
    } else if (inner instanceof z.ZodEnum) {
      type = inner.options.map((v) => `\`${v}\``).join(' \\| ');
    } else if (inner instanceof z.ZodString) {
      type = 'string';
    } else if (inner instanceof z.ZodNumber) {
      type = 'number';
    } else if (inner instanceof z.ZodBoolean) {
      type = 'boolean';
    } else if (inner instanceof z.ZodArray) {
      type = 'array';
    } else if (inner instanceof z.ZodObject) {
      type = 'object';
    } else {
      type = 'unknown';
    }
    fields.push({
      name,
      type,
      required,
      description: meta.description ?? meta.label ?? '',
    });
  }
  return fields;
}

function renderConfigTable(fields: ConfigField[]): string {
  if (fields.length === 0) {
    return 'This connector takes no configuration fields.';
  }
  const rows = fields.map(
    (f) =>
      `| \`${f.name}\` | ${f.type} | ${f.required ? 'Yes' : 'No'} | ${f.description} |`,
  );
  return [
    '| Field | Type | Required | Description |',
    '| ----- | ---- | -------- | ----------- |',
    ...rows,
  ].join('\n');
}

function renderResource(name: string, r: ResourceDefinition): string {
  const lines: string[] = [];
  lines.push(
    `- **\`${name}\`** _(${SHAPE_LABELS[r.shape]})_ - ${r.description}`,
  );
  const detail: string[] = [];
  if (r.endpoint) {
    detail.push(`Endpoint: \`${r.endpoint}\``);
  }
  if (r.shape === 'metric') {
    if (r.unit) {
      detail.push(`Unit: ${r.unit}`);
    }
    if (r.granularity) {
      detail.push(`Granularity: ${r.granularity}`);
    }
    if (r.dimensions?.length) {
      detail.push(
        `Dimensions: ${r.dimensions.map((d) => `\`${d.name}\``).join(', ')}`,
      );
    }
  } else if (r.shape === 'distribution') {
    if (r.kind) {
      detail.push(`Buckets: ${r.kind}`);
    }
    if (r.unit) {
      detail.push(`Unit: ${r.unit}`);
    }
  } else if (r.shape === 'edge') {
    if (r.from && r.to) {
      detail.push(`Relates \`${r.from}\` to \`${r.to}\``);
    }
  }
  if (r.notes) {
    detail.push(r.notes);
  }
  for (const d of detail) {
    lines.push(`  - ${d}`);
  }
  if ((r.shape === 'entity' || r.shape === 'event') && r.fields?.length) {
    for (const f of r.fields) {
      lines.push(`  - \`${f.name}\`: ${f.description}`);
    }
  }
  return lines.join('\n');
}

function renderResources(resources: ResourceDefinitions): string {
  return Object.entries(resources)
    .map(([name, r]) => renderResource(name, r))
    .join('\n');
}

function renderAuth(doc: ConnectorDoc): string {
  const lines = [doc.auth.summary, ''];
  doc.auth.setup.forEach((step, i) => {
    lines.push(`${i + 1}. ${step}`);
  });
  return lines.join('\n');
}

function renderCostLines(cost: ConnectorCost): string[] {
  const bits: string[] = [];
  if (cost.warning) {
    bits.push(cost.warning);
  }
  if (cost.recommendedInterval) {
    bits.push(`Recommended sync interval: **${cost.recommendedInterval}**.`);
  }
  if (cost.minInterval) {
    bits.push(`Minimum sensible interval: **${cost.minInterval}**.`);
  }
  if (cost.perSync) {
    bits.push(`Each sync costs roughly: ${cost.perSync}.`);
  }
  return bits;
}

function renderCore(c: LoadedConnector): {
  config: string;
  resources: string;
  auth: string;
} {
  return {
    config: renderConfigTable(describeConfigFields(c.configFields)),
    resources: renderResources(c.resources),
    auth: renderAuth(c.doc),
  };
}

// Every generated file carries one of these banners at the very top (for the
// .mdx outputs, immediately after the frontmatter, which must come first), so
// the artifact is obviously machine-written when read or diffed in isolation.
const GENERATED_MESSAGE =
  'This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand.';
const GENERATED_NOTE = `<!-- ${GENERATED_MESSAGE} -->`;
const GENERATED_NOTE_MDX = `{/* ${GENERATED_MESSAGE} */}`;
const GENERATED_NOTE_TS = `// ${GENERATED_MESSAGE}`;

function renderReadme(c: LoadedConnector): string {
  const core = renderCore(c);
  const { doc, packageName } = c;
  const parts: string[] = [];
  parts.push(GENERATED_NOTE);
  parts.push('');
  parts.push(`# ${packageName}`);
  parts.push('');
  parts.push(
    `[![npm version](https://img.shields.io/npm/v/${packageName})](https://www.npmjs.com/package/${packageName})`,
  );
  parts.push(
    `[![license](https://img.shields.io/npm/l/${packageName})](https://github.com/rawdash/rawdash/blob/main/LICENSE)`,
  );
  parts.push('');
  parts.push(doc.tagline);
  if (c.cost) {
    parts.push('');
    parts.push(`> **Cost & frequency.** ${renderCostLines(c.cost).join(' ')}`);
  }
  parts.push('');
  parts.push('## Install');
  parts.push('');
  parts.push('```sh');
  parts.push(`npm install ${packageName}`);
  parts.push('```');
  parts.push('');
  parts.push('## Authentication');
  parts.push('');
  parts.push(core.auth);
  parts.push('');
  parts.push('## Configuration');
  parts.push('');
  parts.push(core.config);
  parts.push('');
  parts.push('## Resources');
  parts.push('');
  parts.push(core.resources);
  parts.push('');
  parts.push('## Example');
  parts.push('');
  parts.push('```ts');
  parts.push(c.example);
  parts.push('```');
  if (doc.rateLimit) {
    parts.push('');
    parts.push('## Rate limits');
    parts.push('');
    parts.push(doc.rateLimit);
  }
  if (doc.limitations?.length) {
    parts.push('');
    parts.push('## Limitations');
    parts.push('');
    for (const l of doc.limitations) {
      parts.push(`- ${l}`);
    }
  }
  parts.push('');
  parts.push('## Links');
  parts.push('');
  parts.push('- [Rawdash docs](https://rawdash.dev/docs/connectors/)');
  if (doc.vendor.apiDocs) {
    parts.push(`- [${doc.vendor.name} API docs](${doc.vendor.apiDocs})`);
  }
  parts.push('- [GitHub](https://github.com/rawdash/rawdash)');
  parts.push('');
  parts.push('## License');
  parts.push('');
  parts.push('Apache-2.0');
  parts.push('');
  return parts.join('\n');
}

// Escape characters MDX would parse as JSX (`{` expression, `<` tag) in free
// text, while leaving inline code spans untouched (markdown renders `<`/`{`
// inside backticks literally, so escaping there would show the entity). Applied
// only to the .mdx outputs; READMEs are plain markdown where these are literal.
function escapeMdxText(s: string): string {
  return s
    .split(/(`+[^`]*`+)/g)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(/[{}<]/g, (ch) =>
            ch === '{' ? '&#123;' : ch === '}' ? '&#125;' : '&lt;',
          ),
    )
    .join('');
}

function frontmatter(fields: Record<string, string>): string {
  const lines = ['---'];
  for (const [k, v] of Object.entries(fields)) {
    lines.push(`${k}: ${JSON.stringify(v)}`);
  }
  lines.push('---');
  return lines.join('\n');
}

function renderMdx(c: LoadedConnector): string {
  const core = renderCore(c);
  const { doc, packageName, id } = c;
  const parts: string[] = [];
  parts.push(
    frontmatter({
      title: doc.displayName,
      description: doc.tagline,
    }),
  );
  parts.push('');
  parts.push(GENERATED_NOTE_MDX);
  parts.push('');
  parts.push("import { Aside, Badge } from '@astrojs/starlight/components';");
  parts.push('');
  parts.push(
    `<p style="display:flex;align-items:center;gap:0.75rem;margin:0 0 1rem;"><img src="/connectors/${id}.svg" alt="${doc.displayName} logo" width="40" height="40" style="background:#fff;border-radius:8px;padding:6px;box-sizing:border-box;" /> <Badge text="${CATEGORY_LABELS[doc.category] ?? doc.category}" variant="tip" /> <Badge text="${packageName}" variant="note" /></p>`,
  );
  parts.push('');
  parts.push(escapeMdxText(doc.tagline));
  parts.push('');
  if (c.cost) {
    parts.push(
      `<Aside type="caution" title="Cost & frequency">${escapeMdxText(renderCostLines(c.cost).join(' '))}</Aside>`,
    );
    parts.push('');
  }
  if (doc.vendor.apiDocs) {
    parts.push(
      `<Aside title="Vendor">Data source: [${doc.vendor.name}](${doc.vendor.website ?? doc.vendor.apiDocs}) · [API docs](${doc.vendor.apiDocs})</Aside>`,
    );
    parts.push('');
  }
  parts.push('## Install');
  parts.push('');
  parts.push('```sh');
  parts.push(`npm install ${packageName}`);
  parts.push('```');
  parts.push('');
  parts.push('## Authentication');
  parts.push('');
  parts.push(escapeMdxText(core.auth));
  parts.push('');
  parts.push('## Configuration');
  parts.push('');
  parts.push(escapeMdxText(core.config));
  parts.push('');
  parts.push('## Resources');
  parts.push('');
  parts.push(escapeMdxText(core.resources));
  parts.push('');
  parts.push('## Example');
  parts.push('');
  parts.push('```ts');
  parts.push(c.example);
  parts.push('```');
  if (doc.rateLimit) {
    parts.push('');
    parts.push('## Rate limits');
    parts.push('');
    parts.push(escapeMdxText(doc.rateLimit));
  }
  if (doc.limitations?.length) {
    parts.push('');
    parts.push('## Limitations');
    parts.push('');
    for (const l of doc.limitations) {
      parts.push(`- ${escapeMdxText(l)}`);
    }
  }
  parts.push('');
  return parts.join('\n');
}

const ICON_ATTRIBUTION =
  'Connector logos are trademarks of their respective owners and are shown for identification only. Icons are sourced from [Simple Icons](https://simpleicons.org/) (CC0) and, for AWS services, the [AWS Architecture Icons](https://aws.amazon.com/architecture/icons/) set.';

function groupByCategory(
  connectors: LoadedConnector[],
): Map<string, LoadedConnector[]> {
  const byCategory = new Map<string, LoadedConnector[]>();
  for (const c of connectors) {
    const list = byCategory.get(c.doc.category) ?? [];
    list.push(c);
    byCategory.set(c.doc.category, list);
  }
  for (const list of byCategory.values()) {
    list.sort((a, b) => a.doc.displayName.localeCompare(b.doc.displayName));
  }
  return byCategory;
}

function connectorUrl(c: LoadedConnector): string {
  return `/docs/connectors/${c.doc.category}/${c.id}/`;
}

// Top-level overview: a connector search plus category cards. The cards (and
// their counts) are rendered from the generated catalog data, so the page never
// lists individual connectors in prose and never goes stale.
function renderTopIndex(): string {
  const parts: string[] = [];
  parts.push(
    frontmatter({
      title: 'Connectors',
      description: 'Browse the built-in Rawdash connectors by category.',
    }),
  );
  parts.push('');
  parts.push(GENERATED_NOTE_MDX);
  parts.push('');
  parts.push(
    "import ConnectorCategoryGrid from '../../../../components/ConnectorCategoryGrid.astro';",
  );
  parts.push('');
  parts.push(
    'Rawdash ships built-in connectors, grouped by category. Each syncs data from a third-party API into the storage engine, where your widgets query it. Search for a connector, or pick a category to browse.',
  );
  parts.push('');
  parts.push('<ConnectorCategoryGrid />');
  parts.push('');
  parts.push('---');
  parts.push('');
  parts.push(ICON_ATTRIBUTION);
  parts.push('');
  return parts.join('\n');
}

// One page per category, showing that category's connectors as cards.
function renderCategoryIndex(category: string): string {
  const label = CATEGORY_LABELS[category] ?? category;
  const parts: string[] = [];
  parts.push(
    frontmatter({
      title: label,
      description: `${label} connectors for Rawdash.`,
    }),
  );
  parts.push('');
  parts.push(GENERATED_NOTE_MDX);
  parts.push('');
  parts.push(
    "import ConnectorGrid from '../../../../../components/ConnectorGrid.astro';",
  );
  parts.push('');
  parts.push(`<ConnectorGrid category="${category}" />`);
  parts.push('');
  return parts.join('\n');
}

// Distinct lowercase tokens a connector should match on beyond its name and
// tagline: resource keys, the vendor name, and the package name. Powers the
// catalog quick-filter's "search by resource" without bloating the card UI.
function connectorKeywords(c: LoadedConnector): string[] {
  const tokens = new Set<string>();
  for (const key of Object.keys(c.resources)) {
    tokens.add(key.toLowerCase());
  }
  tokens.add(c.doc.vendor.name.toLowerCase());
  tokens.add(c.packageName.toLowerCase());
  return [...tokens].sort();
}

function renderLandingData(
  connectors: LoadedConnector[],
  byCategory: Map<string, LoadedConnector[]>,
): string {
  const items = connectors
    .slice()
    .sort((a, b) => a.doc.displayName.localeCompare(b.doc.displayName))
    .map((c) => ({
      id: c.id,
      name: c.doc.displayName,
      category: c.doc.category,
      categoryLabel: CATEGORY_LABELS[c.doc.category] ?? c.doc.category,
      tagline: c.doc.tagline,
      href: connectorUrl(c),
      iconPath: `/connectors/${c.id}.svg`,
      brandColor: c.doc.brandColor ?? null,
      keywords: connectorKeywords(c),
    }));
  const categories = Object.keys(CATEGORY_LABELS)
    .filter((category) => byCategory.get(category)?.length)
    .map((category) => ({
      id: category,
      label: CATEGORY_LABELS[category],
      count: byCategory.get(category)!.length,
    }));
  return [
    GENERATED_NOTE_TS,
    '',
    'export interface ConnectorCard {',
    '  id: string;',
    '  name: string;',
    '  category: string;',
    '  categoryLabel: string;',
    '  tagline: string;',
    '  href: string;',
    '  iconPath: string;',
    '  brandColor: string | null;',
    '  keywords: string[];',
    '}',
    '',
    'export interface ConnectorCategory {',
    '  id: string;',
    '  label: string;',
    '  count: number;',
    '}',
    '',
    `export const connectors: ConnectorCard[] = ${JSON.stringify(items, null, 2)};`,
    '',
    `export const connectorCategories: ConnectorCategory[] = ${JSON.stringify(categories, null, 2)};`,
    '',
  ].join('\n');
}

interface OutFile {
  path: string;
  content: string;
  raw?: boolean;
  // Whether the output is committed to git (default true). The website docs
  // tree, public icons, and landing data are gitignored and regenerated at
  // build time, so they are never committed drift; --check ignores them.
  tracked?: boolean;
}

async function formatOutput(file: OutFile): Promise<string> {
  if (file.raw) {
    return file.content;
  }
  const parser = file.path.endsWith('.mdx')
    ? 'mdx'
    : file.path.endsWith('.ts')
      ? 'typescript'
      : 'markdown';
  const config = await prettier.resolveConfig(file.path);
  return prettier.format(file.content, { ...config, parser });
}

function collectOutputs(connectors: LoadedConnector[]): OutFile[] {
  const out: OutFile[] = [];
  const byCategory = groupByCategory(connectors);
  for (const c of connectors) {
    out.push({
      path: join(CONNECTORS_DIR, c.dir, 'README.md'),
      content: renderReadme(c),
    });
    out.push({
      path: join(DOCS_CONNECTORS_DIR, c.doc.category, `${c.id}.mdx`),
      content: renderMdx(c),
      tracked: false,
    });
    out.push({
      path: join(PUBLIC_ICONS_DIR, `${c.id}.svg`),
      content: c.iconSvg,
      raw: true,
      tracked: false,
    });
  }
  for (const category of byCategory.keys()) {
    out.push({
      path: join(DOCS_CONNECTORS_DIR, category, 'index.mdx'),
      content: renderCategoryIndex(category),
      tracked: false,
    });
  }
  out.push({
    path: join(DOCS_CONNECTORS_DIR, 'index.mdx'),
    content: renderTopIndex(),
    tracked: false,
  });
  out.push({
    path: LANDING_DATA_FILE,
    content: renderLandingData(connectors, byCategory),
    tracked: false,
  });
  return out;
}

// Recursively list files under a directory (absolute paths); empty if missing.
function listFilesRecursive(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

// Files the generator owns and may prune: the connector docs tree and the
// public connector icons. Anything here not in the current output set is stale.
function findStaleOutputs(expected: Set<string>): string[] {
  const managed = [
    ...listFilesRecursive(DOCS_CONNECTORS_DIR),
    ...listFilesRecursive(PUBLIC_ICONS_DIR),
  ];
  return managed.filter((p) => !expected.has(p));
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const dirs = listConnectorDirs();
  const connectors: LoadedConnector[] = [];
  for (const dir of dirs) {
    connectors.push(await loadConnector(dir));
  }
  connectors.sort((a, b) => a.id.localeCompare(b.id));

  const outputs = collectOutputs(connectors);
  const drifted: string[] = [];
  const dashes: string[] = [];
  for (const file of outputs) {
    const content = await formatOutput(file);
    if (
      (file.path.endsWith('.md') || file.path.endsWith('.mdx')) &&
      /[—–]/.test(content)
    ) {
      for (const line of content.split('\n')) {
        if (/[—–]/.test(line)) {
          dashes.push(`${file.path.replace(`${ROOT}/`, '')}: ${line.trim()}`);
        }
      }
    }
    // --check only guards committed files; the gitignored website tree is
    // regenerated at build time, so its absence/staleness is never drift.
    if (check && file.tracked === false) {
      continue;
    }
    let existing: string | null = null;
    try {
      existing = readFileSync(file.path, 'utf8');
    } catch {
      existing = null;
    }
    if (existing === content) {
      continue;
    }
    if (check) {
      drifted.push(file.path);
    } else {
      mkdirSync(dirname(file.path), { recursive: true });
      writeFileSync(file.path, content);
    }
  }

  // Prune generated files that are no longer produced (e.g. a removed
  // connector or the old flat layout). Only meaningful when writing: the
  // managed trees (docs + icons) are gitignored, so a stale file there is a
  // local leftover, never committed drift, and --check must not flag it.
  if (!check) {
    const expected = new Set(outputs.map((o) => o.path));
    for (const path of findStaleOutputs(expected)) {
      rmSync(path);
    }
  }

  if (dashes.length > 0) {
    console.error(
      `Connector docs must use regular dashes, not em-dashes (—) or en-dashes (–). ` +
        `Fix the offending connector metadata:\n${dashes
          .map((d) => `  - ${d}`)
          .join('\n')}`,
    );
    process.exit(1);
  }

  if (check) {
    if (drifted.length > 0) {
      console.error(
        `Connector docs are out of date. Run \`pnpm docs:connectors\` and commit the result.\nDrifted files:\n${drifted
          .map((p) => `  - ${p.replace(`${ROOT}/`, '')}`)
          .join('\n')}`,
      );
      process.exit(1);
    }
    console.log(
      `Connector docs are up to date (${connectors.length} connectors).`,
    );
  } else {
    console.log(
      `Generated docs for ${connectors.length} connectors (${outputs.length} files).`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
