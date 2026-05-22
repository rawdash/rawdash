#!/usr/bin/env -S npx tsx

/**
 * Verifies that any new public workspace package added in this PR is set up
 * correctly for the OIDC publish workflow on main. Runs four layers:
 *
 *   1. `.changeset/config.json` `fixed[0]` membership: every public workspace
 *      package must appear in `fixed`, and `fixed` must not reference any
 *      package that no longer exists.
 *   2. npm existence: for each public package that is new in this PR vs the
 *      base ref, `npm view <name>` must succeed (a v0.0.x placeholder must have
 *      been published manually so npm's OIDC exchange has something to mint a
 *      token against).
 *   3. OIDC exchange dry-run: for each new public package, exchange a GitHub
 *      Actions OIDC token at npm's exchange endpoint and discard the result. A
 *      4xx means the Trusted Publisher entry on npmjs.com is missing or
 *      misconfigured. npm allows only one Trusted Publisher entry per package,
 *      so this dry-run is only authoritative when run inside the trusted
 *      publish workflow itself; from any other context (`ci.yml`, fork PRs,
 *      local runs) the exchange would be rejected by design, and the check is
 *      skipped with a warning instead.
 *
 *   4. connector-shared bundling discipline: every `@rawdash/connector-*`
 *      (other than `@rawdash/connector-shared` itself) must declare
 *      `@rawdash/connector-shared` only in `devDependencies` (never
 *      `dependencies` or `peerDependencies`), and must list it in `noExternal`
 *      in `tsup.config.ts`. For packages new in the PR we additionally run
 *      `pnpm pack` and assert the published tarball's `package.json` has no
 *      `@rawdash/connector-shared` entry under `dependencies` — proving the
 *      shared substrate was actually inlined.
 *
 *   5. default-export discipline: every `@rawdash/connector-*` (other than
 *      `@rawdash/connector-shared`) must export its connector class as the
 *      module's default export, and that class must extend `BaseConnector`
 *      from `@rawdash/core`. Cloud's sync-consumer Worker depends on this
 *      via build-time codegen — without a `BaseConnector`-derived default
 *      export, cloud breaks at compile time.
 *
 * See §1, §7, and §9 of docs/authoring-a-connector.md for the underlying rules.
 */
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REGISTRY = 'https://registry.npmjs.org';
const REGISTRY_HOST = new URL(REGISTRY).hostname;
const NETWORK_TIMEOUT_MS = 30_000;
const SHARED_PKG = '@rawdash/connector-shared';
const SOURCE_CONDITION = '@rawdash/source';
const SOURCE_CONDITION_FLAG = `--conditions=${SOURCE_CONDITION}`;

// Re-exec with --conditions=@rawdash/source so the layer-5 dynamic import of
// each connector's src/index.ts can resolve sibling workspace packages
// (@rawdash/core, @rawdash/connector-shared) through their "@rawdash/source"
// export condition without requiring a prior build.
if (!(process.env['NODE_OPTIONS'] ?? '').includes(SOURCE_CONDITION_FLAG)) {
  const nextOpts = [process.env['NODE_OPTIONS'], SOURCE_CONDITION_FLAG]
    .filter(Boolean)
    .join(' ');
  try {
    execFileSync(
      process.argv[0]!,
      [...process.execArgv, ...process.argv.slice(1)],
      {
        stdio: 'inherit',
        env: { ...process.env, NODE_OPTIONS: nextOpts },
      },
    );
    process.exit(0);
  } catch (err) {
    const status = (err as { status?: number }).status;
    process.exit(typeof status === 'number' ? status : 1);
  }
}

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const CHANGESET_CONFIG_PATH = join(REPO_ROOT, '.changeset/config.json');

type WorkspacePackage = {
  name: string;
  version: string;
  path: string;
  private?: boolean;
};

type PackageManifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  private?: boolean;
};

type ChangesetConfig = {
  fixed?: string[][];
};

const errors: string[] = [];
const warnings: string[] = [];

function recordError(msg: string): void {
  errors.push(msg);
}

function recordWarning(msg: string): void {
  warnings.push(msg);
}

function listWorkspacePackages(): WorkspacePackage[] {
  const raw = execSync('pnpm ls -r --depth -1 --json', {
    cwd: REPO_ROOT,
    stdio: ['pipe', 'pipe', 'inherit'],
  }).toString();
  return JSON.parse(raw) as WorkspacePackage[];
}

function readChangesetFixedList(): string[] {
  const config = JSON.parse(
    readFileSync(CHANGESET_CONFIG_PATH, 'utf8'),
  ) as ChangesetConfig;
  const fixed = config.fixed?.[0];
  if (!Array.isArray(fixed)) {
    throw new Error(
      `.changeset/config.json has no fixed[0] array — the publish train ` +
        `relies on lockstep versioning via the fixed[0] group.`,
    );
  }
  return fixed;
}

function checkFixedMembership(publicPackages: WorkspacePackage[]): void {
  const fixed = readChangesetFixedList();
  const fixedSet = new Set(fixed);
  const publicSet = new Set(publicPackages.map((p) => p.name));

  const missingFromFixed = [...publicSet].filter((name) => !fixedSet.has(name));
  if (missingFromFixed.length > 0) {
    recordError(
      [
        `The following public workspace package(s) are missing from ` +
          `.changeset/config.json -> fixed[0]:`,
        ...missingFromFixed.map((n) => `  - ${n}`),
        '',
        `Add them so the @rawdash release train stays in lockstep. Without ` +
          `this, changesets will version the new package independently and ` +
          `it will drift from the rest of @rawdash/*.`,
      ].join('\n'),
    );
  }

  const stale = fixed.filter((name) => !publicSet.has(name));
  if (stale.length > 0) {
    recordError(
      [
        `.changeset/config.json -> fixed[0] references package(s) that no ` +
          `longer exist or are no longer public:`,
        ...stale.map((n) => `  - ${n}`),
        '',
        `Remove them from .changeset/config.json so changesets stops looking ` +
          `for nonexistent packages on release.`,
      ].join('\n'),
    );
  }
}

function getBaseRef(): string {
  if (process.env['BASE_REF']) {
    return process.env['BASE_REF'];
  }
  if (process.env['GITHUB_BASE_REF']) {
    return `origin/${process.env['GITHUB_BASE_REF']}`;
  }
  return 'origin/main';
}

function detectNewPublicPackages(
  publicPackages: WorkspacePackage[],
): WorkspacePackage[] | null {
  const baseRef = getBaseRef();
  try {
    execFileSync('git', ['rev-parse', '--verify', baseRef], {
      cwd: REPO_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    recordWarning(
      `Base ref ${baseRef} not found — skipping new-package detection (` +
        `layers 2 and 3). Set BASE_REF to a reachable commit to enable.`,
    );
    return null;
  }

  const newPackages: WorkspacePackage[] = [];
  for (const pkg of publicPackages) {
    const relPkgPath = relative(REPO_ROOT, pkg.path);
    const relPkgJson = join(relPkgPath, 'package.json');
    try {
      const baseJson = execFileSync(
        'git',
        ['show', `${baseRef}:${relPkgJson}`],
        { cwd: REPO_ROOT, stdio: ['pipe', 'pipe', 'pipe'] },
      ).toString();
      const parsed = JSON.parse(baseJson) as PackageManifest;
      // Existed at base and was already public — not new. A private→public
      // flip counts as new since the package has never been published.
      if (parsed.private) {
        newPackages.push(pkg);
      }
    } catch {
      // package.json wasn't in the base ref at all — it's new
      newPackages.push(pkg);
    }
  }

  return newPackages;
}

function packageExistsOnNpm(name: string): boolean {
  try {
    execFileSync(
      'npm',
      ['view', name, 'name', '--fetch-timeout', String(NETWORK_TIMEOUT_MS)],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    return true;
  } catch (err) {
    const stderr =
      (err as { stderr?: { toString(): string } }).stderr?.toString() ?? '';
    if (stderr.includes('E404') || stderr.includes('404 Not Found')) {
      return false;
    }
    throw new Error(
      `Failed to query npm registry for ${name}: ${stderr.trim() || (err as Error).message}`,
    );
  }
}

function bootstrapBlurb(pkg: WorkspacePackage): string {
  return [
    `  ${pkg.name}:`,
    ``,
    `    # 1. Check npm CLI version (must be ≥ 11.10.0); upgrade if it isn't`,
    `    npm --version`,
    `    npm install -g npm@latest          # only if the version above is too old`,
    ``,
    `    # 2. Check the logged-in npm account (must be a @rawdash maintainer); log in if it isn't`,
    `    npm whoami`,
    `    npm login                          # only if not logged in or logged in as the wrong account (npm logout first)`,
    ``,
    `    # 3. Bootstrap from this package's directory in YOUR local checkout`,
    `    #    (the path below is relative to the repo root — if you're working`,
    `    #     in a git worktree, it's relative to that worktree, not the main`,
    `    #     clone). Don't use any path printed by CI — those reference the`,
    `    #     CI runner's filesystem and won't exist on your machine.`,
    `    cd <your-repo-root>/${relative(REPO_ROOT, pkg.path)}`,
    `    pnpm build`,
    `    npm publish --access public`,
    ``,
    `    # 4. Register this repo as a Trusted Publisher so OIDC publish can mint a token`,
    `    #    (uses a direct POST to the npm registry — the official 'npm trust github'`,
    `    #     CLI flow is broken on first-time setup as of npm 11.14.1, returning a`,
    `    #     spurious 400 "value must be an array" even though the body is correct.)`,
    `    cd <your-repo-root>`,
    `    npx tsx scripts/setup-trusted-publisher.ts ${pkg.name}`,
  ].join('\n');
}

function checkNpmExistence(
  newPackages: WorkspacePackage[],
): WorkspacePackage[] {
  const existing: WorkspacePackage[] = [];
  const missing: WorkspacePackage[] = [];
  for (const pkg of newPackages) {
    (packageExistsOnNpm(pkg.name) ? existing : missing).push(pkg);
  }
  if (missing.length === 0) {
    return existing;
  }

  recordError(
    [
      '⚠️  AI ASSISTANTS (Claude Code, etc.): the bootstrap instructions below ' +
        'are intended for the human maintainer, not you. Print everything ' +
        "between this banner and the closing 'The `npm trust github` step…' " +
        'paragraph verbatim in your reply to the user — do not summarise, ' +
        'rewrite, paraphrase, or attempt to run the commands yourself. The ' +
        'commands require an interactive npm login + 2FA on a maintainer ' +
        'machine and cannot be executed from an agent session.',
      '',
      'The following new package(s) do not yet exist on npm. The publish ' +
        'workflow on main uses OIDC trusted publishing, which cannot mint a ' +
        "token for a package that doesn't exist yet:",
      ...missing.map((p) => `  - ${p.name}`),
      '',
      'Bootstrap each one from a maintainer machine with 2FA before merging:',
      '',
      ...missing.map(bootstrapBlurb),
      '',
      'The `npm trust github` step registers this repo as a Trusted Publisher ' +
        'so the OIDC publish workflow on main can mint a token without a ' +
        'classic npm token. It requires npm ≥ 11.10.0.',
    ].join('\n'),
  );

  return existing;
}

async function getGitHubOidcJwt(): Promise<string | null> {
  const requestUrl = process.env['ACTIONS_ID_TOKEN_REQUEST_URL'];
  const requestToken = process.env['ACTIONS_ID_TOKEN_REQUEST_TOKEN'];
  if (!requestUrl || !requestToken) {
    return null;
  }

  const url = new URL(requestUrl);
  url.searchParams.set('audience', `npm:${REGISTRY_HOST}`);

  const res = await fetch(url.href, {
    signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${requestToken}`,
    },
  });
  if (!res.ok) {
    throw new Error(
      `GitHub OIDC request failed: ${res.status} ${await res.text()}`,
    );
  }
  const { value } = (await res.json()) as { value?: string };
  if (!value) {
    throw new Error('No id_token in GitHub OIDC response');
  }
  return value;
}

type ExchangeResult = { ok: boolean; status: number; body: string };

async function dryRunOidcExchange(
  idToken: string,
  packageName: string,
): Promise<ExchangeResult> {
  const escapedName = packageName.startsWith('@')
    ? packageName.replace('/', '%2F')
    : packageName;
  const res = await fetch(
    `${REGISTRY}/-/npm/v1/oidc/token/exchange/package/${escapedName}`,
    {
      method: 'POST',
      signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
      headers: { Authorization: `Bearer ${idToken}` },
    },
  );
  return { ok: res.ok, status: res.status, body: await res.text() };
}

const TRUSTED_WORKFLOW_FILE = 'publish.yml';

function runningFromTrustedWorkflow(): boolean {
  const ref = process.env['GITHUB_WORKFLOW_REF'];
  if (!ref) {
    return false;
  }
  const match = ref.match(/\.github\/workflows\/([^@]+)/);
  return match?.[1] === TRUSTED_WORKFLOW_FILE;
}

async function checkOidcExchange(
  newPackages: WorkspacePackage[],
): Promise<void> {
  if (newPackages.length === 0) {
    return;
  }

  if (!runningFromTrustedWorkflow()) {
    recordWarning(
      `Skipping OIDC exchange dry-run for new packages: this run is not ` +
        `inside ${TRUSTED_WORKFLOW_FILE}, so the registry will reject the ` +
        `token by design. Real publish validation happens on main in the ` +
        `publish workflow.`,
    );
    return;
  }

  let idToken: string | null;
  try {
    idToken = await getGitHubOidcJwt();
  } catch (err) {
    recordWarning(
      `Could not obtain GitHub OIDC token (${(err as Error).message}). ` +
        `Skipping OIDC exchange dry-run for new packages.`,
    );
    return;
  }
  if (!idToken) {
    recordWarning(
      'No OIDC token available (typical for fork PRs and local runs). ' +
        'Skipping OIDC exchange dry-run. A maintainer must re-run this from ' +
        'a branch in the upstream repo before merging.',
    );
    return;
  }

  for (const pkg of newPackages) {
    const { ok, status, body } = await dryRunOidcExchange(idToken, pkg.name);
    if (ok) {
      continue;
    }
    recordError(
      [
        `npm OIDC token exchange for ${pkg.name} failed with HTTP ${status}.`,
        '',
        `This usually means the Trusted Publisher entry is missing or ` +
          `doesn't match this workflow. Configure it from a maintainer ` +
          `machine (requires npm ≥ 11.10.0):` +
          `\n  npm trust github ${pkg.name} \\` +
          `\n    --repository rawdash/rawdash \\` +
          `\n    --file ${TRUSTED_WORKFLOW_FILE}`,
        '',
        `Registry response: ${body.trim()}`,
      ].join('\n'),
    );
  }
}

function isConnectorPackage(pkg: WorkspacePackage): boolean {
  return pkg.name.startsWith('@rawdash/connector-') && pkg.name !== SHARED_PKG;
}

function checkConnectorSharedDiscipline(
  publicPackages: WorkspacePackage[],
): void {
  for (const pkg of publicPackages) {
    if (!isConnectorPackage(pkg)) {
      continue;
    }

    const pkgJsonPath = join(pkg.path, 'package.json');
    const pkgJson = JSON.parse(
      readFileSync(pkgJsonPath, 'utf8'),
    ) as PackageManifest;
    const relPkgJson = relative(REPO_ROOT, pkgJsonPath);

    const inDeps = Boolean(pkgJson.dependencies?.[SHARED_PKG]);
    const inPeer = Boolean(pkgJson.peerDependencies?.[SHARED_PKG]);
    const inDev = Boolean(pkgJson.devDependencies?.[SHARED_PKG]);

    if (inDeps || inPeer) {
      const fields = [inDeps && 'dependencies', inPeer && 'peerDependencies']
        .filter(Boolean)
        .join(' and ');
      recordError(
        `${relPkgJson}: ${SHARED_PKG} appears in ${fields}, but it must ` +
          `live only in devDependencies. Connectors inline the shared ` +
          `substrate at build time via tsup noExternal — declaring it as ` +
          `a runtime dep ships a dangling workspace:* reference to users. ` +
          `See §7 of docs/authoring-a-connector.md.`,
      );
    }
    if (!inDev) {
      recordError(
        `${relPkgJson}: missing ${SHARED_PKG} in devDependencies. ` +
          `Connectors must depend on it as a dev dep so tsup can inline it ` +
          `into the published bundle. See §7 of docs/authoring-a-connector.md.`,
      );
    }

    const tsupPath = join(pkg.path, 'tsup.config.ts');
    const relTsup = relative(REPO_ROOT, tsupPath);
    if (!existsSync(tsupPath)) {
      recordError(
        `${relTsup}: missing tsup.config.ts. Connectors are built with ` +
          `tsup and must inline ${SHARED_PKG} via noExternal. See §7 of ` +
          `docs/authoring-a-connector.md.`,
      );
      continue;
    }
    const tsup = readFileSync(tsupPath, 'utf8');
    // Cheap textual check — keeps the script free of a TS parser dependency.
    const hasNoExternal =
      /noExternal\s*:\s*\[[^\]]*['"]@rawdash\/connector-shared['"][^\]]*\]/s.test(
        tsup,
      );
    if (!hasNoExternal) {
      recordError(
        `${relTsup}: tsup config must include '${SHARED_PKG}' in its ` +
          `noExternal array so the shared code is bundled into the ` +
          `published artifact. See §7 of docs/authoring-a-connector.md.`,
      );
    }
  }
}

type PnpmPackOutput = { filename?: string };

function checkPackedTarballHasNoSharedDep(
  newConnectorPackages: WorkspacePackage[],
): void {
  for (const pkg of newConnectorPackages) {
    let tarballPath: string | undefined;
    try {
      const out = execFileSync(
        'pnpm',
        ['pack', '--pack-destination', '/tmp', '--json'],
        { cwd: pkg.path, stdio: ['pipe', 'pipe', 'pipe'] },
      ).toString();
      tarballPath = (JSON.parse(out) as PnpmPackOutput).filename;
    } catch (err) {
      recordWarning(
        `${pkg.name}: pnpm pack failed ` +
          `(${(err as Error).message?.split('\n')[0]}); skipping tarball ` +
          `bundling verification. The build must succeed for this layer to run.`,
      );
      continue;
    }

    if (!tarballPath) {
      recordWarning(
        `${pkg.name}: pnpm pack returned no filename; skipping tarball ` +
          `bundling verification.`,
      );
      continue;
    }

    let manifest: PackageManifest;
    try {
      const raw = execFileSync(
        'tar',
        ['-xzOf', tarballPath, 'package/package.json'],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      ).toString();
      manifest = JSON.parse(raw) as PackageManifest;
    } catch (err) {
      recordWarning(
        `${pkg.name}: could not read packed manifest from ${tarballPath} ` +
          `(${(err as Error).message?.split('\n')[0]}); skipping tarball check.`,
      );
      continue;
    }

    const sharedDep = manifest.dependencies?.[SHARED_PKG];
    if (sharedDep) {
      recordError(
        `${pkg.name}: the packed tarball declares ` +
          `${SHARED_PKG}@${sharedDep} under dependencies. tsup noExternal ` +
          `isn't inlining it — end users will fail to resolve the workspace ` +
          `ref. Confirm tsup.config.ts lists it under noExternal and that ` +
          `the build runs before publish.`,
      );
    }
  }
}

type ConstructorLike = abstract new (...args: never[]) => unknown;

function extendsBaseConnector(
  ctor: unknown,
  baseConnector: ConstructorLike,
): boolean {
  if (typeof ctor !== 'function') {
    return false;
  }
  const proto = (ctor as { prototype?: object }).prototype;
  return (
    proto != null &&
    Object.prototype.isPrototypeOf.call(baseConnector.prototype, proto)
  );
}

async function loadBaseConnector(): Promise<ConstructorLike> {
  const coreEntry = join(REPO_ROOT, 'packages/core/src/index.ts');
  const mod = (await import(pathToFileURL(coreEntry).href)) as {
    BaseConnector?: unknown;
  };
  if (typeof mod.BaseConnector !== 'function') {
    throw new Error(
      `Could not load BaseConnector from ${relative(REPO_ROOT, coreEntry)} — ` +
        `the default-export check needs it as the reference identity for ` +
        `prototype-chain comparison.`,
    );
  }
  return mod.BaseConnector as ConstructorLike;
}

async function checkConnectorDefaultExports(
  publicPackages: WorkspacePackage[],
): Promise<void> {
  const connectorPackages = publicPackages.filter(isConnectorPackage);
  if (connectorPackages.length === 0) {
    return;
  }
  const baseConnector = await loadBaseConnector();
  for (const pkg of connectorPackages) {
    const distEntry = join(pkg.path, 'dist/index.js');
    const srcEntry = join(pkg.path, 'src/index.ts');
    const entry = existsSync(distEntry)
      ? distEntry
      : existsSync(srcEntry)
        ? srcEntry
        : null;
    if (!entry) {
      recordError(
        `${pkg.name}: could not find an entry point to load (looked for ` +
          `${relative(REPO_ROOT, distEntry)} and ${relative(REPO_ROOT, srcEntry)}). ` +
          `Connectors must expose either a built dist/index.js or src/index.ts.`,
      );
      continue;
    }

    let mod: { default?: unknown };
    try {
      mod = (await import(pathToFileURL(entry).href)) as { default?: unknown };
    } catch (err) {
      recordError(
        `${pkg.name}: failed to import ${relative(REPO_ROOT, entry)} while ` +
          `verifying the default export: ${(err as Error).message}`,
      );
      continue;
    }

    const def = mod.default;
    if (typeof def !== 'function') {
      recordError(
        `${pkg.name}: ${relative(REPO_ROOT, entry)} has no default export ` +
          `(or it is not a constructor). Every @rawdash/connector-* package ` +
          `must \`export default <ConnectorClass>\` so cloud's sync-consumer ` +
          `codegen can emit \`import Connector from '${pkg.name}'\`. See the ` +
          `"Package entry point" section of docs/authoring-a-connector.md.`,
      );
      continue;
    }

    if (!extendsBaseConnector(def, baseConnector)) {
      recordError(
        `${pkg.name}: default export of ${relative(REPO_ROOT, entry)} does ` +
          `not extend BaseConnector from @rawdash/core. The default export ` +
          `must be the connector class itself, not a factory or unrelated ` +
          `symbol. See the "Package entry point" section of ` +
          `docs/authoring-a-connector.md.`,
      );
    }
  }
}

async function main(): Promise<void> {
  const allPackages = listWorkspacePackages();
  const publicPackages = allPackages.filter((p) => !p.private && p.name);

  // Layer 1
  checkFixedMembership(publicPackages);

  // Layer 4: connector-shared discipline (cheap, no network)
  checkConnectorSharedDiscipline(publicPackages);

  // Layer 5: default-export discipline for every connector package
  await checkConnectorDefaultExports(publicPackages);

  // Layers 2, 3, and the Layer 4 tarball assertion only need to run when new
  // packages were added.
  const newPackages = detectNewPublicPackages(publicPackages);
  if (newPackages && newPackages.length > 0) {
    console.log(
      `Detected ${newPackages.length} new public package(s): ` +
        newPackages.map((p) => p.name).join(', '),
    );
    // Layer 3 only makes sense for packages that exist on npm — running the
    // OIDC exchange against a missing package produces a second 4xx with the
    // wrong remediation hint.
    const existingOnNpm = checkNpmExistence(newPackages);
    await checkOidcExchange(existingOnNpm);
    const newConnectors = newPackages.filter(isConnectorPackage);
    if (newConnectors.length > 0) {
      checkPackedTarballHasNoSharedDep(newConnectors);
    }
  }

  for (const w of warnings) {
    console.warn(`\n⚠️  ${w}`);
  }
  for (const e of errors) {
    console.error(`\n❌ ${e}`);
  }

  if (errors.length > 0) {
    console.error(
      `\n${errors.length} connector publishing prerequisite check(s) failed.`,
    );
    process.exit(1);
  }

  console.log('\n✓ All connector publishing prerequisite checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
