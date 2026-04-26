import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MarketingPageStub } from './page-stub.js';

describe('<MarketingPageStub />', () => {
  it('renders eyebrow + heading + body + the two fallback CTAs', () => {
    render(
      <MarketingPageStub
        eyebrow="Pricing"
        heading="The pricing page is being put together."
        body="Three tiers, free first fifty claims."
      />,
    );
    expect(screen.getByText(/^Pricing$/)).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: /pricing page is being put together/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/three tiers, free first fifty claims/i)).toBeInTheDocument();

    expect(screen.getByRole('link', { name: /back to home/i })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: /talk to us/i })).toHaveAttribute('href', '/contact');
  });
});
