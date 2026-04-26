import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './card.js';

describe('<Card />', () => {
  it('renders the multi-layer card shadow stack from DESIGN.md depth Level 1', () => {
    render(
      <Card data-testid="card">
        <CardHeader>
          <CardTitle>Hello</CardTitle>
        </CardHeader>
      </Card>,
    );
    const card = screen.getByTestId('card');
    expect(card.className).toContain('shadow-card-layered');
    expect(card.className).toContain('rounded-card');
    expect(card.className).toContain('bg-white');
  });

  it('CardTitle uses display family at weight 300 (font-light) per ADR-013 — NEVER bold', () => {
    render(<CardTitle>Title</CardTitle>);
    const title = screen.getByText('Title');
    expect(title.className).toContain('font-display');
    expect(title.className).toContain('font-light');
    expect(title.className).not.toContain('font-bold');
  });

  it('CardDescription uses warm-tinted secondary text', () => {
    render(<CardDescription>desc</CardDescription>);
    expect(screen.getByText('desc').className).toContain('text-gray-dark');
  });

  it('renders the full composition shape', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>T</CardTitle>
          <CardDescription>D</CardDescription>
        </CardHeader>
        <CardContent>C</CardContent>
        <CardFooter>F</CardFooter>
      </Card>,
    );
    expect(screen.getByText('T')).toBeInTheDocument();
    expect(screen.getByText('D')).toBeInTheDocument();
    expect(screen.getByText('C')).toBeInTheDocument();
    expect(screen.getByText('F')).toBeInTheDocument();
  });
});
