import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import HomePage from './page.js';

describe('HomePage (P2-T18)', () => {
  it('renders the hero h1', () => {
    render(<HomePage />);
    expect(
      screen.getByRole('heading', { level: 1, name: /stop waiting on hold/i }),
    ).toBeInTheDocument();
  });

  it('renders the call-flow waveform with an accessible label', () => {
    render(<HomePage />);
    expect(screen.getByRole('img', { name: /diagram of a dentabill call/i })).toBeInTheDocument();
  });

  it('exposes the live-call status example using the only chromatic surface in the system', () => {
    render(<HomePage />);
    expect(screen.getByText(/calling delta dental ppo/i)).toBeInTheDocument();
  });

  it('renders the three "How it works" step headings', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { level: 3, name: /upload a csv/i })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 3, name: /agent dials the payer/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 3, name: /you read the result/i }),
    ).toBeInTheDocument();
  });

  it('renders both capability rows with their headlines', () => {
    render(<HomePage />);
    expect(
      screen.getByRole('heading', { level: 3, name: /your queue runs at 6 a\.m\./i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 3, name: /patient names never reach our logs/i }),
    ).toBeInTheDocument();
  });

  it('repeats the two CTAs in hero and closing sections, all linked correctly', () => {
    render(<HomePage />);
    const trials = screen.getAllByRole('link', { name: /start free trial/i });
    expect(trials.length).toBeGreaterThanOrEqual(2);
    for (const t of trials) expect(t).toHaveAttribute('href', '/sign-up');

    const demos = screen.getAllByRole('link', { name: /book a 20-minute demo/i });
    expect(demos.length).toBeGreaterThanOrEqual(2);
    for (const d of demos) expect(d).toHaveAttribute('href', '/contact');
  });

  it('renders the closing CTA section heading', () => {
    render(<HomePage />);
    expect(
      screen.getByRole('heading', { level: 2, name: /give your front desk back the morning/i }),
    ).toBeInTheDocument();
  });
});
