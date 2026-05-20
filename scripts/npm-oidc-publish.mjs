#!/usr/bin/env node

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
import { execFile, execSync } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const REGISTRY = 'https://registry.npmjs.org';
const REGISTRY_HOST = new URL(REGISTRY).hostname;
const NETWORK_TIMEOUT_MS = 30_000;
const PUBLISH_CONCURRENCY = 8;

async function pMap(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.min(limit, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) {
        return;
      }
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

async function getGitHubOidcJwt() {
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

  const { value } = await res.json();
  if (!value) {
    throw new Error('No id_token in GitHub OIDC response');
  }
  return value;
}

async function exchangeForNpmToken(idToken, packageName) {
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

  const { token } = await res.json();
  if (!token) {
    throw new Error(
      `No token in npm OIDC exchange response for ${packageName}`,
    );
  }
  return token;
}

function encodePackageName(name) {
  return name.startsWith('@')
    ? `@${encodeURIComponent(name.slice(1))}`
    : encodeURIComponent(name);
}

async function isAlreadyPublished(name, version) {
  const res = await fetch(
    `${REGISTRY}/${encodePackageName(name)}/${encodeURIComponent(version)}`,
    { signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS) },
  );
  if (res.status === 404) {
    return false;
  }
  if (!res.ok) {
    throw new Error(
      `Registry query failed for ${name}@${version}: ${res.status}`,
    );
  }
  return true;
}

async function packageExistsOnNpm(name) {
  const res = await fetch(`${REGISTRY}/${encodePackageName(name)}`, {
    signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
  });
  if (res.status === 404) {
    return false;
  }
  if (!res.ok) {
    throw new Error(`Registry query failed for ${name}: ${res.status}`);
  }
  return true;
}

function printNewPackageError(newPackages) {
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

function tagExists(name, version) {
  const tag = `${name}@${version}`;
  return (
    execSync(`git tag -l "${tag}"`, { stdio: ['pipe', 'pipe', 'pipe'] })
      .toString()
      .trim() === tag
  );
}

function ensureTag(name, version) {
  if (!tagExists(name, version)) {
    execSync(`git tag "${name}@${version}"`);
  }
}

async function publishPackage(pkg) {
  const { name, version, path: pkgPath } = pkg;
  const idToken = await getGitHubOidcJwt();
  const npmToken = await exchangeForNpmToken(idToken, name);

  const { stdout, stderr } = await execFileAsync(
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
      env: { ...process.env, NODE_AUTH_TOKEN: npmToken },
      maxBuffer: 32 * 1024 * 1024,
    },
  );

  ensureTag(name, version);
  return { stdout, stderr };
}

const packages = JSON.parse(
  execSync('pnpm ls -r --depth -1 --json', {
    stdio: ['pipe', 'pipe', 'pipe'],
  }).toString(),
);

const publicPackages = packages.filter((pkg) => !pkg.private);

const publishedFlags = await pMap(publicPackages, PUBLISH_CONCURRENCY, (pkg) =>
  isAlreadyPublished(pkg.name, pkg.version),
);
const alreadyPublished = publicPackages.filter((_, i) => publishedFlags[i]);
const toPublish = publicPackages.filter((_, i) => !publishedFlags[i]);

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

const existsFlags = await pMap(toPublish, PUBLISH_CONCURRENCY, (pkg) =>
  packageExistsOnNpm(pkg.name),
);
const newPackages = toPublish.filter((_, i) => !existsFlags[i]);
if (newPackages.length > 0) {
  printNewPackageError(newPackages);
  process.exit(1);
}

console.log(
  `Packages to publish (concurrency=${PUBLISH_CONCURRENCY}): ${toPublish
    .map((p) => `${p.name}@${p.version}`)
    .join(', ')}`,
);

const outcomes = await pMap(toPublish, PUBLISH_CONCURRENCY, async (pkg) => {
  const label = `${pkg.name}@${pkg.version}`;
  console.log(`→ Publishing ${label}...`);
  try {
    const { stdout, stderr } = await publishPackage(pkg);
    const block = [
      `─── ${label} ───`,
      stdout.trim(),
      stderr.trim(),
      // Marker that changesets/action greps for to drive `createGithubReleases`.
      // Format must match: /New tag:\s+(@[^/]+\/[^@]+|[^/]+)@([^\s]+)/
      `New tag: ${label}`,
      `✓ Published ${label}`,
      '',
    ]
      .filter(Boolean)
      .join('\n');
    console.log(block);
    return { ok: true, pkg };
  } catch (err) {
    const stdout = err.stdout?.toString().trim() ?? '';
    const stderr = err.stderr?.toString().trim() ?? err.message;
    const block = [
      `─── ${label} (FAILED) ───`,
      stdout,
      stderr,
      `✗ Failed to publish ${label}`,
      '',
    ]
      .filter(Boolean)
      .join('\n');
    console.error(block);
    return { ok: false, pkg, error: err };
  }
});

const failures = outcomes.filter((o) => !o.ok);
if (failures.length > 0) {
  console.error(
    `\n${failures.length}/${toPublish.length} package(s) failed to publish:`,
  );
  for (const f of failures) {
    console.error(`  - ${f.pkg.name}@${f.pkg.version}`);
  }
  process.exit(1);
}

console.log(`\nAll ${toPublish.length} package(s) published successfully.`);
