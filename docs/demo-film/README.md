# DentaBill product film

A 67-second motion-design film for the landing page, built in code with Remotion from
`apps/demo-film/`. It replaces the 2:52 narrated screen-recording walkthrough (ADR-086).

## Story (1920×1080, 30 fps, music at 120 BPM)

| Time | Beat     | On screen                                                                        |
| ---- | -------- | -------------------------------------------------------------------------------- |
| 0:00 | Hook     | “Another claim. Another payer call.” An on-hold timer races; tinny hold music.   |
| 0:04 | Brand    | Logo lands on the downbeat: “The AI agent that calls insurance for you.”         |
| 0:08 | Claims   | A CSV export is dropped in, six claims appear, one click on “Call payer”.        |
| 0:15 | The call | Phone tree path fills in, keypad tones, hold, live chat transcript with the rep. |
| 0:51 | Results  | Call results card: Pending review, next step, reference, representative.         |
| 0:55 | Scale    | All six claims called at once; results land row by row.                          |
| 1:01 | Close    | “Insurance calls, handled.” Start free · usedentabill.xyz.                       |

The screens are animated recreations of the dashboard after the call-screen redesign (outcome
card, phone tree path pills, chat-style conversation). Keep them in step with
`apps/web/src/components/dashboard/calls/` when that UI changes.

## Honesty rules

- The call reenacts `packages/payer-ivr/src/demo/local-navigation.ts` (synthetic identity
  DEMO1042, reference SIM-2026-1042); no payer is contacted. The voices are generated.
- The six results mirror `packages/payer-ivr/src/retell/demo-scenarios.ts`.
- A “Synthetic data · simulated call” badge stays on every product shot, and the end card
  carries the disclosure. Do not add statistics (hold times saved, revenue) without a source.

## Rebuild

```bash
pnpm --filter @dentabill/demo-film studio   # preview and scrub
pnpm --filter @dentabill/demo-film render   # renders, masters to -14 LUFS, writes
                                            # apps/web/public/media/dentabill-demo/{walkthrough.mp4,poster.jpg,captions.en.vtt}
```

- Timing lives in `apps/demo-film/src/timeline.ts`; scenes lay out from the measured voice
  lengths in `src/durations.json` (`pnpm --filter @dentabill/demo-film sync-durations` after
  regenerating audio).
- Audio in `apps/demo-film/public/audio/` is produced by `apps/demo-film/audio/`:
  `voices.py` (Kokoro-82M, Apache-2.0, telephone-filtered), `synth.py` (DTMF, effects and
  music, synthesized with numpy/scipy, no samples) and `check.py` (loudness, Whisper check,
  `manifest.json`).
- After a render, update `transcript.html` and the hashes in `poster.jpg.json` if the story
  changed.
- Remotion is free for individuals and companies of up to three people; a larger team needs a
  Remotion company license.
