import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Avatar, AvatarFallback, AvatarImage } from './avatar.js';

describe('<Avatar />', () => {
  it('renders with pill radius', () => {
    render(
      <Avatar data-testid="a">
        <AvatarFallback>YB</AvatarFallback>
      </Avatar>,
    );
    expect(screen.getByTestId('a').className).toContain('rounded-pill');
  });

  it('AvatarFallback shows initials with achromatic gray + warm-medium', () => {
    render(
      <Avatar>
        <AvatarFallback data-testid="fb">YB</AvatarFallback>
      </Avatar>,
    );
    const fb = screen.getByTestId('fb');
    expect(fb).toHaveTextContent('YB');
    expect(fb.className).toContain('bg-gray-light');
    expect(fb.className).toContain('text-gray-dark');
  });

  it('AvatarImage exists as a Radix wrapper (renders fallback initially under jsdom — image never loads)', () => {
    // Under jsdom, `<img>` never fires `load`, so Radix shows the fallback.
    // This test asserts the composition is valid; integration testing of the
    // actual `<img>` swap happens in Playwright.
    render(
      <Avatar>
        <AvatarImage src="/x.png" alt="me" />
        <AvatarFallback>YB</AvatarFallback>
      </Avatar>,
    );
    expect(screen.getByText('YB')).toBeInTheDocument();
  });
});
