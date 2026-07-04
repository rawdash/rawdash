#!/usr/bin/env -S npx tsx
import { execFile, execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const REGISTRY = 'https://registry.npmjs.org';
const NETWORK_TIMEOUT_MS = 30_000;
const CHECK_CONCURRENCY = 8;
const PUSH_ATTEMPTS = 5;
const PUSH_BACKOFF_MS = 2_000;

type WorkspacePackage = {
  name: string;
  version: string;
  path: string;
  private?: boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pMap<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.min(limit, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) {
        return;
      }
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}

function getPublicPackages(): WorkspacePackage[] {
  const packages = JSON.parse(
    execSync('pnpm ls -r --depth -1 --json', {
      stdio: ['pipe', 'pipe', 'pipe'],
    }).toString(),
  ) as WorkspacePackage[];
  return packages.filter((pkg) => !pkg.private);
}

function encodePackageName(name: string): string {
  return name.startsWith('@')
    ? `@${encodeURIComponent(name.slice(1))}`
    : encodeURIComponent(name);
}

async function isPublishedOnNpm(
  name: string,
  version: string,
): Promise<boolean> {
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

function localTagExists(tag: string): boolean {
  return (
    execSync(`git tag -l "${tag}"`, { stdio: ['pipe', 'pipe', 'pipe'] })
      .toString()
      .trim() === tag
  );
}

function ensureLocalTag(tag: string): void {
  if (!localTagExists(tag)) {
    execSync(`git tag "${tag}"`);
  }
}

async function pushTags(tags: string[]): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= PUSH_ATTEMPTS; attempt++) {
    try {
      await execFileAsync('git', ['push', 'origin', ...tags], {
        maxBuffer: 32 * 1024 * 1024,
      });
      return;
    } catch (err) {
      lastError = err;
      const message =
        (err as { stderr?: string; message?: string }).stderr
          ?.toString()
          .trim() || (err as Error).message;
      console.warn(
        `Tag push attempt ${attempt}/${PUSH_ATTEMPTS} failed: ${message}`,
      );
      if (attempt < PUSH_ATTEMPTS) {
        await sleep(PUSH_BACKOFF_MS * attempt);
      }
    }
  }
  throw lastError;
}

function extractChangelogSection(
  pkgPath: string,
  version: string,
): string | null {
  const file = join(pkgPath, 'CHANGELOG.md');
  if (!existsSync(file)) {
    return null;
  }
  const lines = readFileSync(file, 'utf8').split('\n');
  const start = lines.findIndex((line) => line.trim() === `## ${version}`);
  if (start === -1) {
    return null;
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^## /.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
}

function githubApiHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function releaseExists(
  repo: string,
  tag: string,
  token: string,
): Promise<boolean> {
  const res = await fetch(
    `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`,
    {
      headers: githubApiHeaders(token),
      signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
    },
  );
  if (res.status === 404) {
    return false;
  }
  if (!res.ok) {
    throw new Error(
      `GitHub release lookup failed for ${tag}: ${res.status} ${await res.text()}`,
    );
  }
  return true;
}

async function createRelease(
  repo: string,
  tag: string,
  body: string,
  token: string,
): Promise<void> {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases`, {
    method: 'POST',
    headers: githubApiHeaders(token),
    signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
    body: JSON.stringify({ tag_name: tag, name: tag, body }),
  });
  if (!res.ok) {
    throw new Error(
      `GitHub release creation failed for ${tag}: ${res.status} ${await res.text()}`,
    );
  }
}

async function main(): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) {
    throw new Error('GITHUB_TOKEN and GITHUB_REPOSITORY must be set');
  }

  const packages = getPublicPackages();
  const publishedFlags = await pMap(packages, CHECK_CONCURRENCY, (pkg) =>
    isPublishedOnNpm(pkg.name, pkg.version),
  );
  const released = packages.filter((_, i) => publishedFlags[i]);

  if (released.length === 0) {
    console.log('No published package versions to reconcile.');
    return;
  }

  const tags = released.map((pkg) => `${pkg.name}@${pkg.version}`);
  for (const tag of tags) {
    ensureLocalTag(tag);
  }

  console.log(
    `Reconciling ${tags.length} release tag(s) for published version(s)...`,
  );
  await pushTags(tags);
  console.log('All release tags are present on the remote.');

  let created = 0;
  let failed = 0;
  for (const pkg of released) {
    const tag = `${pkg.name}@${pkg.version}`;
    try {
      if (await releaseExists(repo, tag, token)) {
        continue;
      }
      const body = extractChangelogSection(pkg.path, pkg.version) ?? '';
      await createRelease(repo, tag, body, token);
      created++;
      console.log(`Backfilled missing GitHub release ${tag}`);
    } catch (err) {
      failed++;
      console.warn(
        `Could not reconcile GitHub release ${tag}: ${(err as Error).message}`,
      );
    }
  }

  console.log(
    `GitHub release reconciliation: ${created} created, ${failed} failed (best-effort), ${released.length - created - failed} already present.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
