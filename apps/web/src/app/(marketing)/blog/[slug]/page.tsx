import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import * as React from 'react';

import { getAllPosts, getPostBySlug } from '../../../../lib/blog.js';

interface SlugParams {
  readonly slug: string;
}

/**
 * Tells Next.js the static set of slugs at build time. Empty today
 * (Phase 2 ships zero posts), populated automatically when posts
 * land in `apps/web/content/blog/`. The dynamic route still works
 * for typo'd URLs — they hit `notFound()` below.
 */
export function generateStaticParams(): SlugParams[] {
  return getAllPosts().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<SlugParams>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return { title: 'Post not found' };
  return {
    title: post.title,
    description: post.summary,
    alternates: { canonical: `/blog/${post.slug}` },
  };
}

/**
 * `/blog/[slug]` — single post. Today every slug 404s because the
 * post layer returns `null` until MDX runtime + content directory
 * are wired (this lands with the first real post).
 */
export default async function BlogPostPage({
  params,
}: {
  readonly params: Promise<SlugParams>;
}): Promise<React.ReactElement> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) notFound();

  return (
    <main id="main-content">
      <article className="mx-auto max-w-3xl px-4 pb-32 pt-24 sm:px-6 sm:pt-32 lg:px-8">
        <p className="text-caption text-gray-warm mb-4 uppercase tracking-[0.14em]">
          {post.publishedAt} · {String(post.minutesToRead)} min
        </p>
        <h1 className="font-display mb-8 text-balance text-[40px] font-normal leading-[1.08] tracking-[-0.02em] text-black sm:text-[48px]">
          {post.title}
        </h1>
        <p className="text-body-large text-gray-dark mb-12 max-w-2xl">{post.summary}</p>
        <p className="text-body text-gray-dark">
          MDX runtime is wired alongside the first post. Until then this page is the title block
          only.
        </p>
      </article>
    </main>
  );
}
