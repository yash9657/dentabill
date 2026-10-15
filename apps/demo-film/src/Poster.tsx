import { ChevronRight, Grid3x3, Hash, Hourglass, Phone, Play, UserRound } from 'lucide-react';

import { Backdrop } from './components/Backdrop';
import { Fonts } from './components/Fonts';
import { Mark } from './components/Logo';
import { Waveform } from './components/Waveform';
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from './theme';

const path = [
  { label: 'Pressed 2 · Provider services', Icon: Grid3x3 },
  { label: 'Pressed 1 · Claim status', Icon: Grid3x3 },
  { label: 'Entered provider NPI', Icon: Hash },
  { label: 'Waited on hold · 18 min', Icon: Hourglass },
  { label: 'Reached a live rep', Icon: UserRound, last: true },
] as const;

/** Landing-page thumbnail: the agent mid-call, with a clear invitation to press play. */
export function Poster(): React.ReactElement {
  return (
    <div style={{ position: 'absolute', inset: 0, fontFamily: FONT_BODY, overflow: 'hidden' }}>
      <Fonts />
      <Backdrop dark />

      <div style={{ position: 'absolute', left: 120, top: 200, width: 880 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Mark size={48} color={C.mint} />
          <span style={{ fontSize: 34, fontWeight: 600, color: C.inkInverse }}>DentaBill</span>
        </div>
        <h1
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 400,
            fontSize: 112,
            lineHeight: 1.02,
            letterSpacing: '-0.025em',
            color: C.inkInverse,
            margin: '56px 0 0',
          }}
        >
          It calls the insurer.
          <br />
          <em style={{ color: C.mint }}>You skip the hold.</em>
        </h1>
        <p
          style={{
            fontSize: 34,
            lineHeight: 1.4,
            color: 'rgba(237,244,235,0.78)',
            margin: '36px 0 0',
          }}
        >
          Watch an AI agent work the phone tree, wait on hold and bring back the next step.
        </p>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 22,
            marginTop: 64,
            padding: '18px 36px 18px 18px',
            borderRadius: 99,
            background: C.mint,
            color: C.brandDeep,
            fontSize: 32,
            fontWeight: 650,
            boxShadow: '0 20px 60px rgba(143,214,180,0.35)',
          }}
        >
          <span
            style={{
              width: 72,
              height: 72,
              borderRadius: 99,
              background: C.brandDeep,
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <Play size={32} color={C.mint} fill={C.mint} style={{ marginLeft: 4 }} />
          </span>
          Watch the 67-second demo
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          right: 120,
          top: 200,
          width: 640,
          padding: 40,
          borderRadius: 32,
          background: C.white,
          boxShadow: '0 40px 120px rgba(0,0,0,0.35)',
          transform: 'rotate(1.5deg)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 16px',
              borderRadius: 99,
              background: C.successSoft,
              color: C.success,
              fontSize: 20,
              fontWeight: 650,
            }}
          >
            <span style={{ width: 12, height: 12, borderRadius: 9, background: C.success }} />
            Agent on the call
          </span>
          <span style={{ fontFamily: FONT_MONO, fontSize: 26, fontWeight: 600, color: C.ink }}>
            19:12
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 30 }}>
          <span
            style={{
              width: 64,
              height: 64,
              borderRadius: 99,
              background: C.brand,
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
            }}
          >
            <Phone size={30} color={C.white} />
          </span>
          <Waveform frame={14} level={0.85} bars={30} height={64} />
        </div>
        <div
          style={{
            marginTop: 30,
            fontSize: 16,
            fontWeight: 600,
            letterSpacing: '0.12em',
            color: C.grayWarm,
          }}
        >
          PHONE TREE
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
          {path.map(({ label, Icon, ...rest }) => {
            const last = 'last' in rest;
            return (
              <span
                key={label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 18px',
                  borderRadius: 14,
                  fontSize: 22,
                  fontWeight: 600,
                  background: last ? C.brandSoft : C.canvas,
                  color: last ? C.brand : C.ink,
                }}
              >
                <Icon size={22} color={C.brand} /> {label}
                {last ? null : (
                  <ChevronRight size={20} color={C.grayWarm} style={{ marginLeft: 'auto' }} />
                )}
              </span>
            );
          })}
        </div>
        <div
          style={{
            marginTop: 22,
            padding: '18px 22px',
            borderRadius: 18,
            background: C.brandDeep,
            color: C.inkInverse,
          }}
        >
          <div style={{ fontSize: 18, color: C.mint, fontWeight: 600 }}>Next step</div>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 36, marginTop: 4 }}>
            Follow up in 10 business days
          </div>
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          right: 40,
          bottom: 30,
          fontSize: 18,
          color: 'rgba(237,244,235,0.6)',
        }}
      >
        Synthetic data · simulated call
      </div>
    </div>
  );
}
