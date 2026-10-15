import { FileSpreadsheet, Upload } from 'lucide-react';
import { interpolate, useCurrentFrame } from 'remotion';

import { AppFrame, SyntheticBadge } from '../components/AppFrame';
import { Backdrop } from '../components/Backdrop';
import { Camera } from '../components/Camera';
import { Caption } from '../components/Caption';
import { ClaimsTable, type RowView } from '../components/ClaimsTable';
import { Cursor } from '../components/Cursor';
import { C, easeInOut, pop, ramp } from '../theme';

/** Frame marks inside the scene, shared with the sound design. */
export const Q = {
  grab: 28,
  drop: 60,
  rows: 64,
  rowStagger: 6,
  click: 146,
  calling: 152,
  zoom: 168,
  len: 225,
} as const;
export const BUTTON = { x: 1453, y: 478 } as const;

export function QueueScene(): React.ReactElement {
  const f = useCurrentFrame();
  const enter = pop(f, 0, 30, 18);
  const rows: RowView[] = [0, 1, 2, 3, 4, 5].map((i) => ({
    enter: ramp(f, Q.rows + i * Q.rowStagger, Q.rows + i * Q.rowStagger + 12),
    state: i === 0 && f >= Q.calling ? 'calling' : 'open',
    hover: i === 0 && f >= 134 && f < Q.calling,
    pressed:
      i === 0
        ? interpolate(f, [Q.click, Q.click + 3, Q.click + 8], [1, 0.9, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          })
        : 1,
  }));

  // Cursor drags the export in, then clicks "Call payer" on the first claim.
  const cursor = [
    { f: 22, x: 1780, y: 780 },
    { f: Q.grab, x: 1780, y: 780, click: true },
    { f: Q.drop - 2, x: 1090, y: 650 },
    { f: Q.drop, x: 1090, y: 650 },
    { f: 108, x: 1150, y: 700 },
    { f: 136, x: BUTTON.x - 10, y: BUTTON.y - 6 },
    { f: Q.click, x: BUTTON.x - 10, y: BUTTON.y - 6, click: true },
  ];
  const chipPos = {
    x: interpolate(f, [Q.grab, Q.drop - 2], [1780, 1090], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: easeInOut,
    }),
    y: interpolate(f, [Q.grab, Q.drop - 2], [780, 650], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: easeInOut,
    }),
  };
  const chipIn = pop(f, 18);
  const chipGone = ramp(f, Q.drop, Q.drop + 8);
  const zone = 1 - ramp(f, Q.drop + 2, Q.drop + 14);
  const zoneFlash = interpolate(f, [Q.drop, Q.drop + 4, Q.drop + 16], [0, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const count = ramp(f, 96, 110);

  return (
    <>
      <Backdrop />
      <Camera
        shots={[
          { f: 0, x: 960, y: 560, zoom: 1.06 },
          { f: Q.drop, x: 1000, y: 600, zoom: 1.1 },
          { f: 104, x: 1040, y: 640, zoom: 1.3 },
          { f: Q.zoom, x: 1180, y: 600, zoom: 1.38 },
          { f: Q.len, x: BUTTON.x, y: BUTTON.y, zoom: 2.6 },
        ]}
      >
        <AppFrame
          active="Claims"
          style={{
            transform: `translateY(${(1 - enter) * 120}px) scale(${0.94 + enter * 0.06}) perspective(1600px) rotateX(${(1 - enter) * 14}deg)`,
            opacity: Math.min(1, enter * 1.5),
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: '-0.01em' }}>Claims</div>
              <div
                style={{
                  fontSize: 17,
                  color: C.grayDark,
                  marginTop: 8,
                  opacity: count,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                6 open claims · $3,122 outstanding
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '12px 18px',
                borderRadius: 10,
                background: C.white,
                border: `1px solid ${C.border}`,
                fontSize: 16,
                fontWeight: 600,
                color: C.ink,
              }}
            >
              <Upload size={18} /> Import CSV
            </div>
          </div>
          {zone > 0 ? (
            <div
              style={{
                position: 'absolute',
                left: 48,
                right: 48,
                top: 150,
                height: 520,
                borderRadius: 18,
                border: `2.5px dashed ${zoneFlash > 0 || f > Q.grab + 6 ? C.brand : C.border}`,
                background: `rgba(229,238,231,${0.35 + zoneFlash * 0.6})`,
                display: 'grid',
                placeItems: 'center',
                opacity: zone,
                transform: `scale(${1 + zoneFlash * 0.015})`,
              }}
            >
              <div style={{ textAlign: 'center', color: C.grayDark }}>
                <Upload size={44} color={C.brand} />
                <div style={{ fontSize: 24, fontWeight: 600, color: C.ink, marginTop: 14 }}>
                  Drop your open-claims export
                </div>
                <div style={{ fontSize: 17, marginTop: 8 }}>
                  CSV from Dentrix, Eaglesoft, or Open Dental
                </div>
              </div>
            </div>
          ) : null}
          <ClaimsTable rows={rows} spin={f} />
        </AppFrame>
        {f >= 18 && chipGone < 1 ? (
          <div
            style={{
              position: 'absolute',
              left: chipPos.x - 40,
              top: chipPos.y - 30,
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '16px 22px',
              borderRadius: 14,
              background: C.white,
              boxShadow: '0 24px 50px -12px rgba(20,52,42,0.35)',
              border: `1px solid ${C.borderSubtle}`,
              fontFamily: 'Inter',
              transform: `scale(${chipIn * (1 - chipGone * 0.6)}) rotate(${f < Q.drop ? -4 : 0}deg)`,
              opacity: 1 - chipGone,
              zIndex: 45,
            }}
          >
            <FileSpreadsheet size={34} color={C.success} />
            <div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>open-claims.csv</div>
              <div style={{ fontSize: 14, color: C.grayWarm }}>6 claims · Dentrix export</div>
            </div>
          </div>
        ) : null}
        <Cursor frame={f} keys={cursor} visibleFrom={22} visibleTo={Q.len - 20} />
      </Camera>
      <Caption
        text="Drop in your open claims."
        start={4}
        exitAt={100}
        accent={['open', 'claims']}
      />
      <Caption
        text="One click, and DentaBill makes the call."
        start={106}
        exitAt={Q.len - 10}
        accent={['DentaBill']}
      />
      <SyntheticBadge opacity={ramp(f, 10, 20)} />
    </>
  );
}
