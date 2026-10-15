import { interpolate, useCurrentFrame } from 'remotion';

import { easeInOut } from '../theme';

export interface Shot {
  readonly f: number;
  /** World point to center on. */
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

/** Pans and zooms a 1920×1080 world so that (x, y) sits at frame center. */
export function Camera({
  shots,
  children,
}: {
  readonly shots: readonly Shot[];
  readonly children: React.ReactNode;
}): React.ReactElement {
  const frame = useCurrentFrame();
  const opts = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeInOut } as const;
  const fs = shots.map((k) => k.f);
  const pick = (key: 'x' | 'y' | 'zoom'): number =>
    shots.length === 1
      ? shots[0][key]
      : interpolate(
          frame,
          fs,
          shots.map((k) => k[key]),
          opts,
        );
  const zoom = pick('zoom');
  const x = pick('x');
  const y = pick('y');
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          width: 1920,
          height: 1080,
          transformOrigin: '0 0',
          transform: `translate(${960 - x * zoom}px, ${540 - y * zoom}px) scale(${zoom})`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
