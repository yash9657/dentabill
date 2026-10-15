import { C } from '../theme';

/** Bars that move only while someone is speaking (level 0..1). */
export function Waveform({
  frame,
  level,
  bars = 28,
  height = 56,
  color = C.brand,
}: {
  readonly frame: number;
  readonly level: number;
  readonly bars?: number;
  readonly height?: number;
  readonly color?: string;
}): React.ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, height }}>
      {Array.from({ length: bars }, (_, i) => {
        const wobble =
          (Math.sin(frame * 0.55 + i * 1.7) + Math.sin(frame * 0.31 + i * 0.9) + 2) / 4;
        const envelope = Math.sin((Math.PI * (i + 0.5)) / bars);
        const h = 4 + (height - 4) * level * wobble * (0.35 + 0.65 * envelope);
        return (
          <span
            key={i}
            style={{
              width: 5,
              height: h,
              borderRadius: 4,
              background: color,
              opacity: 0.35 + 0.65 * level,
            }}
          />
        );
      })}
    </div>
  );
}
