#!/usr/bin/env npx tsx

/**
 * Publishes all non-private workspace packages that aren't yet on npm,
 * using npm OIDC trusted publishing instead of a stored NPM_TOKEN.
 *
 * pnpm doesn't implement the npm OIDC token exchange natively (pnpm/pnpm#9812),
 * so this script handles the exchange manually and then delegates to npm publish.
 *
 * Token exchange flow (per package):
 *   1. Fetch a GitHub OIDC JWT from the Actions token endpoint
 *   2. POST it to the npm registry exchange endpoint to get a short-lived publish token
 *   3. Pass that token as NODE_AUTH_TOKEN to `pnpm publish --provenance`
 *      (pnpm rewrites workspace:* deps during pack, then delegates to npm publish)
 */
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REGISTRY = 'https://registry.npmjs.org';
const REGISTRY_HOST = new URL(REGISTRY).hostname;
const NETWORK_TIMEOUT_MS = 30_000;

type WorkspacePackage = {
  name: string;
  version: string;
  path: string;
  private?: boolean;
};

type PackageManifest = {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

async function getGitHubOidcJwt(): Promise<string> {
  const { ACTIONS_ID_TOKEN_REQUEST_URL, ACTIONS_ID_TOKEN_REQUEST_TOKEN } =
    process.env;
  if (!ACTIONS_ID_TOKEN_REQUEST_URL || !ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
    throw new Error(
      'OIDC env vars not available — ensure id-token: write permission is set',
    );
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

  const { value } = (await res.json()) as { value?: string };
  if (!value) {
    throw new Error('No id_token in GitHub OIDC response');
  }
  return value;
}

async function exchangeForNpmToken(
  idToken: string,
  packageName: string,
): Promise<string> {
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
  if (!res.ok) {
    throw new Error(
      `npm OIDC exchange failed for ${packageName}: ${res.status} ${await res.text()}`,
    );
  }

  const { token } = (await res.json()) as { token?: string };
  if (!token) {
    throw new Error(
      `No token in npm OIDC exchange response for ${packageName}`,
    );
  }
  return token;
}

function isAlreadyPublished(name: string, version: string): boolean {
  try {
    const result = execSync(
      `npm view ${name}@${version} version --json 2>/dev/null`,
      { stdio: ['pipe', 'pipe', 'pipe'] },
    )
      .toString()
      .trim();
    return JSON.parse(result) === version;
  } catch {
    return false;
  }
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
    const e = err as { stderr?: Buffer | string; message?: string };
    const stderr = e.stderr?.toString() ?? '';
    if (stderr.includes('E404') || stderr.includes('404 Not Found')) {
      return false;
    }
    throw new Error(
      `Failed to query npm registry for ${name}: ${stderr.trim() || e.message}`,
    );
  }
}

function printNewPackageError(newPackages: WorkspacePackage[]): void {
  const bulletList = newPackages.map((p) => `  - ${p.name}`).join('\n');

  const publishCommands = newPackages
    .map(
      (p) =>
        `       cd ${p.path}\n` +
        `       pnpm build\n` +
        `       npm publish --access public`,
    )
    .join('\n\n');

  const trustCommands = newPackages
    .map(
      (p) =>
        `       npm trust github ${p.name} \\\n` +
        `         --repository rawdash/rawdash \\\n` +
        `         --file .github/workflows/publish.yml`,
    )
    .join('\n\n');

  const lines = [
    '',
    'The following package(s) do not yet exist on npm and cannot be bootstrapped via OIDC trusted publishing:',
    bulletList,
    '',
    'npm requires the package to already exist before it will mint a token or accept a trusted publisher entry. To bootstrap a new package (one-off, ~2 minutes):',
    '',
    '  1. Publish the first version manually from a maintainer machine (must have publish rights to @rawdash and a 2FA-enabled npm account):',
    publishCommands,
    '',
    '  2. Configure the Trusted Publisher entry. With npm CLI >= 11.10.0:',
    trustCommands,
    '',
    '     On older npm, do the same via the npmjs.com UI: package Settings -> Trusted Publishers -> GitHub Actions, with repo=rawdash/rawdash and workflow=.github/workflows/publish.yml.',
    '',
    '  3. Re-run this workflow. Subsequent versions will publish via OIDC with provenance automatically.',
    '',
    'See docs/authoring-a-connector.md §9 for the full walk-through.',
    '',
  ];

  console.error(lines.join('\n'));
}

function tagExists(name: string, version: string): boolean {
  const tag = `${name}@${version}`;
  return (
    execSync(`git tag -l "${tag}"`, { stdio: ['pipe', 'pipe', 'pipe'] })
      .toString()
      .trim() === tag
  );
}

function ensureTag(name: string, version: string): void {
  if (!tagExists(name, version)) {
    execSync(`git tag "${name}@${version}"`);
  }
}

/**
 * Topologically sort packages so dependencies are published before dependents.
 * Uses Kahn's algorithm. Throws on cycles.
 */
function topoSort(pkgs: WorkspacePackage[]): WorkspacePackage[] {
  const byName = new Map<string, WorkspacePackage>(
    pkgs.map((p) => [p.name, p]),
  );
  const inDegree = new Map<string, number>(pkgs.map((p) => [p.name, 0]));
  const edges = new Map<string, string[]>(pkgs.map((p) => [p.name, []]));

  for (const pkg of pkgs) {
    const pkgJson = JSON.parse(
      readFileSync(join(pkg.path, 'package.json'), 'utf8'),
    ) as PackageManifest;
    const allDeps = Object.keys({
      ...pkgJson.dependencies,
      ...pkgJson.peerDependencies,
    });
    for (const dep of allDeps) {
      if (byName.has(dep)) {
        edges.get(dep)!.push(pkg.name);
        inDegree.set(pkg.name, inDegree.get(pkg.name)! + 1);
      }
    }
  }

  const queue = pkgs.filter((p) => inDegree.get(p.name) === 0);
  const sorted: WorkspacePackage[] = [];

  while (queue.length > 0) {
    const pkg = queue.shift()!;
    sorted.push(pkg);
    for (const dependent of edges.get(pkg.name)!) {
      const newDegree = inDegree.get(dependent)! - 1;
      inDegree.set(dependent, newDegree);
      if (newDegree === 0) {
        queue.push(byName.get(dependent)!);
      }
    }
  }

  if (sorted.length !== pkgs.length) {
    throw new Error('Cycle detected in workspace package dependencies');
  }

  return sorted;
}

const packages = JSON.parse(
  execSync('pnpm ls -r --depth -1 --json', {
    stdio: ['pipe', 'pipe', 'pipe'],
  }).toString(),
) as WorkspacePackage[];

const publicPackages = packages.filter((pkg) => !pkg.private);
const alreadyPublished = publicPackages.filter((pkg) =>
  isAlreadyPublished(pkg.name, pkg.version),
);
const toPublish = publicPackages.filter(
  (pkg) => !alreadyPublished.includes(pkg),
);

// Backfill tags for packages that were published in a previous (partial) run
// so that changesets/action can still create their GitHub releases.
for (const pkg of alreadyPublished) {
  if (!tagExists(pkg.name, pkg.version)) {
    console.log(
      `Backfilling missing tag for already-published ${pkg.name}@${pkg.version}`,
    );
    ensureTag(pkg.name, pkg.version);
  }
}

if (toPublish.length === 0) {
  console.log('No packages to publish.');
  process.exit(0);
}

const newPackages = toPublish.filter((pkg) => !packageExistsOnNpm(pkg.name));
if (newPackages.length > 0) {
  printNewPackageError(newPackages);
  process.exit(1);
}

const sorted = topoSort(toPublish);

console.log(
  `Packages to publish: ${sorted.map((p) => `${p.name}@${p.version}`).join(', ')}`,
);

async function publishAll(): Promise<void> {
  for (const pkg of sorted) {
    const { name, version, path: pkgPath } = pkg;
    console.log(`\nPublishing ${name}@${version}...`);

    const idToken = await getGitHubOidcJwt();
    const npmToken = await exchangeForNpmToken(idToken, name);

    execFileSync(
      'pnpm',
      [
        'publish',
        '--access',
        'public',
        '--no-git-checks',
        '--provenance',
        '--registry',
        REGISTRY,
      ],
      {
        cwd: pkgPath,
        stdio: 'inherit',
        env: { ...process.env, NODE_AUTH_TOKEN: npmToken },
      },
    );

    // Create a lightweight git tag — changesets/action reads these to create GitHub releases
    ensureTag(name, version);
    // Emit the marker that changesets/action greps for to drive `createGithubReleases`.
    // Format must match: /New tag:\s+(@[^/]+\/[^@]+|[^/]+)@([^\s]+)/
    console.log(`New tag: ${name}@${version}`);
    console.log(`✓ Published ${name}@${version}`);
  }
}

publishAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
