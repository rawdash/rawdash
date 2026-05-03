import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://rawdash.dev',
  integrations: [
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
            { label: 'OSS Quickstart', slug: 'docs/quickstart' },
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
          label: 'Reference',
          items: [{ label: 'API Reference', slug: 'docs/api-reference' }],
        },
        {
          label: 'Cloud',
          items: [
            { label: 'Overview', slug: 'docs/cloud' },
            { label: 'Cloud Quickstart', slug: 'docs/cloud/quickstart' },
            { label: 'Billing', slug: 'docs/cloud/billing' },
          ],
        },
      ],
      customCss: ['./src/styles/custom.css'],
    }),
  ],
});
