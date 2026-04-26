import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { CookieBanner, COOKIE_BANNER_STORAGE_KEY } from './cookie-banner.js';

class MemoryStorage {
  private readonly store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) ?? null) : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  has(key: string): boolean {
    return this.store.has(key);
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
});

describe('<CookieBanner />', () => {
  it('renders the notice when the user has not yet dismissed', async () => {
    render(<CookieBanner storage={storage} />);
    expect(await screen.findByRole('region', { name: /cookie notice/i })).toBeVisible();
  });

  it('persists dismissal to storage and unmounts on click', async () => {
    const user = userEvent.setup();
    render(<CookieBanner storage={storage} />);
    const dismiss = await screen.findByRole('button', { name: /got it/i });
    await user.click(dismiss);
    expect(screen.queryByRole('region', { name: /cookie notice/i })).not.toBeInTheDocument();
    expect(storage.getItem(COOKIE_BANNER_STORAGE_KEY)).toBe('1');
  });

  it('stays hidden when dismissal is already persisted', () => {
    storage.setItem(COOKIE_BANNER_STORAGE_KEY, '1');
    render(<CookieBanner storage={storage} />);
    expect(screen.queryByRole('region', { name: /cookie notice/i })).not.toBeInTheDocument();
  });

  it('exposes a privacy policy link', async () => {
    render(<CookieBanner storage={storage} />);
    const link = await screen.findByRole('link', { name: /privacy policy/i });
    expect(link).toHaveAttribute('href', '/privacy');
  });
});
