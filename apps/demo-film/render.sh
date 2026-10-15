#!/usr/bin/env bash
# Renders the film, masters audio to -14 LUFS, and writes the landing-page assets.
set -euo pipefail
cd "$(dirname "$0")"
dest=../web/public/media/dentabill-demo
mkdir -p out
npx remotion render src/index.ts DemoFilm out/raw.mp4 --codec h264 --crf 18 --pixel-format yuv420p --color-space bt709 --audio-bitrate 320k
measured=$(ffmpeg -nostats -i out/raw.mp4 -af loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 |
  sed -n '/^{/,/^}/p' |
  python3 -c "import json,sys; d=json.load(sys.stdin); print(f\"measured_I={d['input_i']}:measured_TP={d['input_tp']}:measured_LRA={d['input_lra']}:measured_thresh={d['input_thresh']}:offset={d['target_offset']}\")")
ffmpeg -v error -y -i out/raw.mp4 -c:v copy -af "loudnorm=I=-14:TP=-1.5:LRA=11:${measured}:linear=true,aresample=48000" \
  -c:a aac -b:a 192k -movflags +faststart "$dest/walkthrough.mp4"
# Poster: the call results card.
npx remotion still src/index.ts DemoFilm out/poster.png --frame "$(npx tsx -e "import { T } from './src/timeline'; console.log(T.outcome + 60)" 2>/dev/null || echo 1500)"
ffmpeg -v error -y -i out/poster.png -vf scale=1600:-1 -q:v 3 "$dest/poster.jpg"
npx tsx captions.ts > "$dest/captions.en.vtt"
echo "Wrote $dest/{walkthrough.mp4,poster.jpg,captions.en.vtt}"
