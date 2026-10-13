import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AuthShell } from './auth-shell.js';

describe('<AuthShell />', () => {
  it('renders the page title, description, and a wordmark linked to home', () => {
    render(
      <AuthShell pageTitle="Sign in" pageDescription="Welcome back.">
        <div data-testid="slot" />
      </AuthShell>,
    );
    expect(screen.getByRole('heading', { level: 1, name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByText(/welcome back/i)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /dentabill home/i })[0]).toHaveAttribute(
      'href',
      '/',
    );
    expect(screen.getByTestId('slot')).toBeInTheDocument();
  });

  it('renders the legal footer with /terms + /privacy anchors', () => {
    render(
      <AuthShell pageTitle="t" pageDescription="d">
        <div />
      </AuthShell>,
    );
    expect(screen.getByRole('link', { name: /^terms$/i })).toHaveAttribute('href', '/terms');
    expect(screen.getByRole('link', { name: /privacy policy/i })).toHaveAttribute(
      'href',
      '/privacy',
    );
  });

  it('exposes a single <main> landmark for axe-clean structure', () => {
    const { container } = render(
      <AuthShell pageTitle="t" pageDescription="d">
        <div />
      </AuthShell>,
    );
    expect(container.querySelectorAll('main')).toHaveLength(1);
  });
});
