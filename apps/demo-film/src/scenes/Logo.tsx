import { useCurrentFrame } from 'remotion';

import { Backdrop } from '../components/Backdrop';
import { Kinetic } from '../components/Kinetic';
import { Mark } from '../components/Logo';
import { C, FONT_BODY, pop, ramp } from '../theme';

/** 4–8 s: the brand lands on the downbeat. */
export function LogoScene(): React.ReactElement {
  const f = useCurrentFrame();
  const mark = pop(f, 0, 30, 11);
  const slide = pop(f, 12, 30, 18);
  const word = ramp(f, 14, 32);
  const out = ramp(f, 104, 120);
  return (
    <>
      <Backdrop />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: 1 - out,
          filter: `blur(${out * 10}px)`,
          transform: `translateY(${-out * 40}px)`,
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 330,
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 28,
          }}
        >
          <div
            style={{
              transform: `scale(${mark}) rotate(${(1 - mark) * -30}deg)`,
              marginRight: (1 - slide) * -380,
            }}
          >
            <Mark size={150} color={C.brand} />
          </div>
          <div style={{ overflow: 'hidden', width: slide * 640 }}>
            <div
              style={{
                fontFamily: FONT_BODY,
                fontSize: 132,
                fontWeight: 600,
                letterSpacing: '-0.045em',
                color: C.brand,
                opacity: word,
                transform: `translateX(${(1 - word) * -40}px)`,
                whiteSpace: 'nowrap',
              }}
            >
              DentaBill
            </div>
          </div>
        </div>
        <div style={{ position: 'absolute', top: 560, left: 0, right: 0 }}>
          <Kinetic
            text="The AI agent that calls insurance for you."
            start={34}
            stagger={3}
            size={64}
            color={C.ink}
            accent={{ words: ['for', 'you'], color: C.brand }}
            italicWords={['for', 'you']}
          />
        </div>
      </div>
    </>
  );
}
