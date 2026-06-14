import sitemap from '@astrojs/sitemap';
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

import { fetchPublishedFeedItems } from './src/lib/content-feed';
import { SECTION_LIST } from './src/lib/sections';
import { sitemapIndexLastmod } from './src/lib/sitemap-index-lastmod';
import { buildSitemapLastmod } from './src/lib/sitemap-lastmod';

const feedItems = await fetchPublishedFeedItems();
const publishedPageTypes = new Set(feedItems.map((item) => item.pageType));
const sitemapLastmod = buildSitemapLastmod(feedItems);
const hiddenSectionPaths = new Set(
  SECTION_LIST.filter(
    (section) => !publishedPageTypes.has(section.pageType),
  ).map((section) => `${section.basePath}/`),
);

const ga4Id = process.env.PUBLIC_GA4_ID?.trim();
const ga4Head = ga4Id
  ? [
      {
        tag: 'script',
        attrs: {
          async: true,
          src: `https://www.googletagmanager.com/gtag/js?id=${ga4Id}`,
        },
      },
      {
        tag: 'script',
        content: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${ga4Id}');`,
      },
    ]
  : [];

export default defineConfig({
  site: 'https://rawdash.dev',
  integrations: [
    sitemap({
      filter: (page) => !hiddenSectionPaths.has(new URL(page).pathname),
      serialize(item) {
        const lastmod = sitemapLastmod(item.url);
        if (lastmod) {
          item.lastmod = lastmod;
        }
        return item;
      },
    }),
    starlight({
      title: 'Rawdash',
      description: 'Headless dashboard backend for any team.',
      head: ga4Head,
      logo: {
        light: './src/assets/logo.svg',
        dark: './src/assets/logo-dark.svg',
        replacesTitle: true,
      },
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/rawdash/rawdash',
        },
      ],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Introduction', slug: 'docs/getting-started' },
            { label: 'Quickstart', slug: 'docs/quickstart' },
            { label: 'Cloud Quickstart', slug: 'docs/cloud-quickstart' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Connector Author Guide', slug: 'docs/connector-guide' },
            { label: 'MCP Setup', slug: 'docs/mcp-setup' },
          ],
        },
        {
          label: 'Connectors',
          slug: 'docs/connectors',
        },
        {
          label: 'Reference',
          items: [{ label: 'API Reference', slug: 'docs/api-reference' }],
        },
      ],
      components: {
        Pagination: './src/components/Pagination.astro',
      },
      customCss: ['./src/styles/custom.css'],
    }),
    sitemapIndexLastmod(),
  ],
});
