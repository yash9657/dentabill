import {
  AbsoluteFill,
  Html5Audio,
  getInputProps,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
} from 'remotion';

import { Fonts } from './components/Fonts';
import { CallScene, SUMMARY_AT } from './scenes/Call';
import { EndScene } from './scenes/End';
import { HookScene } from './scenes/Hook';
import { LogoScene } from './scenes/Logo';
import { Q, QueueScene } from './scenes/Queue';
import { FLIPS, ScaleScene } from './scenes/Scale';
import { s } from './theme';
import { CALL, cue, T } from './timeline';

const a = (name: string): string => staticFile(`audio/${name}.wav`);

/** Per-line gain that brings every voice to the quietest line's loudness (-21.5 LUFS). */
const VOICE_GAIN: Record<string, number> = {
  voice_agent2: 0.822,
  voice_agent3: 0.617,
  voice_ivr1: 0.617,
  voice_ivr2: 0.562,
  voice_ivr3: 0.716,
  voice_ivr5: 0.596,
  voice_rep1: 0.708,
  voice_rep2: 1.0,
};
/** Music and effects sit under the voices; the master is loudness-normalised after render. */
const BED = 0.6;

/** One-shot sound at an absolute frame. */
function Sfx({
  at,
  name,
  volume = 1,
}: {
  readonly at: number;
  readonly name: string;
  readonly volume?: number;
}): React.ReactElement {
  return (
    <Sequence from={Math.max(0, at)} layout="none" name={name}>
      <Html5Audio src={a(name)} volume={volume} />
    </Sequence>
  );
}

/** Looping bed between two absolute frames with fades. */
function Bed({
  from,
  to,
  name,
  volume,
  fadeIn = 6,
  fadeOut = 15,
}: {
  readonly from: number;
  readonly to: number;
  readonly name: string;
  readonly volume: number;
  readonly fadeIn?: number;
  readonly fadeOut?: number;
}): React.ReactElement {
  const len = to - from;
  return (
    <Sequence from={from} durationInFrames={len} layout="none" name={name}>
      <Html5Audio
        src={a(name)}
        loop
        volume={(f) =>
          volume *
          interpolate(f, [0, fadeIn, len - fadeOut, len], [0, 1, 1, 0], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          })
        }
      />
    </Sequence>
  );
}

function Soundtrack(): React.ReactElement {
  const callAt = (sec: number): number => T.call + s(sec);
  const hold = cue('hold');
  return (
    <>
      {/* Hook: tinny hold music under a riser into the downbeat. */}
      <Bed from={0} to={T.logo} name="muzak_hold" volume={BED * 0.75} fadeIn={2} fadeOut={4} />
      <Sfx at={0} name="riser" volume={BED * 0.45} />
      <Sfx at={T.logo} name="impact" volume={BED * 0.9} />
      <Sfx at={T.logo + 2} name="swoosh_logo" volume={BED * 0.5} />
      <Bed
        from={T.logo}
        to={T.call + 20}
        name="bed_full"
        volume={BED * 0.95}
        fadeIn={1}
        fadeOut={30}
      />

      {/* Queue. */}
      <Sfx at={T.queue} name="whoosh_in" volume={BED * 0.45} />
      <Sfx at={T.queue + Q.grab} name="click" volume={BED * 0.6} />
      <Sfx at={T.queue + Q.drop} name="drop" volume={BED * 0.75} />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Sfx key={i} at={T.queue + Q.rows + i * Q.rowStagger} name="tick" volume={BED * 0.35} />
      ))}
      <Sfx at={T.queue + Q.click} name="click" volume={BED * 0.8} />
      <Sfx at={T.queue + Q.zoom + 12} name="whoosh_in" volume={BED * 0.6} />

      {/* Call: soft bed under the conversation. */}
      <Bed from={T.call} to={T.scale} name="bed_soft" volume={BED * 0.9} fadeIn={20} fadeOut={20} />
      {CALL.map((c) => {
        if (c.kind === 'voice')
          return (
            <Sfx
              key={c.id}
              at={callAt(c.at)}
              name={`voice_${c.id}`}
              volume={VOICE_GAIN[`voice_${c.id}`] ?? 1}
            />
          );
        if (c.kind === 'dtmf')
          return <Sfx key={c.id} at={callAt(c.at)} name={c.id} volume={BED * 0.55} />;
        if (c.kind === 'ring')
          return <Sfx key={c.id} at={callAt(c.at)} name="ring" volume={BED * 0.5} />;
        return null;
      })}
      <Sfx at={callAt(hold.at)} name="fast_forward" volume={BED * 0.5} />
      <Bed
        from={callAt(hold.at)}
        to={callAt(hold.at + hold.len)}
        name="muzak_hold"
        volume={BED * 0.4}
        fadeIn={4}
        fadeOut={8}
      />
      <Sfx at={T.call + SUMMARY_AT} name="success" volume={BED * 0.7} />

      {/* Scale: the drop returns. */}
      <Sfx at={T.scale - 4} name="whoosh_out" volume={BED * 0.45} />
      <Sfx at={T.scale} name="impact" volume={BED * 0.7} />
      <Bed
        from={T.scale}
        to={T.end + 24}
        name="bed_full"
        volume={BED * 0.95}
        fadeIn={1}
        fadeOut={30}
      />
      {FLIPS.slice(1).map((at) => (
        <Sfx key={at} at={T.scale + at} name="pop" volume={BED * 0.5} />
      ))}

      {/* End. */}
      <Sfx at={T.end} name="end_sting" volume={BED * 0.85} />
      <Sfx at={T.end + 2} name="swoosh_logo" volume={BED * 0.4} />
    </>
  );
}

/** Each scene overlaps the previous one by `fade` frames and dissolves in over it. */
function Scene({
  from,
  to,
  children,
  fade = 8,
  fadeIn = true,
}: {
  readonly from: number;
  readonly to: number;
  readonly children: React.ReactNode;
  readonly fade?: number;
  readonly fadeIn?: boolean;
}): React.ReactElement {
  return (
    <Sequence from={from} durationInFrames={to - from + fade}>
      <Dissolve fade={fadeIn ? fade : 0}>{children}</Dissolve>
    </Sequence>
  );
}

function Dissolve({
  children,
  fade,
}: {
  readonly children: React.ReactNode;
  readonly fade: number;
}): React.ReactElement {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        opacity: fade === 0 ? 1 : interpolate(f, [0, fade], [0, 1], { extrapolateRight: 'clamp' }),
      }}
    >
      {children}
    </AbsoluteFill>
  );
}

export function Film(): React.ReactElement {
  return (
    <AbsoluteFill style={{ background: '#faf8f1' }}>
      <Fonts />
      <Scene from={T.hook} to={T.logo} fadeIn={false}>
        <HookScene />
      </Scene>
      <Scene from={T.logo} to={T.queue}>
        <LogoScene />
      </Scene>
      <Scene from={T.queue} to={T.call}>
        <QueueScene />
      </Scene>
      <Scene from={T.call} to={T.scale}>
        <CallScene />
      </Scene>
      <Scene from={T.scale} to={T.end}>
        <ScaleScene />
      </Scene>
      <Scene from={T.end} to={T.total}>
        <EndScene />
      </Scene>
      {getInputProps().silent ? null : <Soundtrack />}
    </AbsoluteFill>
  );
}
