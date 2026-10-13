import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardShell } from './dashboard-shell.js';

describe('<DashboardShell />', () => {
  beforeEach(() => {
    const items = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => items.set(key, value),
        clear: () => {
          items.clear();
        },
      },
    });
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  it('renders the sidebar, topbar, and main content slots', () => {
    render(
      <DashboardShell
        sidebar={<div data-testid="sb">side</div>}
        topbar={<div data-testid="tb">top</div>}
      >
        <div data-testid="page">main</div>
      </DashboardShell>,
    );

    expect(screen.getByTestId('sb')).toBeInTheDocument();
    expect(screen.getByTestId('tb')).toBeInTheDocument();
    expect(screen.getByTestId('page')).toBeInTheDocument();
    expect(
      screen.getByRole('complementary', { name: /dashboard navigation/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('main')).toContainElement(screen.getByTestId('page'));
  });

  it('exposes a mobile menu toggle wired to the sidebar via aria-controls', () => {
    render(
      <DashboardShell sidebar={<div />} topbar={<div />}>
        <div />
      </DashboardShell>,
    );
    const opener = screen.getByRole('button', { name: /open menu/i });
    expect(opener).toHaveAttribute('aria-expanded', 'false');
    expect(opener).toHaveAttribute('aria-controls');
  });

  it('opens the drawer when the hamburger is clicked and closes via Escape', async () => {
    const user = userEvent.setup();
    render(
      <DashboardShell sidebar={<div />} topbar={<div />}>
        <div />
      </DashboardShell>,
    );
    const opener = screen.getByRole('button', { name: /open menu/i });
    await user.click(opener);
    expect(opener).toHaveAttribute('aria-expanded', 'true');

    await user.keyboard('{Escape}');
    expect(opener).toHaveAttribute('aria-expanded', 'false');
  });

  it('hydrates the collapsed state from localStorage and exposes it on the aside', async () => {
    window.localStorage.setItem('dentabill:dashboard:sidebar-collapsed', '1');
    render(
      <DashboardShell sidebar={<div />} topbar={<div />}>
        <div />
      </DashboardShell>,
    );
    const sidebar = await screen.findByRole('complementary', { name: /dashboard navigation/i });
    expect(sidebar).toHaveAttribute('data-collapsed', 'true');
  });

  it('closes the drawer when the close button inside the sidebar is pressed', async () => {
    const user = userEvent.setup();
    render(
      <DashboardShell sidebar={<div />} topbar={<div />}>
        <div />
      </DashboardShell>,
    );
    const opener = screen.getByRole('button', { name: /open menu/i });
    await user.click(opener);
    const closer = screen.getByRole('button', { name: /close menu/i });
    await user.click(closer);
    expect(opener).toHaveAttribute('aria-expanded', 'false');
  });
});
