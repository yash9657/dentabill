import { C } from '../theme';

import { Kinetic } from './Kinetic';

/** Screen-space headline above the product window. */
export function Caption({
  text,
  start,
  exitAt,
  accent,
  italic,
  dark,
}: {
  readonly text: string;
  readonly start: number;
  readonly exitAt?: number;
  readonly accent?: readonly string[];
  readonly italic?: readonly string[];
  readonly dark?: boolean;
}): React.ReactElement {
  return (
    <div
      style={{
        position: 'absolute',
        top: 58,
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'center',
        zIndex: 40,
      }}
    >
      <Kinetic
        text={text}
        start={start}
        exitAt={exitAt}
        size={70}
        stagger={2}
        color={dark ? C.inkInverse : C.ink}
        italicWords={italic}
        accent={accent ? { words: accent, color: dark ? C.mint : C.brand } : undefined}
      />
    </div>
  );
}

/** A soft cream veil so captions stay legible over a zoomed-in product shot. */
export function TopVeil({ opacity = 1 }: { readonly opacity?: number }): React.ReactElement {
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        height: 230,
        background: `linear-gradient(${C.cream} 55%, rgba(250,248,241,0))`,
        zIndex: 30,
        opacity,
      }}
    />
  );
}
