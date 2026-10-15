import { Easing, interpolate, spring } from 'remotion';

/** DESIGN.md tokens. */
export const C = {
  brand: '#214e40',
  brandDeep: '#14342a',
  brandSoft: '#e5eee7',
  mint: '#8fd6b4',
  cream: '#faf8f1',
  canvas: '#f6f7f3',
  white: '#ffffff',
  ink: '#202e2b',
  grayDark: '#4f605a',
  grayWarm: '#617068',
  border: '#d7ded6',
  borderSubtle: '#e7ebe4',
  inkInverse: '#edf4eb',
  success: '#29734f',
  successSoft: '#e9f3ec',
  warning: '#93621c',
  warningSoft: '#fbf0dc',
  danger: '#ad453d',
  dangerSoft: '#faeeeb',
} as const;

export const FONT_BODY = 'Inter, system-ui, sans-serif';
export const FONT_DISPLAY = 'Newsreader, Georgia, serif';
export const FONT_MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

export const FPS = 30;
export const s = (seconds: number): number => Math.round(seconds * FPS);

/** The standard product-film ease: quick out, soft landing. */
export const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);

export const ramp = (
  frame: number,
  from: number,
  to: number,
  out: [number, number] = [0, 1],
  easing = easeOut,
): number =>
  interpolate(frame, [from, to], out, {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing,
  });

export const pop = (frame: number, at: number, fps = FPS, damping = 14): number =>
  spring({ frame: frame - at, fps, config: { damping, mass: 0.6, stiffness: 160 } });
