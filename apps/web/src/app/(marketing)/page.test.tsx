import { render, screen } from '@testing-library/react';
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
  it('presents the captioned synthetic walkthrough with native playback controls', () => {
    render(<HomePage />);
    expect(screen.getByRole('region', { name: 'Watch DentaBill make a call' })).toBeVisible();
    expect(screen.getByText('67 seconds · synthetic demo')).toBeVisible();
    expect(screen.getByText('English captions')).toBeVisible();
    const video = screen.getByLabelText('DentaBill product walkthrough with synthetic data');
    expect(video.tagName).toBe('VIDEO');
    expect(video).toHaveAttribute('controls');
    expect(video).toHaveAttribute('playsinline');
    expect(video).toHaveAttribute('preload', 'none');
    expect(video).toHaveAttribute('poster', '/media/dentabill-demo/poster.jpg');
    expect(video).not.toHaveAttribute('autoplay');
    expect(video).not.toHaveAttribute('loop');
    expect(video).not.toHaveAttribute('muted');
    expect(video).toHaveAccessibleDescription(
      'Synthetic data. Simulated call and analysis; no payer was contacted.',
    );
    const source = video.querySelector('source');
    expect(source).toHaveAttribute('src', '/media/dentabill-demo/walkthrough.mp4');
    expect(source).toHaveAttribute('type', 'video/mp4');
    const captions = video.querySelector('track');
    expect(captions).toHaveAttribute('src', '/media/dentabill-demo/captions.en.vtt');
    expect(captions).toHaveAttribute('kind', 'captions');
    expect(captions).toHaveAttribute('srclang', 'en');
    expect(captions).toHaveAttribute('label', 'English');
    expect(captions).toHaveAttribute('default');
  });
  it('offers a transcript and no video download', () => {
    render(<HomePage />);
    expect(screen.getByRole('link', { name: 'Read transcript' })).toHaveAttribute(
      'href',
      '/media/dentabill-demo/transcript.html',
    );
    expect(screen.queryByRole('link', { name: /download/i })).toBeNull();
    const video = screen.getByLabelText('DentaBill product walkthrough with synthetic data');
    expect(video).toHaveAttribute('controlslist', 'nodownload');
    expect(video).toHaveTextContent('Your browser cannot play this video.');
    expect(video.querySelector('a[download]')).toBeNull();
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
