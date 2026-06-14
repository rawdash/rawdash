import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ContentFeedItem } from './content-feed';
import { SECTION_LIST } from './sections';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEBSITE_DIR = join(HERE, '..', '..');
const REPO_ROOT = join(WEBSITE_DIR, '..', '..');
const CONNECTORS_DIR = join(REPO_ROOT, 'packages', 'connectors');
const PLACEHOLDERS_FILE = join(
  REPO_ROOT,
  'scripts',
  'connector-placeholders.ts',
);
const DOCS_DIR = join(WEBSITE_DIR, 'src', 'content', 'docs', 'docs');
const PAGES_DIR = join(WEBSITE_DIR, 'src', 'pages');

const gitLastmodCache = new Map<string, string | undefined>();

function gitLastmod(absPath: string): string | undefined {
  const cached = gitLastmodCache.get(absPath);
  if (cached !== undefined || gitLastmodCache.has(absPath)) {
    return cached;
  }
  let iso: string | undefined;
  try {
    const out = execFileSync(
      'git',
      ['log', '-1', '--format=%cI', '--', absPath],
      { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    iso = out ? new Date(out).toISOString() : undefined;
  } catch (error) {
    console.warn(
      `sitemap lastmod: git log failed for ${absPath}: ${(error as Error).message}`,
    );
    iso = undefined;
  }
  gitLastmodCache.set(absPath, iso);
  return iso;
}

function normalizePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

export function buildSitemapLastmod(
  feedItems: ContentFeedItem[],
): (url: string) => string | undefined {
  const basePathByType = new Map(
    SECTION_LIST.map((section) => [section.pageType, section.basePath]),
  );
  const feedLastmod = new Map<string, string>();
  const sectionLatestTs = new Map<string, number>();

  for (const item of feedItems) {
    const basePath = basePathByType.get(item.pageType);
    if (!basePath) {
      continue;
    }
    const raw = item.updatedAt ?? item.publishedAt;
    if (!raw) {
      continue;
    }
    const ts = Date.parse(raw);
    if (Number.isNaN(ts)) {
      continue;
    }
    const iso = new Date(ts).toISOString();
    feedLastmod.set(`${basePath}/${item.slug}`, iso);
    sectionLatestTs.set(
      basePath,
      Math.max(sectionLatestTs.get(basePath) ?? 0, ts),
    );
  }

  const sectionIndexLastmod = new Map<string, string>();
  for (const [basePath, ts] of sectionLatestTs) {
    sectionIndexLastmod.set(basePath, new Date(ts).toISOString());
  }

  return (url: string): string | undefined => {
    const pathname = normalizePathname(new URL(url).pathname);

    const feed = feedLastmod.get(pathname);
    if (feed) {
      return feed;
    }

    const sectionIndex = sectionIndexLastmod.get(pathname);
    if (sectionIndex) {
      return sectionIndex;
    }

    if (pathname === '/docs/connectors') {
      return gitLastmod(CONNECTORS_DIR);
    }

    const connector = pathname.match(
      /^\/docs\/connectors\/[^/]+(?:\/([^/]+))?$/,
    );
    if (connector) {
      const id = connector[1];
      if (!id) {
        return gitLastmod(CONNECTORS_DIR);
      }
      const packageDir = join(CONNECTORS_DIR, id);
      return existsSync(packageDir)
        ? gitLastmod(packageDir)
        : gitLastmod(PLACEHOLDERS_FILE);
    }

    if (pathname === '/docs') {
      return gitLastmod(join(DOCS_DIR, 'index.mdx'));
    }

    if (pathname.startsWith('/docs/')) {
      const slug = pathname.slice('/docs/'.length);
      for (const candidate of [
        join(DOCS_DIR, `${slug}.mdx`),
        join(DOCS_DIR, `${slug}.md`),
        join(DOCS_DIR, slug, 'index.mdx'),
      ]) {
        if (existsSync(candidate)) {
          return gitLastmod(candidate);
        }
      }
    }

    if (pathname === '/') {
      return gitLastmod(join(PAGES_DIR, 'index.astro'));
    }

    return undefined;
  };
}
