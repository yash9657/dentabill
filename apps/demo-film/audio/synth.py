"""Synthesize DTMF, SFX and music stems for the DentaBill demo film (numpy/scipy only).

Usage: python synth.py            -> writes everything into ../public/audio/
       python synth.py bed_full   -> only the named outputs
All original synthesis; 48 kHz / 16-bit stereo. 120 BPM, 1 bar = 2.0 s, key of C major.
Loops are rendered circularly (notes wrap, effects run on a 3x tiling and keep the middle),
so the last sample flows into the first.
"""
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import scipy.signal as ss
from scipy.io import wavfile
from scipy.ndimage import minimum_filter1d, uniform_filter1d

SR = 48000
BEAT = 0.5
BAR = 2.0
S16 = BEAT / 4
OUT = Path(__file__).resolve().parent.parent / 'public' / 'audio'
TWO_PI = 2 * np.pi


def rng(seed):
    return np.random.default_rng(seed)


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def tt(dur):
    return np.arange(int(round(dur * SR))) / SR


def st(x):
    """Mono -> stereo (n, 2)."""
    return x if x.ndim == 2 else np.stack([x, x], 1)


def pan(x, p):
    """Constant-power pan, p in [-1, 1]; p may be an array."""
    a = (np.asarray(p) + 1) * np.pi / 4
    m = x if x.ndim == 1 else x.mean(1)
    return np.stack([m * np.cos(a), m * np.sin(a)], 1)


# ---------------------------------------------------------------- filters
def _sos(kind, f, order=2):
    return ss.butter(order, f, kind, fs=SR, output='sos')


def lp(x, f, order=2):
    return ss.sosfilt(_sos('lowpass', f, order), x, axis=0)


def hp(x, f, order=2):
    return ss.sosfilt(_sos('highpass', f, order), x, axis=0)


def bp(x, lo, hi, order=2):
    return ss.sosfilt(_sos('bandpass', [lo, hi], order), x, axis=0)


def peq(x, f, gain_db, q=0.7):
    """RBJ peaking EQ."""
    A = 10 ** (gain_db / 40)
    w = TWO_PI * f / SR
    al = np.sin(w) / (2 * q)
    b = [1 + al * A, -2 * np.cos(w), 1 - al * A]
    a = [1 + al / A, -2 * np.cos(w), 1 - al / A]
    return ss.lfilter(b, a, x, axis=0)


def svf(x, fc, q=0.7, mode='bp'):
    """Time-varying Chamberlin-style (TPT) state-variable filter; fc is a per-sample array."""
    g = np.tan(np.pi * np.clip(fc, 20, SR * 0.45) / SR)
    k = 1 / q
    a1 = 1 / (1 + g * (g + k))
    y = np.zeros_like(x)
    ic1 = ic2 = 0.0
    for i in range(len(x)):
        v3 = x[i] - ic2
        v1 = a1[i] * ic1 + g[i] * a1[i] * v3
        v2 = ic2 + g[i] * v1
        ic1 = 2 * v1 - ic1
        ic2 = 2 * v2 - ic2
        y[i] = v1 * k if mode == 'bp' else (v2 if mode == 'lp' else x[i] - k * v1 - v2)
    return y


def phone(x, lo=300, hi=3400, drive=1.6):
    y = bp(bp(x, lo, hi), lo, hi)
    return np.tanh(drive * y) / drive


def fades(x, a=0.005, b=0.01):
    x = x.copy()
    na, nb = int(a * SR), int(b * SR)
    if na:
        x[:na] *= np.linspace(0, 1, na)[:, None] if x.ndim == 2 else np.linspace(0, 1, na)
    if nb:
        x[-nb:] *= np.linspace(1, 0, nb)[:, None] if x.ndim == 2 else np.linspace(1, 0, nb)
    return x


# ---------------------------------------------------------------- oscillators
def additive_saw(f, dur, cutoff, voices=(0.0,), seed=0, fmax=16000, slope=4):
    """Band-limited detuned saw (sum of harmonics) through a lowpass whose cutoff may be
    an array over time; harmonics above Nyquist are never generated (no aliasing)."""
    t = tt(dur)
    r = rng(seed)
    out = np.zeros_like(t)
    cut = np.asarray(cutoff, float)
    for c in voices:
        ff = f * 2 ** (c / 1200)
        for k in range(1, int(fmax / ff) + 1):
            g = (1 / k) / np.sqrt(1 + (k * ff / cut) ** slope)
            if np.max(g) < 1e-4:
                break
            out += g * np.sin(TWO_PI * k * ff * t + r.uniform(0, TWO_PI))
    return out / np.sqrt(len(voices))


def env_ar(n, attack, tau, release=0.0, length=None):
    t = np.arange(n) / SR
    e = np.minimum(1, t / max(attack, 1e-4)) * np.exp(-np.maximum(t - attack, 0) / tau)
    if length is not None:
        rel = np.clip((t - length) / max(release, 1e-4), 0, 1)
        e *= 1 - rel
    return e


def env_pad(dur, attack, release, total):
    t = tt(total)
    up = np.clip(t / attack, 0, 1) ** 1.5
    down = np.clip(1 - (t - dur) / release, 0, 1) ** 2
    return up * down


def bell(f, dur, decay=0.6, bright=1.0):
    t = tt(dur)
    parts = [(1, 1.0, decay), (2.0, 0.28 * bright, decay * 0.45), (3.0, 0.1 * bright, decay * 0.25),
             (4.16, 0.06 * bright, decay * 0.12), (5.43, 0.03 * bright, decay * 0.08)]
    y = sum(a * np.sin(TWO_PI * f * m * t) * np.exp(-t / d) for m, a, d in parts if f * m < SR / 2.2)
    return y * np.minimum(1, t / 0.002)


# ---------------------------------------------------------------- drums
def kick(dur=0.5, f0=105, f1=44, seed=1):
    t = tt(dur)
    f = f1 + (f0 - f1) * np.exp(-t / 0.035)
    body = np.sin(TWO_PI * np.cumsum(f) / SR) * np.exp(-t / 0.22) * np.minimum(1, t / 0.0015)
    click = lp(hp(rng(seed).standard_normal(len(t)), 1500), 5000) * np.exp(-t / 0.003) * 0.12
    return body + click


def clap(seed=2, dur=0.35):
    t = tt(dur)
    n = bp(rng(seed).standard_normal(len(t)), 900, 3200)
    e = sum(np.exp(-np.maximum(t - d, 0) / 0.004) * (t >= d) for d in (0, 0.009, 0.019))
    e = e * 0.6 + np.exp(-np.maximum(t - 0.026, 0) / 0.11) * (t >= 0.026)
    body = np.sin(TWO_PI * 185 * t) * np.exp(-t / 0.05) * 0.35
    return n * e * 0.5 + body


def hat(open_=False, seed=3):
    dur = 0.32 if open_ else 0.09
    t = tt(dur)
    metal = sum(np.sign(np.sin(TWO_PI * f * t + p)) for f, p in
                zip((205.3, 304.4, 369.6, 522.7, 540.0, 800.0), rng(seed).uniform(0, 6, 6)))
    n = rng(seed + 1).standard_normal(len(t))
    y = hp(0.25 * metal / 6 + n, 7500, 4)
    y = peq(y, 10500, 3, 1.2)
    return y * np.exp(-t / (0.11 if open_ else 0.016)) * np.minimum(1, t / 0.0008)


# ---------------------------------------------------------------- effects
def reverb_ir(rt60, dur=None, damp=0.45, predelay=0.012, seed=11, width=1.0):
    """Stereo exponentially-decaying noise IR with faster high-band decay (dark tail)."""
    dur = dur or rt60 * 1.1
    t = tt(dur)
    r = rng(seed)
    chans = []
    for c in range(2):
        nz = r.standard_normal(len(t))
        lo = lp(nz, 2000)
        hi = nz - lo
        ir = lo * np.exp(-6.9 * t / rt60) + 0.6 * hi * np.exp(-6.9 * t / (rt60 * damp))
        ir *= np.minimum(1, t / 0.006)
        chans.append(ir)
    ir = np.stack(chans, 1)
    m = ir.mean(1, keepdims=True)
    ir = m + (ir - m) * width
    ir = np.concatenate([np.zeros((int(predelay * SR), 2)), ir])
    return ir / np.sqrt((ir ** 2).sum() / 2)


def reverb(x, ir, wet):
    x = st(x)
    y = np.stack([ss.fftconvolve(x[:, c], ir[:, c])[:len(x)] for c in range(2)], 1)
    return x + wet * y


def pingpong(x, d, fb=0.45, taps=6, tone=4000):
    """Dotted-eighth ping-pong delay on a mono-summed send; returns wet only."""
    m = lp(st(x).mean(1), tone)
    y = np.zeros((len(m), 2))
    n = int(round(d * SR))
    for k in range(1, taps + 1):
        if k * n >= len(m):
            break
        y[k * n:, k % 2] += fb ** k * m[:len(m) - k * n]
    return y


def loopfx(x, fn):
    """Apply a (causal) effect to a loop seamlessly: run on 3 tiles, keep the middle."""
    L = len(x)
    return fn(np.concatenate([x, x, x]))[L:2 * L]


def place(buf, sig, t0, gain=1.0, wrap=False):
    sig = st(sig) * gain if buf.ndim == 2 else sig * gain
    i = int(round(t0 * SR))
    L = len(buf)
    if wrap:
        i %= L
        while len(sig):
            n = min(len(sig), L - i)
            buf[i:i + n] += sig[:n]
            sig, i = sig[n:], 0
    else:
        n = max(0, min(len(sig), L - i))
        buf[i:i + n] += sig[:n]


def limiter(x, ceiling_db=-1.5, hold=0.006, mode='nearest'):
    """Look-ahead brickwall: per-sample needed gain, min-held then box-smoothed (never above need)."""
    c = 10 ** (ceiling_db / 20)
    a = np.abs(x).max(1)
    g = np.minimum(1, c / np.maximum(a, 1e-12))
    w = int(hold * SR)
    g = minimum_filter1d(g, 2 * w + 1, mode=mode)
    g = uniform_filter1d(g, w, mode=mode)
    return x * g[:, None]


def lufs(x):
    with tempfile.NamedTemporaryFile(suffix='.wav') as f:
        wavfile.write(f.name, SR, st(x).astype(np.float32))
        r = subprocess.run(['ffmpeg', '-nostats', '-i', f.name, '-af', 'ebur128', '-f', 'null', '-'],
                           capture_output=True, text=True).stderr
    return float(re.findall(r'I:\s+(-?[\d.]+) LUFS', r)[-1])


def master(x, target=None, loop=False, ceiling=-1.5, drive=1.0):
    """Soft-clip + limiter, iterating gain to hit a LUFS target (measured with ffmpeg ebur128)."""
    x = st(x) - st(x).mean(0)
    mode = 'wrap' if loop else 'nearest'
    proc = lambda y: limiter(np.tanh(y * drive) / drive, ceiling, mode=mode)
    if target is None:
        return limiter(x * (10 ** (ceiling / 20) / np.abs(x).max()), ceiling, mode=mode)
    g = 1.0
    for _ in range(4):
        y = proc(x * g)
        meas = lufs(np.concatenate([y, y]) if loop else y)
        if abs(meas - target) < 0.15:
            break
        g *= 10 ** ((target - meas) / 20)
    return y


def write(name, x, loop=False):
    x = st(x)
    if not loop:
        x = fades(x, 0.002, 0.008)
    peak = np.abs(x).max()
    assert peak <= 10 ** (-1.0 / 20), (name, 20 * np.log10(peak))
    wavfile.write(OUT / name, SR, np.round(x * 32767).astype(np.int16))
    print(f'{name:18s} {len(x) / SR:7.3f}s  peak {20 * np.log10(peak):6.2f} dBFS', flush=True)


# ================================================================ DTMF
ROWS = [697, 770, 852, 941]
COLS = [1209, 1336, 1477]
KEYS = {'1': (0, 0), '2': (0, 1), '3': (0, 2), '4': (1, 0), '5': (1, 1), '6': (1, 2),
        '7': (2, 0), '8': (2, 1), '9': (2, 2), '0': (3, 1)}


def dtmf_tone(d, dur):
    r, c = KEYS[d]
    t = tt(dur)
    y = np.sin(TWO_PI * ROWS[r] * t) + 10 ** (2 / 20) * np.sin(TWO_PI * COLS[c] * t)  # +2 dB twist
    return fades(y, 0.004, 0.004)


def dtmf_seq(digits, on, off):
    y = np.concatenate([np.concatenate([dtmf_tone(d, on), np.zeros(int(off * SR))]) for d in digits])
    y = np.concatenate([np.zeros(int(0.01 * SR)), y[:len(y) - int(off * SR)], np.zeros(int(0.03 * SR))])
    return master(phone(y * 0.4, 250, 3600, 1.2), ceiling=-3)


def make_dtmf():
    write('dtmf_2.wav', dtmf_seq('2', 0.18, 0))
    write('dtmf_1.wav', dtmf_seq('1', 0.18, 0))
    write('dtmf_npi.wav', dtmf_seq('1234567893', 0.09, 0.06))


# ================================================================ SFX
def noise_st(n, seed):
    return rng(seed).standard_normal((n, 2))


def whoosh(dur, up=True, seed=20):
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = t / dur
    fc = 280 * (5200 / 280) ** (x if up else 1 - x)
    amp = (x ** 2.2 * np.clip((1 - x) / 0.12, 0, 1)) if up else (np.minimum(1, x / 0.04) * (1 - x) ** 2.4)
    nz = noise_st(n, seed)
    y = np.stack([svf(nz[:, c], fc * (1 + 0.06 * c), q=1.6) for c in range(2)], 1)
    body = lp(nz[:, 0], 500) * 0.5
    y = (y + body[:, None]) * amp[:, None]
    p = np.linspace(-0.5, 0.5, n) * (1 if up else -1)
    y = pan(y.mean(1), p) * 1.0 + y * 0.4
    return reverb(y, reverb_ir(0.8, seed=21), 0.15)


def sfx_click():
    t = tt(0.045)
    y = np.sin(TWO_PI * 2300 * t) * np.exp(-t / 0.004) * 0.6
    y += hp(rng(30).standard_normal(len(t)), 3000) * np.exp(-t / 0.0015) * 0.4
    y += np.sin(TWO_PI * 620 * t) * np.exp(-t / 0.007) * 0.4
    return lp(y, 9000)


def sfx_pop():
    t = tt(0.12)
    f = 420 + 700 * np.exp(-t / 0.018)
    y = np.sin(TWO_PI * np.cumsum(f) / SR) * env_ar(len(t), 0.002, 0.03)
    y += np.sin(TWO_PI * 2 * np.cumsum(f) / SR) * env_ar(len(t), 0.001, 0.008) * 0.15
    return y


def sfx_tick():
    t = tt(0.03)
    y = np.sin(TWO_PI * 4200 * t) * np.exp(-t / 0.0035)
    y += hp(rng(31).standard_normal(len(t)), 6000) * np.exp(-t / 0.001) * 0.3
    return y


def sfx_success():
    y = np.zeros((int(0.95 * SR), 2))
    for i, (m, p) in enumerate([(79, -0.3), (84, 0.0), (88, 0.3)]):  # G5 C6 E6
        place(y, pan(bell(mtof(m), 0.95 - i * 0.085, decay=0.32, bright=0.8), p), i * 0.085, 0.5)
    return fades(reverb(y, reverb_ir(1.2, seed=32), 0.22), 0.002, 0.15)


def sfx_ring():
    t = tt(2.0)
    y = 0.5 * (np.sin(TWO_PI * 440 * t) + np.sin(TWO_PI * 480 * t))
    return phone(fades(y, 0.02, 0.03), drive=1.3)


def sfx_drop():
    t = tt(0.42)
    f = 48 + 70 * np.exp(-t / 0.03)
    thud = np.sin(TWO_PI * np.cumsum(f) / SR) * env_ar(len(t), 0.003, 0.07)
    thud += lp(rng(33).standard_normal(len(t)), 400) * env_ar(len(t), 0.002, 0.03) * 0.5
    shim = np.zeros((len(t), 2))
    for i, m in enumerate([96, 100, 103, 108]):
        place(shim, pan(bell(mtof(m), 0.35, 0.12, 0.4), (-1) ** i * 0.5), 0.03 + i * 0.03, 0.08)
    air = hp(noise_st(len(t), 34), 7000) * env_ar(len(t), 0.03, 0.08)[:, None] * 0.05
    return fades(reverb(st(thud) + shim + air, reverb_ir(0.6, seed=35), 0.12), 0.001, 0.06)


def sfx_typing():
    r = rng(40)
    y = np.zeros((int(1.5 * SR), 2))
    tpos = 0.03
    while tpos < 1.42:
        n = int(0.05 * SR)
        t = np.arange(n) / SR
        click = bp(r.standard_normal(n), 1800, 5500) * np.exp(-t / 0.003)
        thock = np.sin(TWO_PI * r.uniform(160, 230) * t) * np.exp(-t / 0.012) * 0.6
        place(y, pan(click * 0.5 + thock, r.uniform(-0.3, 0.3)), tpos, r.uniform(0.5, 1.0))
        tpos += r.choice([0.07, 0.09, 0.11, 0.13, 0.2])
    return lp(reverb(y, reverb_ir(0.3, seed=41), 0.08), 9000)


def sfx_swoosh_logo():
    dur = 1.2
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = t / dur
    nz = noise_st(n, 50)
    fc = 1500 * (9000 / 1500) ** np.minimum(x / 0.6, 1)
    air = np.stack([svf(nz[:, c], fc, q=0.9) for c in range(2)], 1)
    air *= (np.minimum(1, x / 0.5) ** 2 * np.exp(-np.maximum(x - 0.5, 0) * 5))[:, None] * 0.35
    y = air.copy()
    r = rng(51)
    notes = [84, 88, 91, 96, 100, 103, 108]  # C-major sparkle, rising
    for i, m in enumerate(notes):
        place(y, pan(bell(mtof(m), 0.9, 0.35, 0.5), r.uniform(-0.7, 0.7)), 0.2 + i * 0.06, 0.14)
    sub = np.sin(TWO_PI * 65.4 * t) * np.exp(-np.maximum(t - 0.45, 0) / 0.3) * np.minimum(1, t / 0.45) * 0.25
    y = st(y) + st(sub)
    return fades(reverb(y, reverb_ir(1.8, seed=52), 0.3), 0.01, 0.2)


def sfx_fast_forward(muzak_dry):
    """Hold music 'tape' accelerating 1x -> 7x plus a rising sweep."""
    dur = 1.0
    t = tt(dur)
    rate = 1 + 6 * (t / dur) ** 1.6
    pos = np.cumsum(rate) % len(muzak_dry)
    tape = np.interp(pos, np.arange(len(muzak_dry)), muzak_dry)
    tape = phone(tape, 300, 4000) * 0.8
    f = 180 * (2200 / 180) ** (t / dur)
    sweep = sum(np.sin(TWO_PI * k * np.cumsum(f) / SR) / k for k in range(1, 6)) * 0.15
    sweep = lp(sweep, 5000)
    nz = hp(rng(60).standard_normal(len(t)), 3000) * (t / dur) ** 2 * 0.15
    y = (tape + sweep + nz) * np.minimum(1, t / 0.03)
    return fades(st(y) * 1.0, 0.005, 0.04)


# ================================================================ MUSIC
# Harmony (1 chord / bar): Fmaj7 - Am7 - Dm9 - Cmaj9, twice over 8 bars.
CHORDS = [
    dict(root=29, pad=[53, 57, 60, 64], arp=[65, 69, 72, 76]),   # Fmaj7
    dict(root=33, pad=[52, 57, 60, 67], arp=[64, 69, 72, 76]),   # Am7
    dict(root=38, pad=[53, 57, 60, 64], arp=[62, 65, 69, 72]),   # Dm9
    dict(root=36, pad=[52, 55, 59, 62], arp=[64, 67, 71, 74]),   # Cmaj9
]
LOOP = 16.0


def pad_layer(cutoff, seed=70, bars=8, level=1.0, air=0.0):
    L = int(LOOP * SR)
    y = np.zeros((L, 2))
    for b in range(bars):
        ch = CHORDS[b % 4]
        for j, m in enumerate(ch['pad'] + [ch['pad'][-1] + 12]):
            f = mtof(m)
            total = BAR + 1.2
            e = env_pad(BAR, 0.35, 1.2, total)
            lfo = cutoff * (1 + 0.25 * np.sin(TWO_PI * (b * BAR + tt(total)) / 8.0))
            left = additive_saw(f, total, lfo, (-11, -3, 6), seed=seed + b * 10 + j, fmax=9000)
            right = additive_saw(f, total, lfo, (-6, 4, 12), seed=seed + 500 + b * 10 + j, fmax=9000)
            s = np.stack([left, right], 1) * e[:, None] * (0.7 if j == 4 else 1.0)
            if air:
                s += np.sin(TWO_PI * 2 * f * tt(total))[:, None] * e[:, None] * air
            place(y, s, b * BAR, 0.11 * level, wrap=True)
    return y


def arp_layer(level=1.0, rate=1, octave=0, seed=80, cutoff0=3500, decay=0.12, bars=8, start_bar=0):
    """rate=1: 16ths, rate=2: 8ths. Pluck = saw with fast cutoff envelope."""
    L = int(LOOP * SR)
    y = np.zeros((L, 2))
    order = [0, 1, 2, 3, 2, 1, 3, 2]
    step = S16 * rate
    for b in range(start_bar, bars):
        ch = CHORDS[b % 4]
        for i in range(int(BAR / step)):
            m = ch['arp'][order[i % 8]] + 12 * octave
            t = tt(0.35)
            cut = 400 + cutoff0 * np.exp(-t / 0.05)
            note = additive_saw(mtof(m), 0.35, cut, (0, 7), seed=seed + i, fmax=12000)
            note *= env_ar(len(t), 0.002, decay)
            vel = 1.0 if i % 4 == 0 else (0.75 if i % 2 == 0 else 0.6)
            place(y, pan(note, 0.25 * np.sin(i * 1.3)), b * BAR + i * step, 0.12 * level * vel, wrap=True)
    return y


def sidechain(depth=0.5, tau=0.11):
    t = tt(LOOP)
    p = t % BEAT
    return 1 - depth * np.exp(-p / tau) * (1 - np.exp(-p / 0.003))


def bed_full():
    L = int(LOOP * SR)
    drums = np.zeros((L, 2))
    k = kick()
    for b in range(int(LOOP / BEAT)):
        place(drums, k, b * BEAT, 0.75, wrap=True)
    c = clap()
    for b in range(1, int(LOOP / BEAT), 2):
        place(drums, pan(c, 0.05), b * BEAT, 0.42, wrap=True)
    place(drums, pan(clap(seed=9), -0.05), LOOP - BEAT - S16, 0.22, wrap=True)  # bar-8 pickup
    swing = 0.018
    hc, ho = hat(), hat(True)
    for i in range(int(LOOP / S16)):
        pos = i * S16 + (swing if i % 2 else 0)
        if i % 4 == 2:
            place(drums, pan(ho, 0.2), pos, 0.17, wrap=True)
        else:
            vel = [0.13, 0.07, 0, 0.09][i % 4]
            place(drums, pan(hc, -0.35 if i % 2 else 0.3), pos, vel, wrap=True)
    shaker = hp(noise_st(L, 90), 6000) * (0.5 + 0.5 * np.cos(TWO_PI * tt(LOOP) / S16 * 1))[:, None] ** 4
    drums += shaker * 0.012
    drums = loopfx(drums, lambda x: reverb(x, reverb_ir(0.9, seed=91), 0.08))

    # bass: sustained sub + offbeat pluck an octave up
    bass = np.zeros(L)
    for b in range(8):
        ch = CHORDS[b % 4]
        f = mtof(ch['root'] + 12)
        e = env_pad(BAR - 0.05, 0.01, 0.05, BAR + 0.05)
        sub = np.sin(TWO_PI * f * tt(BAR + 0.05)) * e
        place(bass, sub, b * BAR, 0.24, wrap=True)
        for q in range(4):
            t = tt(0.3)
            cut = 250 + 1100 * np.exp(-t / 0.05)
            pl = additive_saw(f * 2, 0.3, cut, (0, 5), seed=100 + q, fmax=4000) * env_ar(len(t), 0.003, 0.11)
            place(bass, pl, b * BAR + q * BEAT + BEAT / 2, 0.38, wrap=True)
    bass = loopfx(bass, lambda x: lp(x, 1400))

    pad = pad_layer(2400)
    arp = arp_layer(level=1.5, cutoff0=6500)
    arp = arp + loopfx(arp, lambda x: pingpong(x, 0.375, 0.4)) * 0.45
    stabs = np.zeros((L, 2))
    for b in range(8):
        ch = CHORDS[b % 4]
        for pos in (2, 7, 10, 14):
            t = tt(0.5)
            cut = 900 + 6000 * np.exp(-t / 0.07)
            s = sum(np.stack([additive_saw(mtof(m), 0.5, cut, (-8, 0), seed=200 + m, fmax=10000),
                              additive_saw(mtof(m), 0.5, cut, (0, 8), seed=300 + m, fmax=10000)], 1)
                    for m in ch['pad'])
            s *= env_ar(len(t), 0.002, 0.16)[:, None]
            place(stabs, s, b * BAR + pos * S16, 0.10 if b < 4 else 0.12, wrap=True)
    stabs = stabs + loopfx(stabs, lambda x: pingpong(x, 0.375, 0.35, tone=2500)) * 0.35
    music = pad + arp + stabs
    music = loopfx(music, lambda x: peq(peq(reverb(x, reverb_ir(2.2, seed=92), 0.22), 7000, 4, 0.5), 3500, 3, 0.9))
    sc = sidechain(0.55)[:, None]
    mix = drums + (music * sc + st(bass) * sidechain(0.7)[:, None])
    mix = loopfx(mix, lambda x: hp(x, 28, 2))
    return master(mix, target=-16.0, loop=True, drive=1.2)


def bed_soft():
    L = int(LOOP * SR)
    pad = pad_layer(900, seed=170, level=1.2)
    arp = arp_layer(level=0.45, rate=2, octave=1, seed=180, cutoff0=3000, decay=0.18)
    arp = arp + loopfx(arp, lambda x: pingpong(x, 0.375, 0.5, tone=3000)) * 0.6
    sub = np.zeros(L)
    for b in range(8):
        e = env_pad(BAR, 0.3, 0.4, BAR + 0.4)
        place(sub, np.sin(TWO_PI * mtof(CHORDS[b % 4]['root'] + 12) * tt(BAR + 0.4)) * e, b * BAR, 0.16, wrap=True)
    hats = np.zeros((L, 2))
    hc = hat(seed=190)
    for i in range(int(LOOP / (2 * S16))):
        place(hats, pan(hc, 0.4 if i % 2 else -0.4), i * 2 * S16 + S16, 0.055 if i % 2 else 0.032, wrap=True)
    air = hp(noise_st(L, 191), 9000) * 0.012 * (1 + 0.5 * np.sin(TWO_PI * tt(LOOP) / 4.0))[:, None]
    music = loopfx(pad + arp + st(sub), lambda x: reverb(x, reverb_ir(2.8, seed=192, width=1.2), 0.3))
    music = loopfx(music, lambda x: peq(peq(x, 1100, -6, 0.5), 2400, -3, 0.8))
    mix = music + hats + air
    mix = loopfx(mix, lambda x: hp(x, 30, 2))
    return master(mix, target=-24.0, loop=True)


def muzak_dry():
    """4 s cheesy EP + lead + bass loop, before the phone/wobble treatment (mono)."""
    L = int(4.0 * SR)
    y = np.zeros(L)

    def ep(f, dur, idx=1.6):
        t = tt(dur)
        mod = idx * np.exp(-t / 0.25) * np.sin(TWO_PI * f * t)
        tine = 0.3 * np.exp(-t / 0.02) * np.sin(TWO_PI * 14 * f * t)
        return np.sin(TWO_PI * f * t + mod + tine) * np.exp(-t / 0.7) * np.minimum(1, t / 0.003)

    comps = [(0, [60, 64, 67, 71]), (1.5, [60, 64, 67, 71]), (2, [57, 60, 64, 67]), (3.5, [57, 60, 64, 67]),
             (4, [57, 62, 65, 69]), (5.5, [57, 62, 65, 69]), (6, [55, 59, 62, 65]), (7.5, [55, 59, 62, 65])]
    for beat, ms in comps:
        for m in ms:
            place(y, ep(mtof(m), 0.9), beat * BEAT, 0.12, wrap=True)
    mel = [(0, 76, 1), (1, 79, 1), (2, 81, .5), (2.5, 79, .5), (3, 76, 1),
           (4, 77, 1), (5, 81, 1), (6, 79, .5), (6.5, 77, .5), (7, 74, 1)]
    for beat, m, d in mel:
        t = tt(d * BEAT + 0.1)
        f = mtof(m) * (1 + 0.004 * np.sin(TWO_PI * 5.5 * t) * np.minimum(1, t / 0.2))
        ph = TWO_PI * np.cumsum(f) / SR
        lead = sum(np.sin(k * ph) / k for k in (1, 3, 5, 7)) * env_pad(d * BEAT - 0.03, 0.01, 0.08, d * BEAT + 0.1)
        place(y, lead, beat * BEAT, 0.22, wrap=True)
    for beat, m in enumerate([36, 43, 45, 40, 38, 45, 43, 47]):
        t = tt(0.45)
        place(y, (np.sin(TWO_PI * mtof(m) * t) + 0.3 * np.sin(TWO_PI * 2 * mtof(m) * t)) * np.exp(-t / 0.25),
              beat * BEAT, 0.35, wrap=True)
    for beat in range(8):
        t = tt(0.05)
        rim = bp(rng(beat).standard_normal(len(t)), 1500, 4000) * np.exp(-t / 0.008)
        place(y, rim, beat * BEAT + BEAT / 2, 0.25, wrap=True)
    return y


def muzak_hold(dry):
    L = len(dry)
    t = np.arange(3 * L) / SR
    x3 = np.concatenate([dry, dry, dry])
    d = 0.003 + 0.0016 * np.sin(TWO_PI * 0.75 * t) + 0.0006 * np.sin(TWO_PI * 2.25 * t + 1)  # periodic in 4 s
    wob = np.interp(np.arange(3 * L) - d * SR, np.arange(3 * L), x3)[L:2 * L]
    hiss = rng(95).standard_normal(L) * 0.004
    y = loopfx(wob + hiss, lambda x: phone(x * 1.4, 380, 3000, 2.2))
    y = loopfx(y, lambda x: peq(x, 1600, 4, 1.0))
    return master(st(y), target=-20.0, loop=True)


def riser():
    dur = 4.0
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = t / dur
    nz = noise_st(n, 110)
    fc = 250 * (9000 / 250) ** (x ** 1.3)
    y = np.stack([svf(nz[:, c], fc, q=1.4) for c in range(2)], 1) * (x ** 2.2)[:, None] * 0.5
    # snare roll: 8ths -> 16ths -> 32nds, fading in
    roll = np.zeros((n, 2))
    pos = 0.0
    while pos < dur - 0.01:
        step = BEAT / 2 if pos < 1.0 else (BEAT / 4 if pos < 3.0 else BEAT / 8)
        place(roll, pan(clap(seed=int(pos * 100)), 0.1 * np.sin(pos * 7)), pos, 0.35 * (pos / dur) ** 1.6)
        pos += step
    tone = np.sin(TWO_PI * np.cumsum(110 * (440 / 110) ** x) / SR) * x ** 3 * 0.12
    y = y + roll + st(tone)
    y = reverb(y, reverb_ir(1.0, seed=111), 0.18)
    y[-int(0.004 * SR):] *= np.linspace(1, 0, int(0.004 * SR))[:, None]  # end exactly on the bar line
    y = master(y, target=-15.0)
    y[:int(0.01 * SR)] *= np.linspace(0, 1, int(0.01 * SR))[:, None]
    return y


def impact():
    dur = 2.6
    t = tt(dur)
    k = kick(0.8, 140, 42) * 1.0
    boom_f = 34 + 30 * np.exp(-t / 0.08)
    boom = np.sin(TWO_PI * np.cumsum(boom_f) / SR) * np.exp(-t / 0.7) * np.minimum(1, t / 0.004)
    crash = hp(noise_st(len(t), 120), 4000) * np.exp(-t / 0.5)[:, None] * 0.12
    y = st(np.pad(k, (0, len(t) - len(k)))) + st(boom) * 0.8 + crash
    y = reverb(y, reverb_ir(2.2, seed=121), 0.35)
    y *= np.clip((dur - t) / 0.6, 0, 1)[:, None]
    return master(y, target=-14.0)


def end_sting():
    dur = 5.0
    L = int(dur * SR)
    y = np.zeros((L, 2))
    chord = [48, 52, 55, 59, 62, 64]  # Cmaj9
    for j, m in enumerate(chord):
        f = mtof(m)
        e = env_pad(1.4, 0.04, 3.0, dur)
        s = np.stack([additive_saw(f, dur, 1600 * np.exp(-tt(dur) / 3.0) + 400, (-9, 4), seed=400 + j, fmax=9000),
                      additive_saw(f, dur, 1600 * np.exp(-tt(dur) / 3.0) + 400, (-4, 9), seed=450 + j, fmax=9000)], 1)
        place(y, s * e[:, None], 0, 0.08)
    sub = np.sin(TWO_PI * mtof(36) * tt(dur)) * env_pad(1.2, 0.01, 2.0, dur)
    place(y, sub, 0, 0.3)
    for i, m in enumerate([72, 76, 79, 83, 84]):
        place(y, pan(bell(mtof(m), dur - 0.5, 1.4, 0.7), (i - 2) * 0.25), 0.0 + i * 0.07, 0.11)
    y = reverb(y, reverb_ir(3.5, seed=130, width=1.2), 0.4)
    y *= np.clip((dur - tt(dur)) / 1.2, 0, 1)[:, None] ** 2
    return master(y, target=-17.0)


# ================================================================ main
def main(only):
    OUT.mkdir(parents=True, exist_ok=True)
    want = lambda n: not only or n in only
    if want('dtmf'):
        make_dtmf()
    sfx = dict(whoosh_in=lambda: whoosh(0.6, True), whoosh_out=lambda: whoosh(0.6, False, 22),
               click=sfx_click, pop=sfx_pop, tick=sfx_tick, success=sfx_success, ring=sfx_ring,
               drop=sfx_drop, typing=sfx_typing, swoosh_logo=sfx_swoosh_logo)
    levels = dict(whoosh_in=-22, whoosh_out=-22, click=-6, pop=-6, tick=-9, success=-20, ring=-20,
                  drop=-18, typing=-24, swoosh_logo=-20)
    for k, fn in sfx.items():
        if want(k):
            x = st(fn())
            if len(x) / SR >= 0.4:
                write(f'{k}.wav', master(x, target=levels[k]))
            else:  # too short for gated loudness: peak-normalise
                write(f'{k}.wav', master(x * 10 ** (levels[k] / 20) / np.abs(x).max(), ceiling=levels[k]))
    dry = muzak_dry()
    if want('fast_forward'):
        write('fast_forward.wav', master(sfx_fast_forward(dry), target=-20))
    if want('muzak_hold'):
        write('muzak_hold.wav', muzak_hold(dry), loop=True)
    if want('bed_full'):
        write('bed_full.wav', bed_full(), loop=True)
    if want('bed_soft'):
        write('bed_soft.wav', bed_soft(), loop=True)
    if want('riser'):
        write('riser.wav', riser(), loop=True)  # already faded in; must end hard on the bar line
    if want('impact'):
        write('impact.wav', impact())
    if want('end_sting'):
        write('end_sting.wav', end_sting())


if __name__ == '__main__':
    main(set(sys.argv[1:]))
