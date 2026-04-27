import * as React from 'react';

/**
 * Stylised SVG illustrating the lifecycle of a single DentaBill call:
 *
 *   dial → IVR navigation → hold → human reach → resolution
 *
 * It is **not** a real waveform. Per DESIGN.md the design layer must
 * not reintroduce PHI that the runtime layer is at pains to redact.
 * This is a synthetic shape evoking the texture of a call timeline.
 *
 * Design notes:
 *   - Pure SVG, no canvas or animation library — pays for itself in
 *     bundle, render budget, and motion-safety.
 *   - Achromatic per ADR-013 except the `Reach` cluster which uses the
 *     muted-teal status accent (`fill-status-active`). That cluster
 *     also gets a gentle motion-safe pulse: it is the moment the
 *     product creates value, so amplifying it on the timeline matters.
 *   - A radial spotlight + a thin scanline tie the diagram to the
 *     "calls run while you sleep" narrative without leaning on
 *     glassmorphism or chromatic gradients.
 *   - Amplitudes are deterministic so SSR + client renders match and
 *     visual snapshots stay stable.
 *
 * Layout (in viewBox units, 800 × 280):
 *
 *   y=20    top edge
 *   y=140   baseline (centred so amplitudes ±48 still fit)
 *   y=232   phase labels (full 80 of clear space below the largest bar)
 *   y=260   bottom edge — leaves 20 of vertical air between the diagram
 *           and whatever the consumer renders beneath.
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

const AMPLITUDES: Record<string, readonly number[]> = {
  dial: [0.3, 0.5, 0.4, 0.6, 0.45, 0.35, 0.5, 0.4],
  ivr: [0.6, 0.3, 0.7, 0.35, 0.65, 0.3, 0.55, 0.4],
  hold: [0.18, 0.2, 0.22, 0.2, 0.18, 0.22, 0.2, 0.2],
  reach: [0.55, 0.7, 0.85, 0.95, 0.85, 0.7, 0.6, 0.5],
  resolve: [0.5, 0.45, 0.4, 0.35, 0.3, 0.28, 0.25, 0.22],
};

const VIEW_W = 800;
const VIEW_H = 280;
const BAR_W = 4;
const BAR_GAP = 6;
const BARS_PER_PHASE = 8;
const PHASE_W = BARS_PER_PHASE * (BAR_W + BAR_GAP);
const TOTAL_W = PHASE_W * PHASES.length;
const X_OFFSET = (VIEW_W - TOTAL_W) / 2;
const BASELINE_Y = 140;
const LABEL_Y = 232;
const MAX_AMP = 48;

export interface CallFlowWaveformProps {
  readonly className?: string;
}

export function CallFlowWaveform({ className }: CallFlowWaveformProps): React.ReactElement {
  const spotlightId = React.useId();
  const fadeMaskId = `${spotlightId}-fade`;
  const reachStart = X_OFFSET + 3 * PHASE_W;
  const reachEnd = X_OFFSET + 4 * PHASE_W;

  return (
    <svg
      viewBox={`0 0 ${String(VIEW_W)} ${String(VIEW_H)}`}
      role="img"
      aria-label="A diagram of a DentaBill call: dial, IVR navigation, hold, reach a human, resolve."
      preserveAspectRatio="xMidYMid meet"
      className={className}
    >
      <defs>
        <radialGradient id={spotlightId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.06" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={fadeMaskId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
          <stop offset="12%" stopColor="currentColor" stopOpacity="1" />
          <stop offset="88%" stopColor="currentColor" stopOpacity="1" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
        <mask id={`${spotlightId}-edgemask`} maskUnits="userSpaceOnUse">
          <rect
            x={X_OFFSET - 40}
            y={0}
            width={TOTAL_W + 80}
            height={VIEW_H}
            fill={`url(#${fadeMaskId})`}
          />
        </mask>
      </defs>

      <ellipse
        cx={(reachStart + reachEnd) / 2}
        cy={BASELINE_Y}
        rx={PHASE_W * 1.6}
        ry={PHASE_W * 0.55}
        fill={`url(#${spotlightId})`}
      />

      <g mask={`url(#${spotlightId}-edgemask)`}>
        <line
          x1={X_OFFSET - 32}
          x2={X_OFFSET + TOTAL_W + 32}
          y1={BASELINE_Y}
          y2={BASELINE_Y}
          stroke="currentColor"
          strokeWidth={0.75}
          opacity={0.18}
        />
        <line
          x1={X_OFFSET - 32}
          x2={X_OFFSET + TOTAL_W + 32}
          y1={BASELINE_Y - 0.5}
          y2={BASELINE_Y - 0.5}
          stroke="currentColor"
          strokeWidth={0.5}
          opacity={0.05}
        >
          <animate
            attributeName="opacity"
            values="0.04;0.16;0.04"
            dur="6s"
            repeatCount="indefinite"
          />
        </line>
      </g>

      {PHASES.map((phase, phaseIdx) => {
        const phaseStart = X_OFFSET + phaseIdx * PHASE_W;
        const amps = AMPLITUDES[phase.key] ?? [];
        return (
          <g key={phase.key}>
            {amps.map((amp, i) => {
              const x = phaseStart + i * (BAR_W + BAR_GAP) + BAR_GAP / 2;
              const h = amp * MAX_AMP;
              const baseClass = phase.accent
                ? 'fill-status-active motion-safe:[animation:status-pulse_2.6s_ease-in-out_infinite]'
                : 'fill-black opacity-70';
              return (
                <rect
                  key={`${phase.key}-${String(i)}`}
                  x={x}
                  y={BASELINE_Y - h}
                  width={BAR_W}
                  height={h * 2}
                  rx={BAR_W / 2}
                  className={baseClass}
                  style={phase.accent ? { animationDelay: `${String(i * 80)}ms` } : undefined}
                />
              );
            })}
            <text
              x={phaseStart + PHASE_W / 2}
              y={LABEL_Y}
              textAnchor="middle"
              className="font-body fill-gray-warm text-[11px] uppercase tracking-[0.18em]"
            >
              {phase.label}
            </text>
            {phase.accent ? (
              <circle
                cx={phaseStart + PHASE_W / 2}
                cy={LABEL_Y - 14}
                r={1.5}
                className="fill-status-active motion-safe:[animation:status-pulse_2.6s_ease-in-out_infinite]"
              />
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
