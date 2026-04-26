import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import SecurityPage from './page.js';

describe('/security', () => {
  it('renders the hero h1', () => {
    render(<SecurityPage />);
    expect(
      screen.getByRole('heading', { level: 1, name: /paid to call insurance companies/i }),
    ).toBeInTheDocument();
  });

  it('renders all five major section headings', () => {
    render(<SecurityPage />);
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: /patient names never reach our application logs/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: /sign a baa with every customer/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: /vendors we share data with/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: /found something\? tell us first/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: /soc 2 and the public status page/i }),
    ).toBeInTheDocument();
  });

  it('renders the sub-processor table with three columns and at least eight rows', () => {
    render(<SecurityPage />);
    const table = screen.getByRole('table');
    expect(table).toBeInTheDocument();
    const headerCells = screen.getAllByRole('columnheader');
    expect(headerCells).toHaveLength(3);
    const dataRows = screen.getAllByRole('row').filter((r) => r.querySelectorAll('td').length > 0);
    expect(dataRows.length).toBeGreaterThanOrEqual(8);
  });

  it('exposes machine-readable mailto links for legal, security, and disclosure', () => {
    render(<SecurityPage />);
    expect(screen.getByRole('link', { name: /legal@dentabill.example/i })).toHaveAttribute(
      'href',
      'mailto:legal@dentabill.example',
    );
    const securityLinks = screen.getAllByRole('link', { name: /security@dentabill.example/i });
    expect(securityLinks.length).toBeGreaterThanOrEqual(2);
    for (const link of securityLinks) {
      expect(link.getAttribute('href') ?? '').toMatch(/^mailto:security@dentabill.example/);
    }
  });

  it('renders the closing CTAs', () => {
    render(<SecurityPage />);
    expect(screen.getByRole('link', { name: /talk to security/i })).toHaveAttribute(
      'href',
      '/contact',
    );
    expect(screen.getByRole('link', { name: /start free trial/i })).toHaveAttribute(
      'href',
      '/sign-up',
    );
  });
});
