// Copies measured clip lengths from public/audio/manifest.json into src/durations.json.
import { readFileSync, writeFileSync } from 'node:fs';

interface Entry {
  readonly file: string;
  readonly duration: number;
}
const manifest = JSON.parse(readFileSync('public/audio/manifest.json', 'utf8')) as {
  files: Entry[];
};
const wanted = JSON.parse(readFileSync('src/durations.json', 'utf8')) as Record<string, number>;
for (const key of Object.keys(wanted)) {
  const hit = manifest.files.find((e) => e.file.replace(/\.wav$/, '') === key);
  if (!hit) throw new Error(`manifest has no ${key}`);
  wanted[key] = hit.duration;
}
writeFileSync('src/durations.json', `${JSON.stringify(wanted, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(wanted)}\n`);
