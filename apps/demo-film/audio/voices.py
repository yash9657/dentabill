"""Render call voice lines with Kokoro TTS + telephone processing (ffmpeg).

Usage: HF_HOME=<scratch>/hf ESPEAK_DATA_PATH=<short symlink to espeakng_loader/espeak-ng-data> \
       python voices.py <scratch_dir>
(espeak-ng truncates data paths >160 chars and falls back to a dead CI path; the env var
 with a short path is the fix -- needed for bf_emma, lang_code 'b'.)
Writes public/audio/voice_<id>.wav (48 kHz mono 16-bit).
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro import KPipeline

FILM = Path(__file__).resolve().parent.parent
SCRATCH = Path(sys.argv[1])
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else FILM / 'public' / 'audio'
script = json.loads((FILM / 'script.json').read_text())

# ffmpeg chains (input already 48 kHz). Phone: narrow band, compressed, lightly saturated.
PHONE = ('highpass=f=300:poles=2,highpass=f=300:poles=2,lowpass=f=3400:poles=2,lowpass=f=3400:poles=2,'
         'equalizer=f=1800:t=q:w=1.2:g=3,'
         'acompressor=threshold=0.1:ratio=4:attack=5:release=80:makeup=2,'
         'asoftclip=type=tanh:threshold=0.7')
LIGHT = ('highpass=f=150:poles=2,lowpass=f=6000:poles=2,equalizer=f=2500:t=q:w=1:g=2,'
         'acompressor=threshold=0.15:ratio=2.5:attack=8:release=120:makeup=1.5')
FILTERS = {'telephone': PHONE, 'light-telephone': LIGHT}

pipes = {}


def pipe_for(voice):
    lang = voice[0]  # 'a' american, 'b' british
    if lang not in pipes:
        pipes[lang] = KPipeline(lang_code=lang, repo_id='hexgrad/Kokoro-82M', device='cpu')
    return pipes[lang]


def trim(x, sr, keep=0.04, thresh_db=-45):
    env = np.abs(x)
    idx = np.where(env > 10 ** (thresh_db / 20) * env.max())[0]
    a = max(0, idx[0] - int(keep * sr))
    b = min(len(x), idx[-1] + int(keep * sr))
    return x[a:b]


def fade(x, sr, ms=8):
    n = int(sr * ms / 1000)
    r = np.linspace(0, 1, n)
    x = x.copy()
    x[:n] *= r
    x[-n:] *= r[::-1]
    return x


for line in script['lines']:
    v = script['voices'][line['speaker']]
    voice = v['kokoroVoice']
    speed = 1.1 if line['speaker'] == 'ivr' else 1.12
    audio = np.concatenate([r.audio.cpu().numpy() for r in pipe_for(voice)(line['text'], voice=voice, speed=speed)])
    raw = SCRATCH / f"raw_{line['id']}.wav"
    proc = SCRATCH / f"proc_{line['id']}.wav"
    sf.write(raw, audio, 24000, subtype='FLOAT')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(raw),
                    '-af', f"aresample=48000:filter_size=64,{FILTERS[v['filter']]}",
                    '-ac', '1', '-c:a', 'pcm_f32le', str(proc)], check=True)
    x, sr = sf.read(proc)
    x = fade(trim(x, sr), sr)
    x *= 10 ** (-1.5 / 20) / np.abs(x).max()  # peak -1.5 dBFS
    sf.write(OUT / f"voice_{line['id']}.wav", x, sr, subtype='PCM_16')
    print(line['id'], round(len(x) / sr, 3), flush=True)
