import { describe, expect, it } from 'vitest';

import { getAllPosts, getPostBySlug } from './blog.js';

describe('blog content layer (skeleton)', () => {
  it('returns an empty post list until the first post lands', () => {
    expect(getAllPosts()).toEqual([]);
  });

  it('returns null for any slug while the catalog is empty', () => {
    expect(getPostBySlug('a')).toBeNull();
    expect(getPostBySlug('does-not-exist')).toBeNull();
  });
});
