import * as React from 'react';

/**
 * Stylised SVG illustrating the lifecycle of a single DentaBill call:
 *
 *   dial → IVR navigation → hold → human reach → resolution
 *
 * It is **not** a real waveform. We never render real call audio in
 * marketing; per DESIGN.md the design layer must not reintroduce PHI
 * that the runtime layer is at pains to redact. This is a synthetic
 * shape evoking the texture of a call timeline.
 *
 * Visual structure:
 *   - A horizontal baseline runs the width of the SVG.
 *   - Five amplitude clusters sit on it, each labeled by phase. Their
 *     amplitudes are deterministic (no `Math.random()`) so the SSR
 *     and client renders match and the visual snapshot is stable.
 *   - The "Reach" cluster is the single chromatic moment in the
 *     system — the muted teal status accent (ADR-013) — because that
 *     is the moment the product literally creates value: a human
 *     payer rep is on the line.
 *
 * Implementation choices that matter:
 *   - Pure SVG, no canvas or animation library. Pays for itself in
 *     bundle budget, render budget, and motion-safety.
 *   - The amplitude bars are `<rect>`s with rounded corners (`rx`)
 *     so they read as soft tick marks, not hard edges.
 *   - `aria-label` describes the diagram; the labels themselves are
 *     real `<text>` nodes inside the SVG so they're selectable and
 *     a11y tools index them.
 */
const PHASES: readonly {
  readonly key: string;
  readonly label: string;
  readonly accent: boolean;
}[] = [
  { key: 'dial', label: 'Dial', accent: false },
  { key: 'ivr', label: 'IVR', accent: false },
  { key: 'hold', label: 'Hold', accent: false },
  { key: 'reach', label: 'Reach', accent: true },
  { key: 'resolve', label: 'Resolve', accent: false },
];

/**
 * 8 deterministic amplitudes per phase, normalised 0..1. These were
 * picked by ear to read like a call rhythm: short bursts on dial, a
 * staccato run for IVR menu key presses, a long flat trough for
 * hold, a rising arc for reach, a calming decay for resolution.
 */
const AMPLITUDES: Record<string, readonly number[]> = {
  dial: [0.3, 0.5, 0.4, 0.6, 0.45, 0.35, 0.5, 0.4],
  ivr: [0.6, 0.3, 0.7, 0.35, 0.65, 0.3, 0.55, 0.4],
  hold: [0.18, 0.2, 0.22, 0.2, 0.18, 0.22, 0.2, 0.2],
  reach: [0.55, 0.7, 0.85, 0.95, 0.85, 0.7, 0.6, 0.5],
  resolve: [0.5, 0.45, 0.4, 0.35, 0.3, 0.28, 0.25, 0.22],
};

const VIEW_W = 800;
const VIEW_H = 220;
const BAR_W = 4;
const BAR_GAP = 6;
const BARS_PER_PHASE = 8;
const PHASE_W = BARS_PER_PHASE * (BAR_W + BAR_GAP);
const TOTAL_W = PHASE_W * PHASES.length;
const X_OFFSET = (VIEW_W - TOTAL_W) / 2;
const BASELINE_Y = 150;
const MAX_AMP = 100;

export interface CallFlowWaveformProps {
  readonly className?: string;
}

export function CallFlowWaveform({ className }: CallFlowWaveformProps): React.ReactElement {
  return (
    <svg
      viewBox={`0 0 ${String(VIEW_W)} ${String(VIEW_H)}`}
      role="img"
      aria-label="A diagram of a DentaBill call: dial, IVR navigation, hold, reach a human, resolve."
      preserveAspectRatio="xMidYMid meet"
      className={className}
    >
      <line
        x1={X_OFFSET}
        x2={X_OFFSET + TOTAL_W}
        y1={BASELINE_Y}
        y2={BASELINE_Y}
        stroke="currentColor"
        strokeWidth={1}
        opacity={0.18}
      />

      {PHASES.map((phase, phaseIdx) => {
        const phaseStart = X_OFFSET + phaseIdx * PHASE_W;
        const amps = AMPLITUDES[phase.key] ?? [];
        return (
          <g key={phase.key}>
            {amps.map((amp, i) => {
              const x = phaseStart + i * (BAR_W + BAR_GAP) + BAR_GAP / 2;
              const h = amp * MAX_AMP;
              return (
                <rect
                  key={`${phase.key}-${String(i)}`}
                  x={x}
                  y={BASELINE_Y - h}
                  width={BAR_W}
                  height={h * 2}
                  rx={BAR_W / 2}
                  className={
                    phase.accent
                      ? 'fill-status-active opacity-90'
                      : 'fill-black opacity-70 dark:opacity-80'
                  }
                />
              );
            })}
            <text
              x={phaseStart + PHASE_W / 2}
              y={BASELINE_Y + 38}
              textAnchor="middle"
              className="font-body fill-gray-warm text-[12px] uppercase tracking-[0.14em]"
            >
              {phase.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
