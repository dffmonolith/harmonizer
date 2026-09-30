// partwriting-metrics.js -- v2.32: before/after line measures for Generate parts on the example
// songs in ../data. Each example's own voices are used only to work out its chords (Analyze
// chords, one per beat); every stave but the melody is then emptied and regenerated, and the
// generated voices are measured as lines. Not pass/fail -- a report to compare versions:
//
//   node tests/partwriting-metrics.js harmonizer-2.31.html harmonizer-2.32.html
//
// Env: STYLES=close,hymn,open  MOTION=none|some|more  RECUR=same|vary|fresh (v2.34)  ORIGINAL=1
//
// Measures, per generated voice (lower is better unless marked):
//   hold%     share of chord changes the voice sits through on the same pitch
//   maxHold   longest run of chord changes on one pitch
//   range     average span of the voice within a phrase, in semitones (higher = more line)
//   shadow%   share of the voice's moves that go the same way as the melody by a 3rd/6th-type parallel
//   leaps     leaps of a fourth or more per 100 moves
//   zz        zig-zag: share of moves that go straight back to the note before (x y x)
//   run       average number of moves in one direction in a row (higher = more directed)
//   par       parallel fifths/octaves flagged by the app's own checker (whole score)
//   moving under long melody notes (summary): share of melody notes a half note or longer
//             under which some other voice moves to a new pitch
'use strict';
const fs = require('fs');
const path = require('path');
const { loadApp } = require('./dom-stub');
const appDir = __dirname.replace(/[\\/]tests$/, '');
const dataDir = path.join(appDir, '..', 'data');
// ORIGINAL=1 measures the composers' own voices instead (the same measures, as a reference)
const ORIGINAL = !!process.env.ORIGINAL;
const files = process.argv.slice(2);
if (!files.length){ console.log('usage: node tests/partwriting-metrics.js a.html [b.html ...]'); process.exit(1); }
const STYLES = ORIGINAL ? ['close'] : (process.env.STYLES || 'close,hymn,open').split(',');
const examples = fs.readdirSync(dataDir).filter(f => /\.mid$/i.test(f)).sort();

const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHIFT = { treble: 0, tenor8va: -12, treble8vb: -12, bass: 0 };

function measure(H, style, file){
  const bytes = new Uint8Array(fs.readFileSync(path.join(dataDir, file)));
  const score = H.midiToScore(H.parseMidiBytes(bytes), file);
  const cands = score.parts.filter(p => p.pitchedCount > 0);
  if (cands.length < 3) return null;
  const built = H.buildSongFromScore(score, { melody: cands[0].index, include: cands.map(p => p.index) }, file);
  const s = built.song;
  H.setSong(s); H.render();
  const r = H.analyzeChordsFromVoices('beat');
  s.chords = r.chords; s.harmonyStyle = style;
  if (process.env.MOTION) s.harmonyMotion = process.env.MOTION;   // none | some | more (v2.33)
  if (process.env.RECUR) s.recurMode = process.env.RECUR;         // same | vary | fresh (v2.34)
  let ms = 0;
  if (!ORIGINAL){
    s.parts.forEach(p => { if (p.id !== s.melodyPartId){ p.notes = []; delete p._generated; } });
    H.render();
    const t0 = Date.now();
    H.generatePartsFromMelodyAndChords();
    ms = Date.now() - t0;
  }
  const g = H.getSong();
  const mPart = g.parts.find(p => p.id === g.melodyPartId);
  const others = g.parts.filter(p => p.id !== g.melodyPartId);
  const ev = H.buildEvents(mPart).events;
  function pitchAt(list, clef, beat){
    let t = 0;
    for (const n of list){ const d = H.noteBeats(n); if (beat >= t - 1e-6 && beat < t + d - 1e-6) return n.type === 'note' ? H.soundingSemitoneOfNote(n, clef) : null; t += d; }
    return null;
  }
  const out = {};
  others.forEach(p => {
    const P = ev.map(e => pitchAt(p.notes, p.clef, e.beat));
    let changes = 0, holds = 0, run = 0, maxRun = 0, moves = 0, shadow = 0, leaps = 0;
    for (let e = 1; e < ev.length; e++){
      if (P[e] == null || P[e-1] == null) continue;
      const d = P[e] - P[e-1], dm = ev[e].melodySounding - ev[e-1].melodySounding;
      if (ev[e].chordChanged){ changes++; if (d === 0){ holds++; run++; maxRun = Math.max(maxRun, run); } else run = 0; }
      if (d){ moves++; if (Math.abs(d) >= 5) leaps++;
        const iv = ((ev[e].melodySounding - P[e]) % 12 + 12) % 12;
        if (dm && Math.sign(d) === Math.sign(dm) && Math.abs(d - dm) <= 1 && [3,4,8,9].includes(iv)) shadow++; }
    }
    // zig-zag: a move straight back to the note before (x y x); runs: moves in one direction in a row
    const mv = []; for (let e = 1; e < ev.length; e++){ if (P[e] != null && P[e-1] != null && P[e] !== P[e-1]) mv.push({ d: P[e] - P[e-1], to: P[e], from: P[e-1] }); }
    let osc = 0, runs = [], rl = 0;
    mv.forEach((m, k) => { if (k && mv[k-1].from === m.to) osc++; if (k && Math.sign(mv[k-1].d) === Math.sign(m.d)) rl++; else { if (k) runs.push(rl + 1); rl = 0; } });
    if (mv.length) runs.push(rl + 1);
    let spans = [], lo = Infinity, hi = -Infinity;
    ev.forEach((e, k) => { if (P[k] != null){ lo = Math.min(lo, P[k]); hi = Math.max(hi, P[k]); } if (e.phraseEnd){ if (hi >= lo) spans.push(hi - lo); lo = Infinity; hi = -Infinity; } });
    out[p.role] = { hold: changes ? holds / changes : 0, maxHold: maxRun, range: spans.length ? spans.reduce((a, b) => a + b, 0) / spans.length : 0,
      shadow: moves ? shadow / moves : 0, leaps: moves ? 100 * leaps / moves : 0,
      osc: mv.length > 1 ? osc / (mv.length - 1) : 0, run: runs.length ? runs.reduce((a, b) => a + b, 0) / runs.length : 0 };
  });
  // v2.33: rhythm -- of the melody notes a half note or longer, the share under which at least
  // one other voice starts a new pitch (the voices moving while the melody holds)
  let longN = 0, longMoved = 0, t0b = 0;
  const tls = others.map(p => ({ p, tl: (function(){ let t = 0; return p.notes.map(n => { const o = { s: t, n }; t += H.noteBeats(n); return o; }); })() }));
  g.notes.forEach(n => {
    const d = H.noteBeats(n);
    if (n.type === 'note' && d >= 2 - 1e-6){
      longN++;
      if (tls.some(({ p, tl }) => tl.some((x, k) => x.s > t0b + 1e-6 && x.s < t0b + d - 1e-6 && x.n.type === 'note' && k > 0 && tl[k-1].n.type === 'note' &&
        H.soundingSemitoneOfNote(x.n, p.clef) !== H.soundingSemitoneOfNote(tl[k-1].n, p.clef)))) longMoved++;
    }
    t0b += d;
  });
  let par = 0; try { const f = H.findParallels(); par = Array.isArray(f) ? f.length : (f && f.size) || 0; } catch (e) { par = -1; }
  // v2.34: repeated passages found, and how many of their notes match the first time
  const rr = H.getState && H.getState().refineReport, rp = rr && rr.repeats;
  const recur = rp ? rp.occs.filter(o => !o.off).length + ' repeats' + (rp.pairs ? ', ' + Math.round(100 * rp.alike / rp.pairs) + '% alike' : '') : '';
  return { voices: out, par, ms, events: ev.length, under: longN ? longMoved / longN : 0, recur };
}

const results = {};
files.forEach(f => {
  const target = path.isAbsolute(f) ? f : path.join(appDir, f);
  const H = loadApp(target);
  results[f] = {};
  STYLES.forEach(st => examples.forEach(x => { try { results[f][st + ' ' + x] = measure(H, st, x); } catch (e) { results[f][st + ' ' + x] = { error: String(e && e.stack || e).slice(0, 300) }; } }));
});
const fmt = (v, d) => (v * (d || 1)).toFixed(d === 100 ? 0 : 1);
Object.keys(results[files[0]]).forEach(k => {
  console.log('\n' + k);
  files.forEach(f => {
    const r = results[f][k];
    if (!r){ console.log('  ' + f + ': (skipped)'); return; }
    if (r.error){ console.log('  ' + f + ': ERROR ' + r.error); return; }
    const v = Object.keys(r.voices).map(role => { const m = r.voices[role];
      return role + ' hold ' + fmt(m.hold, 100) + '% max ' + m.maxHold + ' rng ' + fmt(m.range) + ' shd ' + fmt(m.shadow, 100) + '% lp ' + fmt(m.leaps) + ' zz ' + fmt(m.osc, 100) + '% run ' + m.run.toFixed(2); }).join(' | ');
    console.log('  ' + f.replace(/harmonizer-|\.html/g, '') + ' [' + r.ms + 'ms, par ' + r.par + (r.recur ? ', ' + r.recur : '') + '] ' + v);
  });
});
// summary: averages over every generated voice of every example
console.log('\nAverages over all voices, all examples:');
files.forEach(f => {
  let n = 0, a = { hold: 0, maxHold: 0, range: 0, shadow: 0, leaps: 0, osc: 0, run: 0 }, par = 0, ms = 0, under = 0, songs = 0;
  Object.values(results[f]).forEach(r => { if (!r || r.error) return; par += r.par; ms += r.ms; under += r.under || 0; songs++;
    Object.values(r.voices).forEach(m => { n++; Object.keys(a).forEach(k => a[k] += m[k]); }); });
  console.log('  ' + f + ': hold ' + fmt(a.hold / n, 100) + '%, maxHold ' + fmt(a.maxHold / n) + ', range ' + fmt(a.range / n) + ', shadow ' + fmt(a.shadow / n, 100) + '%, leaps ' + fmt(a.leaps / n) + ', zig-zag ' + fmt(a.osc / n, 100) + '%, run ' + (a.run / n).toFixed(2) + ', parallels ' + par + ', moving under long melody notes ' + fmt(under / songs, 100) + '%, time ' + ms + 'ms');
});
