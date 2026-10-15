import { interpolate } from 'remotion';

import { easeInOut } from '../theme';

export interface CursorKey {
  readonly f: number;
  readonly x: number;
  readonly y: number;
  readonly click?: boolean;
}

/** A macOS-style pointer that glides between keyframes and ripples on clicks. */
export function Cursor({
  frame,
  keys,
  visibleFrom = 0,
  visibleTo = Infinity,
}: {
  readonly frame: number;
  readonly keys: readonly CursorKey[];
  readonly visibleFrom?: number;
  readonly visibleTo?: number;
}): React.ReactElement | null {
  if (frame < visibleFrom || frame > visibleTo || keys.length === 0) return null;
  const fs = keys.map((k) => k.f);
  const opts = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeInOut } as const;
  const x =
    keys.length === 1
      ? keys[0].x
      : interpolate(
          frame,
          fs,
          keys.map((k) => k.x),
          opts,
        );
  const y =
    keys.length === 1
      ? keys[0].y
      : interpolate(
          frame,
          fs,
          keys.map((k) => k.y),
          opts,
        );
  const click = keys
    .filter((k) => k.click)
    .map((k) => frame - k.f)
    .find((d) => d >= 0 && d < 14);
  const press =
    click === undefined
      ? 1
      : interpolate(click, [0, 3, 8], [1, 0.82, 1], { extrapolateRight: 'clamp' });
  const fade = interpolate(
    frame,
    [visibleFrom, visibleFrom + 6, visibleTo - 6, visibleTo],
    [0, 1, 1, 0],
  );
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        pointerEvents: 'none',
        opacity: fade,
        zIndex: 50,
      }}
    >
      {click !== undefined ? (
        <div
          style={{
            position: 'absolute',
            left: -26,
            top: -26,
            width: 52,
            height: 52,
            borderRadius: 999,
            border: '3px solid rgba(33,78,64,0.55)',
            transform: `scale(${0.3 + (click / 14) * 1.2})`,
            opacity: 1 - click / 14,
          }}
        />
      ) : null}
      <svg
        width="34"
        height="40"
        viewBox="0 0 17 20"
        style={{
          transform: `scale(${press})`,
          transformOrigin: '0 0',
          filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.25))',
        }}
      >
        <path
          d="M1 1v15.5l4.2-4 2.8 6.3 2.7-1.2-2.7-6.2H14z"
          fill="#111"
          stroke="#fff"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
