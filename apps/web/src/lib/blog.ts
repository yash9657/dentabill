/**
 * Blog content layer.
 *
 * The blog ships in P2-T26 as a skeleton: working `/blog` and
 * `/blog/[slug]` routes, no posts. The post list is sourced from
 * `apps/web/content/blog/*.mdx` (gitkept directory today, real
 * content arrives as we have something useful to say).
 *
 * Why MDX-from-filesystem rather than `@content-collections/next`
 * or `contentlayer-next`:
 *
 *   - Zero new runtime dep until there's actually a post that needs
 *     to be rendered. Both content-collection libraries ship a
 *     build-step process and a runtime helper; that's worth the
 *     weight only when the post catalog grows past five entries.
 *   - The blog at this stage is "publish a tactical note when we
 *     have one", not a content marketing engine. Filesystem reads
 *     stay readable end-to-end.
 *   - When the first post ships, this file gets a small `gray-matter`
 *     + `next-mdx-remote` (or @next/mdx) compile path. The shape of
 *     `getAllPosts` and `getPostBySlug` does not change; the
 *     `<MarkdownBody>` of the slug page does.
 *
 * Until then the listing is empty and the slug route 404s, both
 * with friendly empty states.
 */

export interface BlogPost {
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly publishedAt: string;
  readonly minutesToRead: number;
}

/**
 * Returns the published post list, sorted newest-first.
 *
 * Phase 2 ships zero posts; the empty array is the canonical result
 * and the index page renders an empty state. When we add the first
 * post (`apps/web/content/blog/<slug>.mdx`), this function reads the
 * directory at build time, parses the frontmatter, and returns
 * `BlogPost[]`. Callers should not assume the list is non-empty.
 */
export function getAllPosts(): readonly BlogPost[] {
  return [];
}

/**
 * Returns a single post by slug, or `null` if not found. The slug
 * route uses `null` to trigger Next's `notFound()` rather than
 * rendering a "post deleted" stub.
 */
export function getPostBySlug(slug: string): BlogPost | null {
  // No posts yet (catalog is empty until P2-T26 ships its first).
  // We still take the slug parameter so callers don't need to change
  // when the lookup is real.
  void slug;
  return null;
}
