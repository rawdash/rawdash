import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { defineCollection, z } from 'astro:content';

import { contentFeedLoader } from './lib/content-feed';

const content = defineCollection({
  loader: contentFeedLoader(),
  schema: z.object({
    pageType: z.enum(['blog', 'integration', 'compare', 'alternative']),
    slug: z.string(),
    title: z.string(),
    metaTitle: z.string().optional(),
    metaDescription: z.string(),
    description: z.string().optional(),
    body: z.string(),
    targetKeyword: z.string().optional(),
    connectors: z.array(z.string()).default([]),
    cta: z.object({ label: z.string(), href: z.string() }).optional(),
    competitor: z.string().optional(),
    author: z.string().optional(),
    tags: z.array(z.string()).default([]),
    publishedAt: z.coerce.date().optional(),
    updatedAt: z.coerce.date().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
  content,
};
