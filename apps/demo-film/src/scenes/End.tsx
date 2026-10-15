import { useCurrentFrame } from 'remotion';

import { Backdrop } from '../components/Backdrop';
import { Kinetic } from '../components/Kinetic';
import { Mark } from '../components/Logo';
import { C, FONT_BODY, pop, ramp } from '../theme';

/** Brand, promise, call to action. */
export function EndScene(): React.ReactElement {
  const f = useCurrentFrame();
  const mark = pop(f, 0, 30, 12);
  const cta = pop(f, 46, 30, 14);
  return (
    <>
      <Backdrop dark />
      <div
        style={{
          position: 'absolute',
          top: 250,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 22,
          opacity: Math.min(1, mark * 1.5),
          transform: `scale(${0.8 + mark * 0.2})`,
        }}
      >
        <Mark size={96} color={C.inkInverse} />
        <span
          style={{
            fontFamily: FONT_BODY,
            fontSize: 88,
            fontWeight: 600,
            letterSpacing: '-0.045em',
            color: C.inkInverse,
          }}
        >
          DentaBill
        </span>
      </div>
      <div style={{ position: 'absolute', top: 420, left: 0, right: 0 }}>
        <Kinetic
          text="Insurance calls, handled."
          start={12}
          stagger={4}
          size={112}
          color={C.inkInverse}
          accent={{ words: ['handled'], color: C.mint }}
          italicWords={['handled']}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          top: 640,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: '20px 34px',
            borderRadius: 99,
            background: C.inkInverse,
            color: C.brandDeep,
            fontFamily: FONT_BODY,
            fontSize: 32,
            fontWeight: 600,
            opacity: Math.min(1, cta * 1.4),
            transform: `translateY(${(1 - cta) * 30}px) scale(${0.9 + cta * 0.1})`,
          }}
        >
          Start free <span style={{ opacity: 0.4 }}>·</span> usedentabill.xyz
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: 40,
          left: 0,
          right: 0,
          textAlign: 'center',
          fontFamily: FONT_BODY,
          fontSize: 18,
          color: 'rgba(237,244,235,0.6)',
          opacity: ramp(f, 60, 75),
        }}
      >
        Synthetic demo data. Simulated call and analysis; no payer was contacted.
      </div>
    </>
  );
}
