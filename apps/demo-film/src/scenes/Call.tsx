import {
  Check,
  ChevronRight,
  Clock3,
  Copy,
  Grid3x3,
  Hash,
  Hourglass,
  Phone,
  UserRound,
} from 'lucide-react';
import { interpolate, useCurrentFrame } from 'remotion';

import { AppFrame, MAIN, SyntheticBadge } from '../components/AppFrame';
import { Backdrop } from '../components/Backdrop';
import { Camera } from '../components/Camera';
import { Caption, TopVeil } from '../components/Caption';
import { Waveform } from '../components/Waveform';
import { C, FONT_DISPLAY, FONT_MONO, pop, ramp, s } from '../theme';
import { CALL, cue, T } from '../timeline';

/** Frames relative to the start of the call scene. */
const F = (id: string, offset = 0): number => s(cue(id).at + offset);
const END = (id: string): number => s(cue(id).at + cue(id).len);
const CALL_END = END('agent3');
export const SUMMARY_AT = CALL_END + 12;
const HOLD_SECONDS = 18 * 60 + 37;

/** Layout, relative to the main content area. */
const L = { treeTop: 142, lowTop: 250, lowH: 456, chatW: 690, gap: 22 } as const;
const panelX = L.chatW + L.gap;
const panelW = 1172 - panelX;
/** Panel coordinates are measured from the main area's top edge, above its 40px padding. */
const world = (x: number, y: number): { x: number; y: number } => ({
  x: MAIN.x + x,
  y: MAIN.y - 40 + y,
});

function speaking(f: number): number {
  for (const c of CALL) {
    if (c.kind === 'voice' || c.kind === 'dtmf') {
      const a = s(c.at);
      const b = s(c.at + c.len);
      if (f >= a - 2 && f <= b + 2) return ramp(f, a - 2, a + 3) * (1 - ramp(f, b - 3, b + 2));
    }
  }
  return 0;
}

/** Elapsed call clock; jumps across the hold the way the call itself did. */
function elapsed(f: number): number {
  const hold = cue('hold');
  const jump = interpolate(f, [s(hold.at), s(hold.at + hold.len)], [0, HOLD_SECONDS], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return Math.min(f, CALL_END) / 30 + jump;
}
const mmss = (sec: number): string =>
  `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

// ---------- Phone tree (mirrors the app's path pills) ----------

interface Step {
  readonly label: string;
  readonly at: number;
  readonly Icon: typeof Hash;
  readonly last?: boolean;
}

const steps = (): Step[] => [
  { label: 'Main menu · pressed 2', at: F('dtmf_2'), Icon: Grid3x3 },
  { label: 'Claim status · pressed 1', at: F('dtmf_1'), Icon: Grid3x3 },
  { label: 'Gave provider NPI', at: END('dtmf_npi'), Icon: Hash },
  { label: 'On hold · 18 min', at: END('hold'), Icon: Hourglass },
  { label: 'Reached Marcus', at: F('rep1', 0.5), Icon: UserRound, last: true },
];

function PhoneTree({ f }: { readonly f: number }): React.ReactElement {
  const shown = steps().filter((step) => f >= step.at - 2);
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: L.treeTop }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
        <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: '0.12em', color: C.grayWarm }}>
          PHONE TREE
        </span>
        <span style={{ fontSize: 14, color: C.grayWarm }}>From the call transcript</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, height: 52 }}>
        {shown.length === 0 ? (
          <span style={{ fontSize: 17, color: C.grayWarm, opacity: 0.5 + 0.5 * Math.sin(f * 0.2) }}>
            Listening to the phone menu…
          </span>
        ) : null}
        {shown.map((step, i) => {
          const p = pop(f, step.at, 30, 12);
          const Icon = step.Icon;
          return (
            <div
              key={step.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                opacity: Math.min(1, p * 1.4),
                transform: `scale(${0.7 + p * 0.3})`,
                transformOrigin: '0 50%',
              }}
            >
              {i > 0 ? <ChevronRight size={18} color={C.grayWarm} /> : null}
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 9,
                  padding: '10px 18px',
                  borderRadius: 99,
                  fontSize: 18,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  background: step.last ? C.brandSoft : C.white,
                  color: step.last ? C.brand : C.ink,
                  border: `1px solid ${step.last ? C.brandSoft : C.border}`,
                  boxShadow: `0 0 0 ${(1 - Math.min(1, p)) * 10}px rgba(33,78,64,0.15)`,
                }}
              >
                <Icon size={18} color={C.brand} /> {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Conversation ----------

type Item =
  | { kind: 'ivr' | 'agent' | 'rep'; text: string; at: number; len: number }
  | { kind: 'action'; text: string; at: number; len: number };

function items(): Item[] {
  const out: Item[] = [];
  for (const c of CALL) {
    if (c.kind === 'voice' && c.speaker && c.text)
      out.push({ kind: c.speaker, text: c.text, at: s(c.at), len: s(c.len) });
    if (c.kind === 'dtmf') {
      const text =
        c.digits && c.digits.length > 1 ? 'Entered NPI ••••••7893' : `Pressed ${c.digits ?? ''}`;
      out.push({ kind: 'action', text, at: s(c.at), len: s(c.len) });
    }
    if (c.kind === 'hold')
      out.push({ kind: 'action', text: 'On hold', at: s(c.at), len: s(c.len) });
  }
  return out;
}

function streamed(text: string, f: number, at: number, len: number): string {
  const words = text.split(' ');
  const shown = Math.ceil(
    interpolate(f, [at, at + Math.max(len, 1)], [1, words.length], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );
  return words.slice(0, shown).join(' ');
}

function Bubble({ item, f }: { readonly item: Item; readonly f: number }): React.ReactElement {
  const p = pop(f, item.at, 30, 16);
  const wrap: React.CSSProperties = {
    maxHeight: p * 220,
    opacity: Math.min(1, p * 1.3),
    transform: `translateY(${(1 - p) * 14}px) scale(${0.96 + p * 0.04})`,
    display: 'flex',
    paddingTop: 12 * p,
    transformOrigin: item.kind === 'agent' || item.kind === 'action' ? '100% 100%' : '0% 100%',
  };
  const text = streamed(item.text, f, item.at, item.len);
  if (item.kind === 'ivr') {
    return (
      <div style={{ ...wrap, justifyContent: 'center' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            maxWidth: 560,
            padding: '8px 14px',
            borderRadius: 10,
            background: C.canvas,
            border: `1px solid ${C.borderSubtle}`,
            color: C.grayDark,
            fontSize: 15,
          }}
        >
          <Phone size={15} style={{ flexShrink: 0 }} />{' '}
          <span>
            <b style={{ fontWeight: 600 }}>Phone menu</b> · {text}
          </span>
        </div>
      </div>
    );
  }
  if (item.kind === 'action') {
    const hold = item.text === 'On hold';
    const label = hold
      ? `On hold · ${mmss(Math.max(0, elapsed(Math.min(f, item.at + item.len)) - elapsed(item.at)))}`
      : item.text;
    return (
      <div style={{ ...wrap, justifyContent: 'flex-end' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 13px',
            borderRadius: 99,
            border: `1.5px solid ${C.brand}`,
            color: C.brand,
            fontSize: 15,
            fontWeight: 600,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {hold ? <Clock3 size={15} /> : <Hash size={15} />} {label}
        </div>
      </div>
    );
  }
  const agent = item.kind === 'agent';
  return (
    <div
      style={{
        ...wrap,
        justifyContent: agent ? 'flex-end' : 'flex-start',
        gap: 10,
        alignItems: 'flex-end',
      }}
    >
      {!agent ? (
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 99,
            background: '#e9e4f5',
            color: '#5b4a8a',
            display: 'grid',
            placeItems: 'center',
            fontWeight: 700,
            fontSize: 15,
            flexShrink: 0,
          }}
        >
          M
        </div>
      ) : null}
      <div
        style={{
          maxWidth: 470,
          padding: '12px 16px',
          borderRadius: 18,
          borderBottomRightRadius: agent ? 6 : 18,
          borderBottomLeftRadius: agent ? 18 : 6,
          background: agent ? C.brand : '#f2f4f0',
          color: agent ? C.white : C.ink,
          border: 'none',
          fontSize: 17,
          lineHeight: 1.45,
          boxShadow: '0 6px 16px -10px rgba(20,52,42,0.35)',
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, opacity: 0.75, marginBottom: 3 }}>
          {agent ? 'DentaBill agent' : 'Marcus · Delta Dental'}
        </div>
        {text}
      </div>
    </div>
  );
}

function Conversation({ f }: { readonly f: number }): React.ReactElement {
  const list = items().filter((item) => f >= item.at);
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: L.lowTop,
        width: L.chatW,
        height: L.lowH,
        background: C.white,
        borderRadius: 18,
        border: `1px solid ${C.borderSubtle}`,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 24,
          top: 18,
          fontSize: 18,
          fontWeight: 600,
          zIndex: 2,
        }}
      >
        Conversation
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: 70,
          background: `linear-gradient(${C.white} 70%, rgba(255,255,255,0))`,
          zIndex: 1,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 22,
          right: 22,
          bottom: 20,
          top: 56,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
        }}
      >
        {list.map((item) => (
          <Bubble key={`${item.kind}-${item.at}`} item={item} f={f} />
        ))}
      </div>
    </div>
  );
}

// ---------- Right panel: live status, then the summary ----------

function LivePanel({ f }: { readonly f: number }): React.ReactElement {
  const holdStart = F('hold');
  const holdEnd = END('hold');
  const onHold = f >= holdStart && f < holdEnd;
  const withRep = f >= F('rep1');
  const title = onHold ? 'On hold' : withRep ? 'Speaking with Marcus' : 'Navigating phone tree';
  const holdClock = mmss(Math.max(0, elapsed(f) - elapsed(holdStart)));
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        padding: 28,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontSize: 15,
          fontWeight: 600,
          color: C.danger,
        }}
      >
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: 9,
            background: C.danger,
            opacity: 0.5 + 0.5 * Math.sin(f * 0.2),
          }}
        />{' '}
        Live
        <span style={{ marginLeft: 'auto', color: C.grayDark, fontVariantNumeric: 'tabular-nums' }}>
          {mmss(elapsed(f))}
        </span>
      </div>
      <div
        style={{ fontFamily: FONT_DISPLAY, fontSize: 36, marginTop: 34, letterSpacing: '-0.02em' }}
      >
        {title}
      </div>
      <div style={{ fontSize: 16, color: C.grayDark, marginTop: 8 }}>
        {onHold
          ? 'DentaBill waits, so your team doesn’t.'
          : withRep
            ? 'Delta Dental · provider services'
            : 'Delta Dental PPO · automated menu'}
      </div>
      <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'center' }}>
        {onHold ? (
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 84,
              fontWeight: 600,
              color: C.brand,
              letterSpacing: '-0.04em',
              fontVariantNumeric: 'tabular-nums',
              filter: `blur(${interpolate(f, [holdStart, holdStart + 10, holdEnd - 10, holdEnd], [0, 1.2, 1.2, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}px)`,
            }}
          >
            {holdClock}
          </div>
        ) : (
          <Waveform frame={f} level={speaking(f)} bars={30} height={110} />
        )}
      </div>
    </div>
  );
}

function SummaryPanel({ f }: { readonly f: number }): React.ReactElement {
  const r = (k: number): number => pop(f, SUMMARY_AT + k, 30, 16);
  const line = (k: number): React.CSSProperties => ({
    opacity: Math.min(1, r(k) * 1.3),
    transform: `translateY(${(1 - r(k)) * 16}px)`,
  });
  const ref = 'SIM-2026-1042';
  const typed = ref.slice(
    0,
    Math.round(
      interpolate(f, [SUMMARY_AT + 14, SUMMARY_AT + 30], [0, ref.length], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      }),
    ),
  );
  const holdMin = Math.floor(HOLD_SECONDS / 60);
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        padding: 28,
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
      }}
    >
      <div
        style={{
          ...line(0),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: '0.12em', color: C.grayWarm }}>
          CALL RESULTS
        </span>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 13px',
            borderRadius: 99,
            background: C.warningSoft,
            color: C.warning,
            fontSize: 15,
            fontWeight: 700,
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: 9, background: C.warning }} /> Pending
          review
        </span>
      </div>
      <div style={{ ...line(5), background: C.brandSoft, borderRadius: 14, padding: '16px 18px' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.brand }}>Next step</div>
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 31,
            lineHeight: 1.12,
            marginTop: 6,
            letterSpacing: '-0.015em',
          }}
        >
          Follow up in 10 business days
        </div>
        <div style={{ fontSize: 15, color: C.grayDark, marginTop: 6 }}>Reminder set for Oct 28</div>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          rowGap: 14,
          columnGap: 18,
          fontSize: 16,
        }}
      >
        <div style={line(10)}>
          <div style={{ fontSize: 13.5, color: C.grayWarm }}>Reference</div>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontWeight: 600,
              marginTop: 3,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            {typed}
            <Copy size={14} color={C.grayWarm} />
          </div>
        </div>
        <div style={line(14)}>
          <div style={{ fontSize: 13.5, color: C.grayWarm }}>Representative</div>
          <div style={{ fontWeight: 600, marginTop: 3 }}>Marcus</div>
        </div>
        <div style={line(18)}>
          <div style={{ fontSize: 13.5, color: C.grayWarm }}>Hold time</div>
          <div style={{ fontWeight: 600, marginTop: 3 }}>{holdMin} min</div>
        </div>
        <div style={line(22)}>
          <div style={{ fontSize: 13.5, color: C.grayWarm }}>Call duration</div>
          <div style={{ fontWeight: 600, marginTop: 3 }}>
            {Math.floor(elapsed(CALL_END) / 60)}m {Math.floor(elapsed(CALL_END) % 60)}s
          </div>
        </div>
      </div>
    </div>
  );
}

function RightPanel({ f }: { readonly f: number }): React.ReactElement {
  const swap = ramp(f, SUMMARY_AT - 8, SUMMARY_AT);
  const glow = interpolate(f, [SUMMARY_AT, SUMMARY_AT + 10, SUMMARY_AT + 40], [0, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <div
      style={{
        position: 'absolute',
        left: panelX,
        top: L.lowTop,
        width: panelW,
        height: L.lowH,
        background: C.white,
        borderRadius: 18,
        border: `1px solid ${glow > 0 ? C.brand : C.borderSubtle}`,
        boxShadow: `0 0 0 ${glow * 8}px rgba(33,78,64,${glow * 0.15})`,
        overflow: 'hidden',
      }}
    >
      {swap < 1 ? (
        <div style={{ position: 'absolute', inset: 0, opacity: 1 - swap }}>
          <LivePanel f={f} />
        </div>
      ) : null}
      {f >= SUMMARY_AT - 2 ? <SummaryPanel f={f} /> : null}
    </div>
  );
}

// ---------- Scene ----------

export function CallScene(): React.ReactElement {
  const f = useCurrentFrame();
  const done = f >= CALL_END;
  const outLen = T.scale - T.call;
  const tree = world(470, L.treeTop + 40);
  const chat = world(L.chatW / 2, L.lowTop + L.lowH / 2 + 20);
  const panel = world(panelX + panelW / 2, L.lowTop + L.lowH / 2);
  const intro = 1 - ramp(f, 0, 14);
  return (
    <>
      <Backdrop />
      <Camera
        shots={[
          { f: 0, x: 960, y: 560, zoom: 1.08 },
          { f: Math.max(16, F('ivr1') - 4), x: 960, y: 560, zoom: 1 },
          { f: F('ivr1') + 18, x: tree.x, y: tree.y + 40, zoom: 1.45 },
          { f: END('dtmf_npi'), x: tree.x, y: tree.y + 40, zoom: 1.45 },
          { f: F('ivr5') + 10, x: 960, y: 640, zoom: 1.22 },
          { f: F('hold'), x: 960, y: 640, zoom: 1.22 },
          { f: F('hold') + 14, x: panel.x - 60, y: panel.y, zoom: 1.5 },
          { f: F('rep1') - 4, x: panel.x - 60, y: panel.y, zoom: 1.5 },
          { f: F('rep1') + 14, x: chat.x + 80, y: chat.y, zoom: 1.42 },
          { f: CALL_END, x: chat.x + 80, y: chat.y, zoom: 1.42 },
          { f: SUMMARY_AT + 4, x: panel.x, y: panel.y - 40, zoom: 1.6 },
          { f: outLen - 26, x: panel.x, y: panel.y - 40, zoom: 1.66 },
          { f: outLen, x: 960, y: 560, zoom: 1 },
        ]}
      >
        <AppFrame active="Calls">
          <div
            style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}
          >
            <div>
              <div style={{ fontSize: 15, color: C.grayWarm }}>← All calls</div>
              <div
                style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.01em', marginTop: 6 }}
              >
                Call to Delta Dental PPO
              </div>
              <div style={{ fontSize: 16, color: C.grayDark, marginTop: 6 }}>
                Rosa Alvarez · Crown (D2740) · Sep 18 · Subscriber DEMO1042
              </div>
            </div>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 9,
                marginTop: 26,
                padding: '8px 15px',
                borderRadius: 99,
                background: done ? C.successSoft : C.dangerSoft,
                color: done ? C.success : C.danger,
                fontSize: 15,
                fontWeight: 700,
              }}
            >
              {done ? (
                <Check size={16} strokeWidth={3} />
              ) : (
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 9,
                    background: C.danger,
                    opacity: 0.5 + 0.5 * Math.sin(f * 0.2),
                  }}
                />
              )}
              {done ? 'Call complete' : 'Live call'}
            </div>
          </div>
          <div style={{ position: 'absolute', left: 48, right: 48, top: 0, bottom: 0 }}>
            <PhoneTree f={f} />
            <Conversation f={f} />
            <RightPanel f={f} />
          </div>
        </AppFrame>
      </Camera>
      <TopVeil />
      <Caption
        text="It navigates the phone tree."
        start={F('ivr1') - 6}
        exitAt={F('ivr5') - 4}
        accent={['phone', 'tree']}
      />
      <Caption
        text="Waits on hold, so you don’t."
        start={F('ivr5') + 2}
        exitAt={F('rep1') - 6}
        accent={['you', 'don’t']}
        italic={['you']}
      />
      <Caption
        text="Then talks to the rep."
        start={F('rep1')}
        exitAt={CALL_END + 2}
        accent={['rep']}
      />
      <Caption
        text="You get the answer, and the next step."
        start={CALL_END + 8}
        exitAt={outLen - 12}
        accent={['next', 'step']}
      />
      <SyntheticBadge />
      {intro > 0 ? (
        <div
          style={{ position: 'absolute', inset: 0, background: C.white, opacity: intro * 0.9 }}
        />
      ) : null}
    </>
  );
}
