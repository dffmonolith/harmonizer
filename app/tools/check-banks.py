#!/usr/bin/env python3
"""check-banks.py -- renders keys through each bank exactly as Harmonizer will (zone lookup,
playbackRate = 2^((key-root)/12)) and checks the written pitch is the lowest strong partial:
nothing loud an octave below (a 16' rank would make singers hear the wrong octave), and the
written pitch itself present. Run from app/:  python3 tools/check-banks.py"""
import json, base64, math, sys, glob
import numpy as np
def amp_at(X, fr, f):
    i = int(np.argmin(abs(fr - f))); return X[max(0, i - 3):i + 4].max()
bad = 0
for path in sorted(glob.glob('harmonizer-bank-*.json')):
    d = json.load(open(path)); out = []
    for key in range(36, 89, 4):
        z = next(z for z in d['zones'] if z['lo'] <= key <= z['hi'])
        x = np.frombuffer(base64.b64decode(z['pcm']), dtype='<i2').astype(float)[z['loopStart']:z['loopEnd']]
        x = np.tile(x, 1 + 16384 // len(x))[:16384]
        sr = z['rate'] * 2 ** ((key - z['root']) / 12)       # resampled rate after playbackRate
        X = np.abs(np.fft.rfft(x * np.hanning(len(x)))); fr = np.fft.rfftfreq(len(x), 1 / sr)
        f = 440 * 2 ** ((key - 69) / 12)
        a0, a1, sub = amp_at(X, fr, f), amp_at(X, fr, 2 * f), amp_at(X, fr, f / 2)
        top = max(a0, a1)
        ok = 20 * math.log10(sub / top) < -12 and 20 * math.log10(a0 / top) > -20
        bad += (not ok)
        out.append('%d%s' % (key, '' if ok else '!'))
    print('%-32s %s' % (path, ' '.join(out)))
print('FAIL' if bad else 'OK: written pitch is the lowest strong partial on every key checked')
sys.exit(1 if bad else 0)
