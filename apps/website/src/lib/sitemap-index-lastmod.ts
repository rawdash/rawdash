import type { AstroIntegration } from 'astro';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

function maxLastmod(xml: string): string | undefined {
  let latest: string | undefined;
  for (const match of xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)) {
    const value = match[1];
    if (!value) {
      continue;
    }
    if (!latest || Date.parse(value) > Date.parse(latest)) {
      latest = value;
    }
  }
  return latest;
}

export function sitemapIndexLastmod(): AstroIntegration {
  return {
    name: 'sitemap-index-lastmod',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const indexUrl = new URL('sitemap-index.xml', dir);
        let index: string;
        try {
          index = await readFile(indexUrl, 'utf8');
        } catch {
          logger.info(
            'No sitemap-index.xml found; skipping lastmod injection.',
          );
          return;
        }

        const childCache = new Map<string, string | undefined>();
        const entries = [...index.matchAll(/<sitemap>([\s\S]*?)<\/sitemap>/g)];
        let injected = 0;

        for (const [, body] of entries) {
          if (!body || /<lastmod>/.test(body)) {
            continue;
          }
          const loc = body.match(/<loc>([^<]+)<\/loc>/)?.[1];
          if (!loc) {
            continue;
          }

          let childPath: string;
          try {
            childPath = new URL(loc).pathname.replace(/^\/+/, '');
          } catch {
            logger.warn(`Skipping invalid child sitemap <loc>: ${loc}`);
            continue;
          }

          if (!childCache.has(childPath)) {
            try {
              const childXml = await readFile(new URL(childPath, dir), 'utf8');
              childCache.set(childPath, maxLastmod(childXml));
            } catch (error) {
              logger.warn(
                `Could not read child sitemap ${childPath}: ${(error as Error).message}`,
              );
              childCache.set(childPath, undefined);
            }
          }

          const lastmod = childCache.get(childPath);
          if (!lastmod) {
            continue;
          }

          const updatedBody = body.replace(
            /(<loc>[^<]+<\/loc>)/,
            `$1<lastmod>${lastmod}</lastmod>`,
          );
          index = index.replace(
            `<sitemap>${body}</sitemap>`,
            `<sitemap>${updatedBody}</sitemap>`,
          );
          injected += 1;
        }

        if (injected > 0) {
          await writeFile(fileURLToPath(indexUrl), index);
          logger.info(
            `Added <lastmod> to ${injected} sitemap-index entr(ies).`,
          );
        }
      },
    },
  };
}
