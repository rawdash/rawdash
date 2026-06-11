import type { ContentEntry } from './content';
import type { SectionMeta } from './sections';

const ORG = {
  '@type': 'Organization',
  name: 'Rawdash',
  url: 'https://rawdash.dev',
  logo: 'https://rawdash.dev/favicon.svg',
} as const;

export function serializeJsonLd(block: Record<string, unknown>): string {
  return JSON.stringify(block).replace(/</g, '\\u003c');
}

export function canonical(path: string, site: URL | undefined): string {
  const base = site ?? new URL('https://rawdash.dev');
  return new URL(path, base).href;
}

interface BreadcrumbItem {
  name: string;
  path: string;
}

export function breadcrumbJsonLd(
  items: BreadcrumbItem[],
  site: URL | undefined,
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: canonical(item.path, site),
    })),
  };
}

export function softwareApplicationJsonLd(
  description: string,
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Rawdash',
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Any',
    description,
    url: ORG.url,
    license: 'https://www.apache.org/licenses/LICENSE-2.0',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    author: ORG,
    publisher: ORG,
  };
}

export interface FaqItem {
  question: string;
  answer: string;
}

export function faqPageJsonLd(items: FaqItem[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };
}

export function definedTermJsonLd(
  term: string,
  definition: string,
  url: string,
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'DefinedTerm',
    name: term,
    description: definition,
    url,
    inDefinedTermSet: {
      '@type': 'DefinedTermSet',
      name: 'Rawdash Metrics & KPI Library',
      url: canonical('/metrics/', undefined),
    },
  };
}

export function entryJsonLd(
  entry: ContentEntry,
  url: string,
): Record<string, unknown> {
  const { data } = entry;
  const description = data.metaDescription;
  const datePublished = data.publishedAt?.toISOString();
  const dateModified = (data.updatedAt ?? data.publishedAt)?.toISOString();

  if (data.pageType === 'blog') {
    return {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: data.title,
      description,
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      ...(datePublished ? { datePublished } : {}),
      ...(dateModified ? { dateModified } : {}),
      author: data.author ? { '@type': 'Person', name: data.author } : ORG,
      publisher: ORG,
    };
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: data.title,
    description,
    url,
    ...(dateModified ? { dateModified } : {}),
    publisher: ORG,
  };
}

interface ArticleMeta {
  path: string;
  url: string;
  metaTitle: string;
  jsonLd: Record<string, unknown>[];
}

export function articleMeta(
  entry: ContentEntry,
  section: SectionMeta,
  site: URL | undefined,
): ArticleMeta {
  const path = `${section.basePath}/${entry.data.slug}/`;
  const url = canonical(path, site);
  return {
    path,
    url,
    metaTitle: entry.data.metaTitle ?? `${entry.data.title} — Rawdash`,
    jsonLd: [
      entryJsonLd(entry, url),
      breadcrumbJsonLd(
        [
          { name: 'Home', path: '/' },
          { name: section.title, path: `${section.basePath}/` },
          { name: entry.data.title, path },
        ],
        site,
      ),
    ],
  };
}
