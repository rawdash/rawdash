import type { ContentPageType } from './content-feed';

export interface SectionMeta {
  pageType: ContentPageType;
  basePath: string;
  title: string;
  description: string;
  label: string;
}

export const SECTIONS = {
  dashboards: {
    pageType: 'dashboard',
    basePath: '/dashboards',
    title: 'Dashboards',
    description:
      'Outcome dashboards built on Rawdash — wired to your tools, ready to ship.',
    label: 'Dashboards',
  },
  metrics: {
    pageType: 'metric',
    basePath: '/metrics',
    title: 'Metrics & KPIs',
    description:
      'A plain-English library of the metrics that matter — definitions, formulas, benchmarks, and the connectors that surface them.',
    label: 'Metrics',
  },
  blog: {
    pageType: 'blog',
    basePath: '/blog',
    title: 'Blog',
    description:
      'Guides, deep-dives, and dashboard playbooks from the Rawdash team.',
    label: 'Blog',
  },
  integrations: {
    pageType: 'integration',
    basePath: '/integrations',
    title: 'Integrations',
    description:
      'Outcome dashboards for the tools you already run — pre-wired connectors, sync, and a clean API.',
    label: 'Integrations',
  },
  compare: {
    pageType: 'compare',
    basePath: '/compare',
    title: 'Compare',
    description:
      'Honest, side-by-side comparisons of Rawdash and other dashboard and analytics tools.',
    label: 'Compare',
  },
  alternatives: {
    pageType: 'alternative',
    basePath: '/alternatives',
    title: 'Alternatives',
    description:
      'Looking to switch? Straight-talking guides to Rawdash as an alternative to the usual suspects.',
    label: 'Alternatives',
  },
} satisfies Record<string, SectionMeta>;

export const SECTION_LIST: SectionMeta[] = Object.values(SECTIONS);
