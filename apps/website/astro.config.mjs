import sitemap from '@astrojs/sitemap';
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

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
    sitemap(),
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
  ],
});
