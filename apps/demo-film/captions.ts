// Writes the spoken lines as WebVTT captions: `pnpm exec tsx captions.ts > out/captions.en.vtt`.
import { CALL, T } from './src/timeline';

const FPS = 30;
const stamp = (frames: number): string => {
  const ms = Math.round((frames / FPS) * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const sec = ((ms % 60_000) / 1000).toFixed(3).padStart(6, '0');
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${sec}`;
};
const who = { ivr: 'Phone menu', agent: 'DentaBill agent', rep: 'Marcus (payer rep)' } as const;

const cues: string[] = [];
for (const c of CALL) {
  const from = T.call + Math.round(c.at * FPS);
  const to = T.call + Math.round((c.at + c.len) * FPS);
  if (c.kind === 'voice' && c.speaker)
    cues.push(`${stamp(from)} --> ${stamp(to)}\n<v ${who[c.speaker]}>${c.text}`);
  if (c.kind === 'dtmf')
    cues.push(
      `${stamp(from)} --> ${stamp(to + 6)}\n[keypad tones: ${c.digits && c.digits.length > 1 ? 'NPI entered' : c.digits}]`,
    );
  if (c.kind === 'hold') cues.push(`${stamp(from)} --> ${stamp(to)}\n[hold music]`);
}
process.stdout.write(`WEBVTT\n\n${cues.join('\n\n')}\n`);
