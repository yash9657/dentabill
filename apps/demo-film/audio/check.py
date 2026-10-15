"""Measure every file in public/audio, whisper-check voices, write manifest.json.

Usage: python check.py [spectrogram_dir]   (needs ffmpeg + mlx_whisper)
"""
import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy.io import wavfile

FILM = Path(__file__).resolve().parent.parent
AUD = FILM / 'public' / 'audio'
LOOPS = {'muzak_hold', 'bed_full', 'bed_soft'}
script = json.loads((FILM / 'script.json').read_text())
lines = {l['id']: l for l in script['lines']}


def ebur(path, loop):
    src = ['-stream_loop', '1'] if loop else []  # loops measured over two passes, like playback
    r = subprocess.run(['ffmpeg', '-nostats', *src, '-i', str(path), '-af', 'ebur128=peak=true',
                        '-f', 'null', '-'], capture_output=True, text=True).stderr
    i = float(re.findall(r'I:\s+(-?[\d.]+) LUFS', r)[-1])
    tp = float(re.findall(r'Peak:\s+(-?[\d.inf]+) dBFS', r)[-1])
    return i, tp


def words(s):
    return re.sub(r'[^a-z0-9 ]', ' ', s.lower()).split()


def main():
    import mlx_whisper
    files = []
    for p in sorted(AUD.glob('*.wav')):
        sr, x = wavfile.read(p)
        x = x.astype(np.float64) / 32768
        x2 = x if x.ndim == 2 else x[:, None]
        name = p.stem
        loop = name in LOOPS
        lu, tp = ebur(p, loop)
        e = dict(file=p.name, duration=round(len(x) / sr, 3), sampleRate=sr, channels=x2.shape[1],
                 lufs=lu if lu > -69 else None, truePeakDb=tp,
                 samplePeakDb=round(20 * np.log10(np.abs(x).max()), 2),
                 dc=round(float(np.abs(x2.mean(0)).max()), 5), loop=loop)
        # edge check: first/last 1 ms should be quiet for one-shots; seamless wrap for loops
        if loop:
            jump = np.abs(x2[0] - x2[-1]).max()
            typical = np.percentile(np.abs(np.diff(x2, axis=0)), 99.9)
            e['seamJump'] = round(float(jump), 5)
            e['seamOk'] = bool(jump <= typical)
        else:
            e['edgeMax'] = round(float(max(np.abs(x2[:48]).max(), np.abs(x2[-48:]).max())), 5)
        if name.startswith('voice_'):
            lid = name[6:]
            got = mlx_whisper.transcribe(str(p), path_or_hf_repo='mlx-community/whisper-large-v3-turbo',
                                         language='en')['text'].strip()
            e.update(id=lid, speaker=lines[lid]['speaker'], voice=script['voices'][lines[lid]['speaker']]['kokoroVoice'],
                     transcript=lines[lid]['text'], whisper=got)
        files.append(e)
        print(json.dumps(e), flush=True)
        assert e['samplePeakDb'] <= -1.0, p
    (AUD / 'manifest.json').write_text(json.dumps(
        dict(sampleRate=48000, bpm=120, barSeconds=2.0,
             note='Synthetic IVR reenactment; all music/SFX synthesized by audio/synth.py, voices by audio/voices.py (Kokoro-82M).',
             files=files), indent=2) + '\n')

    if len(sys.argv) > 1:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        out = Path(sys.argv[1])
        out.mkdir(parents=True, exist_ok=True)
        for n in ('bed_full', 'bed_soft', 'muzak_hold', 'end_sting', 'riser', 'impact'):
            sr, x = wavfile.read(AUD / f'{n}.wav')
            m = x.astype(float).mean(1) / 32768
            fig, ax = plt.subplots(2, 1, figsize=(14, 8), gridspec_kw=dict(height_ratios=[3, 1]))
            ax[0].specgram(m, NFFT=4096, Fs=sr, noverlap=3072, cmap='magma', vmin=-130, vmax=-20)
            ax[0].set_yscale('symlog', linthresh=200)
            ax[0].set_ylim(20, 24000)
            ax[0].set_title(n)
            ax[1].plot(np.arange(len(m)) / sr, x[:, 0] / 32768, lw=0.3)
            ax[1].set_ylim(-1, 1)
            fig.tight_layout()
            fig.savefig(out / f'{n}.png', dpi=80)
            plt.close(fig)


if __name__ == '__main__':
    main()
