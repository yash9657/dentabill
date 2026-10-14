# DentaBill product film

ADR-086 turns the actual Clerk-authenticated synthetic rehearsal from ADR-085 into a narrated
171.6-second (about 2:52) walkthrough. The finished assets live in
`apps/web/public/media/dentabill-demo/`: `walkthrough.mp4`, `poster.jpg`, `captions.en.vtt`,
`transcript.html` and `transcript.css`. Its `fonts/` directory contains self-hosted Inter and
Newsreader WOFF2 files with `inter-OFL.txt` and `newsreader-OFL.txt`; the transcript makes no
runtime external font request. Preserve those notices when distributing the font files.
This is local delivery, not a production publication.

## Production record

- `script.json`: the ten chapter titles and narration.
- `edit.json`: raw recording in/out selections, crops and reading holds.
- `production.json`: final media properties/hashes, chapter timing, local narration provenance,
  model/source links and Apache-2.0 model license, original music and verification details.

The film is 1600×1000 at 25fps, H.264/AAC stereo 48 kHz, 16,827,456 bytes. Kokoro 0.9.4 with
`af_heart` produced the narration locally; independent local Whisper base.en transcription checked
all ten chapters without material omissions. Music is original synthesized arpeggios. The edit
uses short crossfades, restrained crops/push-ins and two reading holds. The 43 English caption
cues use browser-native automatic placement with no overlapping cues. The ten-chapter transcript
includes narration and important visual information.

## Editing handoff

Local source files are preserved in gitignored `.impeccable/review/demo-film-source/`: the raw
screen recording under `recordings/`, and chapter WAVs, graphics, `render.py`, `graphics.cjs`,
`narrate.py` and timing metadata under `film/`. Authentication metadata and caches are excluded.
These files are a local editing archive, not part of a fresh checkout. Inspect the recipe's local
paths and tool/model requirements before rerendering; it is not a portable one-command build.

Keep script, cuts, narration, captions and descriptive transcript aligned when editing. Preserve
the synthetic disclosure and separate the simulated call from imported financial evidence.
Pending/manual review, unverified bank/PMS evidence and correction/release history must remain
clear. Do not imply real payer contact, actual DTMF, live provider inference, settlement, external
financial writes or recovered revenue. Local TTS/Whisper production is separate from the app's
simulated payer analysis.

After an edit, refresh the poster and all affected transcript/caption content, then recompute
`production.json` hashes after formatting. Recheck playback, caption timing/placement, mobile
legibility, transcript accessibility, byte-range delivery and no MP4 request before play. The
landing player intentionally uses native controls, no autoplay/loop, `preload="none"`, inline
playback and transcript/download alternatives.

## Verification record

ADR-086 has 22 passing tests across four files, 10 passing affected lint/type checks and a passing
isolated Next production build. Actual Chrome landing/transcript QA at 1440px/390px found no
overflow, page errors or axe violations. Play, seek, fullscreen, download, 43 caption cues,
HTTP 206 byte ranges and no MP4 requests before play are verified. Full MP4 decode passes, and
all narration words match the ordered, nonoverlapping, in-bounds captions after normalization.

The fresh finish review requested Inter/Newsreader instead of system-ui and removal of the
transcript's decorative eyebrow. Both were fixed together. Updated 1440px/390px captures confirm
both fonts load, no eyebrow remains, and there is no overflow or axe violation. The reviewer
returned SHIP for these two fixes with no visible fix-batch regression; this is not independent
whole-surface, audio or motion approval. The owned review servers on ports 4485/4487 are stopped
and the private runtime is removed. The detector attempt failed with permission denied (exit 126),
so there is no automated detector verdict. ADR-085's 205 tests are separate evidence.
