import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import HomePage from './page.js';

describe('HomePage', () => {
  it('explains the product and exposes the main calls to action', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Your front deskisn’t a call center.',
    );
    for (const link of screen.getAllByRole('link', { name: 'Get started free' }))
      expect(link).toHaveAttribute('href', '/sign-up');
    expect(screen.getByRole('link', { name: 'Book a demo' })).toHaveAttribute('href', '/contact');
  });
  it('labels demo data and lets users walk through the entire follow-up', async () => {
    const user = userEvent.setup();
    render(<HomePage />);
    expect(screen.getByText('Illustrative example')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Claim imported' }));
    expect(screen.getByRole('button', { name: 'Claim imported' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('One less claim to chase.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'See the next step' }));
    expect(screen.getByText('The hold music is our job.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'See the next step' }));
    expect(screen.getByText('Payment is being processed')).toBeInTheDocument();
  });
  it('shows import, call, and review as three concrete steps', () => {
    render(<HomePage />);
    for (const name of [
      'Bring your open claims.',
      'Let us make the call.',
      'Know what happens next.',
    ])
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
  });
});
