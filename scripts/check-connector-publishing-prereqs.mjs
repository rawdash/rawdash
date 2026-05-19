#!/usr/bin/env node

/**
 * Verifies that any new public workspace package added in this PR is set up
 * correctly for the OIDC publish workflow on main. Runs three layers:
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
 *      misconfigured. Skipped (with a warning) when no OIDC token is available
 *      (fork PRs, local runs).
 *
 * Also enforces two cheap connector authoring conventions: every
 * `@rawdash/connector-*` package must declare `@rawdash/connector-shared` only
 * in `devDependencies`, and must include it in `noExternal` in its
 * `tsup.config.ts` so the shared code is bundled into the published artifact.
 */
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REGISTRY = 'https://registry.npmjs.org';
const REGISTRY_HOST = new URL(REGISTRY).hostname;
const NETWORK_TIMEOUT_MS = 30_000;

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const CHANGESET_CONFIG_PATH = join(REPO_ROOT, '.changeset/config.json');

const errors = [];
const warnings = [];

function recordError(msg) {
  errors.push(msg);
}

function recordWarning(msg) {
  warnings.push(msg);
}

function listWorkspacePackages() {
  const raw = execSync('pnpm ls -r --depth -1 --json', {
    cwd: REPO_ROOT,
    stdio: ['pipe', 'pipe', 'inherit'],
  }).toString();
  return JSON.parse(raw);
}

function readChangesetFixedList() {
  const config = JSON.parse(readFileSync(CHANGESET_CONFIG_PATH, 'utf8'));
  const fixed = config.fixed?.[0];
  if (!Array.isArray(fixed)) {
    throw new Error(
      `.changeset/config.json has no fixed[0] array — the publish train ` +
        `relies on lockstep versioning via the fixed[0] group.`,
    );
  }
  return fixed;
}

function checkFixedMembership(publicPackages) {
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

function getBaseRef() {
  if (process.env.BASE_REF) {return process.env.BASE_REF;}
  if (process.env.GITHUB_BASE_REF)
    {return `origin/${process.env.GITHUB_BASE_REF}`;}
  return 'origin/main';
}

function detectNewPublicPackages(publicPackages) {
  const baseRef = getBaseRef();
  try {
    execSync(`git rev-parse --verify ${baseRef}`, {
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

  const newPackages = [];
  for (const pkg of publicPackages) {
    const relPkgPath = relative(REPO_ROOT, pkg.path);
    const relPkgJson = join(relPkgPath, 'package.json');
    try {
      execSync(`git cat-file -e ${baseRef}:${relPkgJson}`, {
        cwd: REPO_ROOT,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      // existed at base — not new
      continue;
    } catch {
      // doesn't exist at base ref
    }

    // Also consider it new if the package was private at base.
    let wasPrivateAtBase = false;
    try {
      const baseJson = execSync(`git show ${baseRef}:${relPkgJson}`, {
        cwd: REPO_ROOT,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).toString();
      const parsed = JSON.parse(baseJson);
      wasPrivateAtBase = Boolean(parsed.private);
    } catch {
      // package.json wasn't in the base ref at all — it's new
      newPackages.push(pkg);
      continue;
    }

    if (wasPrivateAtBase) {
      newPackages.push(pkg);
    }
  }

  return newPackages;
}

function packageExistsOnNpm(name) {
  try {
    execFileSync(
      'npm',
      ['view', name, 'name', '--fetch-timeout', String(NETWORK_TIMEOUT_MS)],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    return true;
  } catch (err) {
    const stderr = err.stderr?.toString() ?? '';
    if (stderr.includes('E404') || stderr.includes('404 Not Found')) {
      return false;
    }
    throw new Error(
      `Failed to query npm registry for ${name}: ${stderr.trim() || err.message}`,
    );
  }
}

function bootstrapBlurb(pkg) {
  const relPath = relative(REPO_ROOT, pkg.path);
  return [
    `  ${pkg.name}:`,
    `    cd ${relPath}`,
    `    pnpm build`,
    `    npm publish --access public`,
  ].join('\n');
}

function checkNpmExistence(newPackages) {
  const missing = [];
  for (const pkg of newPackages) {
    if (!packageExistsOnNpm(pkg.name)) {
      missing.push(pkg);
    }
  }
  if (missing.length === 0) {return;}

  recordError(
    [
      'The following new package(s) do not yet exist on npm. The publish ' +
        'workflow on main uses OIDC trusted publishing, which cannot mint a ' +
        "token for a package that doesn't exist yet:",
      ...missing.map((p) => `  - ${p.name}`),
      '',
      'Bootstrap each one from a maintainer machine with 2FA before merging:',
      '',
      ...missing.map(bootstrapBlurb),
      '',
      "Then on npmjs.com, open each new package's Settings → Trusted " +
        'Publishers and add a GitHub Actions entry matching the existing ' +
        '@rawdash packages (same repo, workflow file, and environment).',
    ].join('\n'),
  );
}

async function getGitHubOidcJwt() {
  const { ACTIONS_ID_TOKEN_REQUEST_URL, ACTIONS_ID_TOKEN_REQUEST_TOKEN } =
    process.env;
  if (!ACTIONS_ID_TOKEN_REQUEST_URL || !ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
    return null;
  }

  const url = new URL(ACTIONS_ID_TOKEN_REQUEST_URL);
  url.searchParams.set('audience', `npm:${REGISTRY_HOST}`);

  const res = await fetch(url.href, {
    signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN}`,
    },
  });
  if (!res.ok) {
    throw new Error(
      `GitHub OIDC request failed: ${res.status} ${await res.text()}`,
    );
  }
  const { value } = await res.json();
  if (!value) {throw new Error('No id_token in GitHub OIDC response');}
  return value;
}

async function dryRunOidcExchange(idToken, packageName) {
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

async function checkOidcExchange(newPackages) {
  if (newPackages.length === 0) {return;}

  let idToken;
  try {
    idToken = await getGitHubOidcJwt();
  } catch (err) {
    recordWarning(
      `Could not obtain GitHub OIDC token (${err.message}). Skipping OIDC ` +
        `exchange dry-run for new packages.`,
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
    if (ok) {continue;}
    recordError(
      [
        `npm OIDC token exchange for ${pkg.name} failed with HTTP ${status}.`,
        '',
        `This usually means the Trusted Publisher entry on npmjs.com is ` +
          `missing or doesn't match this workflow. On npmjs.com, open ` +
          `${pkg.name} → Settings → Trusted Publishers and add a GitHub ` +
          `Actions entry matching the existing @rawdash packages (same ` +
          `repository, workflow file, and environment).`,
        '',
        `Registry response: ${body.trim()}`,
      ].join('\n'),
    );
  }
}

function checkConnectorConventions(publicPackages) {
  for (const pkg of publicPackages) {
    if (!pkg.name.startsWith('@rawdash/connector-')) {continue;}
    if (pkg.name === '@rawdash/connector-shared') {continue;}

    const pkgJsonPath = join(pkg.path, 'package.json');
    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
    const relPkgJson = relative(REPO_ROOT, pkgJsonPath);

    const inDeps = Boolean(pkgJson.dependencies?.['@rawdash/connector-shared']);
    const inDev = Boolean(
      pkgJson.devDependencies?.['@rawdash/connector-shared'],
    );

    if (inDeps) {
      recordError(
        `${relPkgJson}: @rawdash/connector-shared must be a devDependency ` +
          `(not a dependency) so it is bundled into the connector by tsup ` +
          `via noExternal rather than published as a runtime dep.`,
      );
    }
    if (!inDev) {
      recordError(
        `${relPkgJson}: missing @rawdash/connector-shared in ` +
          `devDependencies. Connectors must depend on it as a dev dep so ` +
          `tsup can inline it into the published bundle.`,
      );
    }

    const tsupPath = join(pkg.path, 'tsup.config.ts');
    if (!existsSync(tsupPath)) {
      recordError(
        `${relative(REPO_ROOT, tsupPath)}: missing tsup.config.ts. ` +
          `Connectors are built with tsup and must inline ` +
          `@rawdash/connector-shared via noExternal.`,
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
        `${relative(REPO_ROOT, tsupPath)}: tsup config must include ` +
          `'@rawdash/connector-shared' in its noExternal array so the ` +
          `shared code is bundled into the published artifact.`,
      );
    }
  }
}

async function main() {
  const allPackages = listWorkspacePackages();
  const publicPackages = allPackages.filter((p) => !p.private && p.name);

  // Layer 1
  checkFixedMembership(publicPackages);

  // Connector conventions (cheap, no network)
  checkConnectorConventions(publicPackages);

  // Layers 2 & 3 only need to run when new packages were added
  const newPackages = detectNewPublicPackages(publicPackages);
  if (newPackages && newPackages.length > 0) {
    console.log(
      `Detected ${newPackages.length} new public package(s): ` +
        newPackages.map((p) => p.name).join(', '),
    );
    checkNpmExistence(newPackages);
    await checkOidcExchange(newPackages);
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

await main();
