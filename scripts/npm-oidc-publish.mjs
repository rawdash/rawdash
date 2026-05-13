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
 *   3. Pass that token as NODE_AUTH_TOKEN to `npm publish --provenance`
 */
import { execFileSync, execSync } from 'node:child_process';

const REGISTRY = 'https://registry.npmjs.org';
const REGISTRY_HOST = new URL(REGISTRY).hostname;

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
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN}`,
    },
  });
  if (!res.ok)
    {throw new Error(
      `GitHub OIDC request failed: ${res.status} ${await res.text()}`,
    );}

  const { value } = await res.json();
  if (!value) {throw new Error('No id_token in GitHub OIDC response');}
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
      headers: { Authorization: `Bearer ${idToken}` },
    },
  );
  if (!res.ok)
    {throw new Error(
      `npm OIDC exchange failed for ${packageName}: ${res.status} ${await res.text()}`,
    );}

  const { token } = await res.json();
  if (!token)
    {throw new Error(
      `No token in npm OIDC exchange response for ${packageName}`,
    );}
  return token;
}

function isAlreadyPublished(name, version) {
  try {
    const result = execSync(
      `npm view ${name}@${version} version --json 2>/dev/null`,
      {
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
      .toString()
      .trim();
    return JSON.parse(result) === version;
  } catch {
    return false;
  }
}

const packages = JSON.parse(
  execSync('pnpm ls -r --depth -1 --json', {
    stdio: ['pipe', 'pipe', 'pipe'],
  }).toString(),
);

const toPublish = packages.filter(
  (pkg) => !pkg.private && !isAlreadyPublished(pkg.name, pkg.version),
);

if (toPublish.length === 0) {
  console.log('No packages to publish.');
  process.exit(0);
}

console.log(
  `Packages to publish: ${toPublish.map((p) => `${p.name}@${p.version}`).join(', ')}`,
);

const idToken = await getGitHubOidcJwt();

for (const pkg of toPublish) {
  const { name, version, path: pkgPath } = pkg;
  console.log(`\nPublishing ${name}@${version}...`);

  const npmToken = await exchangeForNpmToken(idToken, name);

  execFileSync('npm', ['publish', '--provenance', '--access', 'public'], {
    cwd: pkgPath,
    stdio: 'inherit',
    env: { ...process.env, NODE_AUTH_TOKEN: npmToken },
  });

  // Create a lightweight git tag — changesets/action reads these to create GitHub releases
  execSync(`git tag "${name}@${version}"`);
  console.log(`✓ Published ${name}@${version}`);
}
