import sitemap from '@astrojs/sitemap';
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://rawdash.dev',
  integrations: [
    sitemap(),
    starlight({
      title: 'Rawdash',
      description: 'Headless dashboard backend for any team.',
      logo: {
        src: './src/assets/logo.svg',
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
