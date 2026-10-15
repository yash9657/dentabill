import { interpolate, useCurrentFrame } from 'remotion';

import { FONT_DISPLAY, pop } from '../theme';

interface KineticProps {
  readonly text: string;
  /** Frame (relative to the enclosing Sequence) at which the first word lands. */
  readonly start: number;
  /** Frames between words. */
  readonly stagger?: number;
  readonly size?: number;
  readonly color?: string;
  readonly font?: string;
  readonly weight?: number;
  readonly italicWords?: readonly string[];
  readonly accent?: { readonly words: readonly string[]; readonly color: string };
  readonly exitAt?: number;
  readonly align?: 'left' | 'center';
  readonly letterSpacing?: string;
}

/** Word-by-word kinetic type: each word rises out of a blur on a spring. */
export function Kinetic({
  text,
  start,
  stagger = 3,
  size = 96,
  color = '#202e2b',
  font = FONT_DISPLAY,
  weight = 400,
  italicWords = [],
  accent,
  exitAt,
  align = 'center',
  letterSpacing = '-0.03em',
}: KineticProps): React.ReactElement {
  const frame = useCurrentFrame();
  const words = text.split(' ');
  const exit =
    exitAt === undefined
      ? 0
      : interpolate(frame, [exitAt, exitAt + 8], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
  return (
    <div
      style={{
        fontFamily: font,
        fontSize: size,
        fontWeight: weight,
        color,
        lineHeight: 1.05,
        letterSpacing,
        textAlign: align,
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: align === 'center' ? 'center' : 'flex-start',
        columnGap: size * 0.26,
        opacity: 1 - exit,
        transform: `translateY(${-exit * 30}px)`,
        filter: exit > 0 ? `blur(${exit * 10}px)` : undefined,
      }}
    >
      {words.map((word, i) => {
        const p = pop(frame, start + i * stagger, 30, 15);
        const clean = word.replace(/[.,!?]/g, '');
        return (
          <span
            key={`${word}-${i}`}
            style={{
              display: 'inline-block',
              opacity: Math.min(1, p * 1.4),
              transform: `translateY(${(1 - p) * size * 0.45}px) scale(${0.92 + p * 0.08})`,
              filter: `blur(${(1 - Math.min(1, p)) * 12}px)`,
              fontStyle: italicWords.includes(clean) ? 'italic' : 'normal',
              color: accent?.words.includes(clean) ? accent.color : undefined,
            }}
          >
            {word}
          </span>
        );
      })}
    </div>
  );
}
