import { type CollectionEntry, getCollection } from 'astro:content';

import type { ContentPageType } from './content-feed';
import { SECTION_LIST, type SectionMeta } from './sections';

export type ContentEntry = CollectionEntry<'content'>;

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

export async function getPublishedSections(): Promise<SectionMeta[]> {
  const entries = await getCollection('content');
  const populated = new Set(entries.map((entry) => entry.data.pageType));
  return SECTION_LIST.filter((section) => populated.has(section.pageType));
}

export function entrySlug(entry: ContentEntry): string {
  return entry.data.slug;
}
