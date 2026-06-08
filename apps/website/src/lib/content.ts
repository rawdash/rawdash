import { type CollectionEntry, getCollection } from 'astro:content';

import type { ContentPageType } from './content-feed';

export type ContentEntry = CollectionEntry<'content'>;

export interface SectionMeta {
  pageType: ContentPageType;
  basePath: string;
  title: string;
  description: string;
  label: string;
}

export const SECTIONS = {
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

function publishedTime(entry: ContentEntry): number {
  const date = entry.data.publishedAt ?? entry.data.updatedAt;
  return date ? date.getTime() : 0;
}

export async function getSectionEntries(
  pageType: ContentPageType,
): Promise<ContentEntry[]> {
  const entries = await getCollection(
    'content',
    ({ data }) => data.pageType === pageType,
  );
  return entries.sort((a, b) => publishedTime(b) - publishedTime(a));
}

export function entrySlug(entry: ContentEntry): string {
  return entry.data.slug;
}
