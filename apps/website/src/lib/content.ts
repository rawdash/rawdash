import { type CollectionEntry, getCollection } from 'astro:content';

import type { ContentPageType } from './content-feed';
import {
  PRODUCT_HUB_SECTIONS,
  SECTION_LIST,
  type SectionMeta,
} from './sections';

export type ContentEntry = CollectionEntry<'content'>;

export interface NavLink {
  href: string;
  label: string;
}

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

async function getPublishedPageTypes(): Promise<Set<ContentPageType>> {
  const entries = await getCollection('content');
  return new Set(entries.map((entry) => entry.data.pageType));
}

export async function getPublishedSections(): Promise<SectionMeta[]> {
  const published = await getPublishedPageTypes();
  return SECTION_LIST.filter((section) => published.has(section.pageType));
}

export async function getPublishedProductHubs(): Promise<NavLink[]> {
  const published = await getPublishedPageTypes();
  return PRODUCT_HUB_SECTIONS.filter((section) =>
    published.has(section.pageType),
  ).map((section) => ({ href: `${section.basePath}/`, label: section.label }));
}

export async function hasPublishedSection(
  pageType: ContentPageType,
): Promise<boolean> {
  return (await getPublishedPageTypes()).has(pageType);
}

export function entrySlug(entry: ContentEntry): string {
  return entry.data.slug;
}
