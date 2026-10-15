import { Easing, interpolate, useCurrentFrame } from 'remotion';

import { Backdrop } from '../components/Backdrop';
import { Kinetic } from '../components/Kinetic';
import { C, FONT_BODY, FONT_MONO, pop, ramp } from '../theme';

/** 0–4 s: the pain, on a dark stage, under tinny hold music. */
export function HookScene(): React.ReactElement {
  const f = useCurrentFrame();
  const timerIn = pop(f, 46, 30, 13);
  const seconds = interpolate(f, [46, 112], [0, 47 * 60 + 38], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.32, 0, 0.67, 0),
  });
  const clock = `00:${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  const out = ramp(f, 108, 120, [0, 1], Easing.bezier(0.32, 0, 0.67, 0));
  return (
    <>
      <Backdrop dark />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `scale(${1 + out * 0.25})`,
          filter: `blur(${out * 16}px)`,
          opacity: 1 - out * 0.6,
        }}
      >
        <div style={{ position: 'absolute', top: 300, left: 0, right: 0 }}>
          <Kinetic
            text="Another claim. Another payer call."
            start={4}
            stagger={4}
            size={104}
            color={C.inkInverse}
            exitAt={44}
            accent={{ words: ['call'], color: C.mint }}
          />
        </div>
        <div
          style={{
            position: 'absolute',
            top: 250,
            left: 0,
            right: 0,
            textAlign: 'center',
            opacity: Math.min(1, timerIn * 1.4),
            transform: `scale(${0.85 + timerIn * 0.15})`,
          }}
        >
          <div
            style={{
              fontFamily: FONT_BODY,
              fontSize: 30,
              color: C.mint,
              fontWeight: 500,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 14,
            }}
          >
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: 9,
                background: '#e7837a',
                opacity: 0.5 + 0.5 * Math.sin(f * 0.3),
              }}
            />
            On hold with insurance
          </div>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 210,
              fontWeight: 600,
              color: C.inkInverse,
              letterSpacing: '-0.05em',
              fontVariantNumeric: 'tabular-nums',
              marginTop: 10,
            }}
          >
            {clock}
          </div>
        </div>
        <div style={{ position: 'absolute', top: 660, left: 0, right: 0 }}>
          <Kinetic text="Again." start={78} size={96} color={C.mint} italicWords={['Again']} />
        </div>
      </div>
      <div
        style={{ position: 'absolute', inset: 0, background: C.cream, opacity: ramp(f, 114, 120) }}
      />
    </>
  );
}
