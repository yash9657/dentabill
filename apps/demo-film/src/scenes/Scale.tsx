import { useCurrentFrame } from 'remotion';

import { AppFrame, SyntheticBadge } from '../components/AppFrame';
import { Backdrop } from '../components/Backdrop';
import { Camera } from '../components/Camera';
import { Caption } from '../components/Caption';
import { ClaimsTable, type RowView } from '../components/ClaimsTable';
import { C, pop, ramp } from '../theme';

export const FLIPS = [0, 34, 46, 58, 70, 82] as const;

/** Every claim called in parallel; results land row by row. */
export function ScaleScene(): React.ReactElement {
  const f = useCurrentFrame();
  const rows: RowView[] = FLIPS.map((at) => ({
    enter: 1,
    state: f >= at ? 'done' : 'calling',
    flip: pop(f, at, 30, 13),
  }));
  const answered = FLIPS.filter((at) => f >= at).length;
  return (
    <>
      <Backdrop />
      <Camera
        shots={[
          { f: 0, x: 1240, y: 660, zoom: 1.5 },
          { f: 84, x: 1180, y: 650, zoom: 1.4 },
          { f: 165, x: 960, y: 570, zoom: 1.05 },
        ]}
      >
        <AppFrame active="Claims">
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: '-0.01em' }}>Claims</div>
              <div
                style={{
                  fontSize: 17,
                  color: C.grayDark,
                  marginTop: 8,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {answered} of 6 answered · {6 - answered} calls in progress
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              {['Paid 2', 'Pending 2', 'Denied 2'].map((label, i) => (
                <span
                  key={label}
                  style={{
                    padding: '9px 15px',
                    borderRadius: 10,
                    background: C.white,
                    border: `1px solid ${C.border}`,
                    fontSize: 15,
                    fontWeight: 600,
                    opacity: ramp(f, 90 + i * 5, 100 + i * 5),
                  }}
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
          <ClaimsTable rows={rows} spin={f} />
        </AppFrame>
      </Camera>
      <Caption text="Every claim, called at once." start={4} exitAt={80} accent={['at', 'once']} />
      <Caption
        text="While your team stays with patients."
        start={84}
        exitAt={160}
        accent={['patients']}
        italic={['patients']}
      />
      <SyntheticBadge />
    </>
  );
}
