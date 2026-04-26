import { Pill } from '@dentabill/ui';
import type { Metadata } from 'next';
import * as React from 'react';

import { NewsletterSignupStub } from '../../../components/marketing/index.js';
import { getAllPosts, type BlogPost } from '../../../lib/blog.js';

export const metadata: Metadata = {
  title: 'Blog',
  description:
    'Notes from the DentaBill team on dental billing automation, payer IVR drift, and the engineering behind the voice agent.',
  alternates: { canonical: '/blog' },
};

/**
 * /blog — index page.
 *
 * Phase 2 ships the skeleton with zero posts. The empty state
 * deliberately does not say "Coming soon" or run a countdown timer;
 * it offers the newsletter signup and the contact path so a visitor
 * here for content has somewhere to go.
 *
 * When the first post lands in `apps/web/content/blog/`, the empty
 * branch unmounts and the listing renders. Pagination + tag pages
 * are deferred until the post catalog actually needs them.
 */
export default function BlogIndexPage(): React.ReactElement {
  const posts = getAllPosts();

  return (
    <main>
      <section className="mx-auto max-w-3xl px-4 pb-16 pt-24 sm:px-6 sm:pt-32 lg:px-8">
        <p className="text-caption text-gray-warm mb-4 uppercase tracking-[0.14em]">Blog</p>
        <h1 className="font-display mb-6 text-balance text-[40px] font-extralight leading-[1.08] tracking-[-0.02em] text-black sm:text-[52px]">
          {posts.length === 0
            ? 'No posts yet. We would rather publish nothing than publish filler.'
            : 'Notes from the DentaBill team.'}
        </h1>
        <p className="text-body-large text-gray-dark max-w-2xl">
          When we have something concrete to say about dental billing automation, payer IVR drift,
          or the engineering choices behind DentaBill, it will appear here. Subscribe to the
          newsletter and the first post arrives the day we publish it.
        </p>
      </section>

      {posts.length === 0 ? <EmptyState /> : <PostList posts={posts} />}
    </main>
  );
}

function EmptyState(): React.ReactElement {
  return (
    <section aria-labelledby="empty-blog-heading" className="bg-gray-light border-t border-black/5">
      <div className="mx-auto grid max-w-5xl gap-12 px-4 py-24 sm:px-6 sm:py-32 lg:grid-cols-12 lg:gap-16 lg:px-8">
        <div className="lg:col-span-5">
          <h2
            id="empty-blog-heading"
            className="font-display text-section-heading mb-4 text-balance font-light text-black"
          >
            Subscribe and the first post lands in your inbox.
          </h2>
          <p className="text-body text-gray-dark max-w-md">
            One newsletter. No drip campaigns, no roundup digests. Unsubscribe in one click.
          </p>
        </div>
        <div className="lg:col-span-7">
          <NewsletterSignupStub />
        </div>
      </div>
    </section>
  );
}

interface PostListProps {
  readonly posts: readonly BlogPost[];
}

function PostList({ posts }: PostListProps): React.ReactElement {
  return (
    <section aria-labelledby="post-list-heading" className="bg-gray-light border-t border-black/5">
      <h2 id="post-list-heading" className="sr-only">
        Posts
      </h2>
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
        <ul className="divide-y divide-black/10 border-y border-black/10">
          {posts.map((post) => (
            <li key={post.slug}>
              <a
                href={`/blog/${post.slug}`}
                className="block py-8 hover:bg-white/40 focus-visible:rounded-md focus-visible:bg-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
              >
                <p className="text-caption text-gray-warm mb-2 uppercase tracking-[0.14em]">
                  {post.publishedAt} · {String(post.minutesToRead)} min
                </p>
                <h3 className="font-display text-card-heading mb-2 text-balance font-light text-black">
                  {post.title}
                </h3>
                <p className="text-body text-gray-dark">{post.summary}</p>
              </a>
            </li>
          ))}
        </ul>
        <div className="mt-12">
          <Pill href="/sign-up" variant="black" withArrow>
            Start free trial
          </Pill>
        </div>
      </div>
    </section>
  );
}
