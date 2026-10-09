// joins-metrics.js (v2.37) -- the tune in the bass, and the joins between melody sections.
//
//   node tests/joins-metrics.js [harmonizer-x.y.html]         (STYLE=close|hymn|open, Close by default)
//
// For each example (chords from the composers' voices, one per beat; every stave but the melody
// generated first):
//   bass    -- the second quarter of the song given to the bass (tune brought across), Generate
//              parts: how often another stave sounds below the tune, crowds it (within a whole
//              step above), how often the chord has its third, parallels in the passage
//   joins   -- the second quarter to the tenor and the last quarter chords only (one per chord),
//              Generate parts: at each join, the leaps into the new passage (every stave but the
//              tune staves; sum of semitones and leaps over a fifth), parallels within a beat of
//              the join, voices crossing there
'use strict';
const fs = require('fs'), path = require('path');
const { loadApp } = require('./dom-stub');
const appDir = __dirname.replace(/[\\/]tests$/, '');
const dataDir = path.join(appDir, '..', 'data');
let target = process.argv[2] || fs.readFileSync(path.join(appDir, 'current.txt'), 'utf8').trim();
if (!path.isAbsolute(target)) target = path.join(appDir, target);
const H = loadApp(target);
const examples = fs.readdirSync(dataDir).filter(f => /\.mid$/i.test(f) && (!process.env.ONLY || f.includes(process.env.ONLY))).sort();
function load(file){
  const score = H.midiToScore(H.parseMidiBytes(new Uint8Array(fs.readFileSync(path.join(dataDir, file)))), file);
  const cands = score.parts.filter(p => p.pitchedCount > 0);
  if (cands.length < 3) return null;
  const s = H.buildSongFromScore(score, { melody: cands[0].index, include: cands.map(p => p.index) }, file).song;
  H.setSong(s); H.render();
  s.chords = H.analyzeChordsFromVoices('beat').chords; s.harmonyStyle = process.env.STYLE || 'close';
  S().parts.forEach(p => { if (p.id !== S().melodyPartId){ p.notes = []; delete p._generated; } });
  H.render(); H.generatePartsFromMelodyAndChords();
  return s;
}
const S = () => H.getSong();
const list = id => id === S().melodyPartId ? S().notes : S().parts.find(p => p.id === id).notes;
const clef = id => S().parts.find(p => p.id === id).clef;
function at(id, beat){ let t = 0; for (const n of list(id) || []){ const d = H.noteBeats(n); if (beat >= t - 1e-6 && beat < t + d - 1e-6) return n.type === 'note' ? H.soundingSemitoneOfNote(n, clef(id)) : null; t += d; } return undefined; }
// the last note sounding before x, and the first starting at or after x
function before(id, x){ let t = 0, last = null; for (const n of list(id) || []){ const d = H.noteBeats(n); if (t >= x - 1e-6) break; if (n.type === 'note') last = H.soundingSemitoneOfNote(n, clef(id)); t += d; } return last; }
function after(id, x){ let t = 0; for (const n of list(id) || []){ const d = H.noteBeats(n); if (t >= x - 1e-6 && n.type === 'note') return H.soundingSemitoneOfNote(n, clef(id)); t += d; } return null; }
const pars = (a, b) => { const f = H.findParallels(); return (Array.isArray(f) ? f : []).filter(p => p.to >= a - 1e-6 && p.from < b - 1e-6).length; };
const total = () => Math.max(...S().parts.map(p => (list(p.id) || []).reduce((a, n) => a + H.noteBeats(n), 0)));
const rank = { S: 0, S1: 0, S2: 1, M: 2, A: 3, A1: 3, A2: 4, T: 5, T1: 5, T2: 6, Bar: 7, B: 8, B1: 8, B2: 9 };
const tot = { below: 0, crowd: 0, third: 0, n: 0, parB: 0, leap: 0, big: 0, parJ: 0, cross: 0, joins: 0, ms: 0 };
examples.forEach(file => {
  if (!load(file)) return;
  const T = total(), ml = H.measureList(T), q = Math.floor(ml.length / 4);
  const a = ml[q].start, b = ml[2 * q].start, c = ml[3 * q].start;
  const byRank = S().parts.slice().sort((x, y) => (rank[x.role] || 0) - (rank[y.role] || 0));
  const bId = byRank[byRank.length - 1].id, tId = S().parts.find(p => /^T/.test(p.role)).id;
  // --- the tune in the bass ---
  H.applyMelodyIn(a, b, bId, 'chord', true);
  let t0 = Date.now(); H.generatePartsFromMelodyAndChords(); tot.ms += Date.now() - t0;
  let below = 0, crowd = 0, third = 0, n = 0;
  for (let x = a; x < b; x += 0.5){
    const bp = at(bId, x); if (bp == null) continue;
    n++;
    const others = S().parts.filter(p => p.id !== bId).map(p => at(p.id, x)).filter(v => v != null);
    if (others.some(v => v < bp)) below++;
    if (others.length && Math.min(...others) - bp <= 2) crowd++;
    const ch = S().chords.slice().sort((p, r) => p.beat - r.beat).filter(ch => ch.beat <= x + 1e-6).pop();
    if (ch){
      const info = H.chordTonesInfo ? H.chordTonesInfo(ch, 0) : null;
      const tones = info ? info.tones : null;
      if (tones && tones.length >= 3){ const pcs = others.concat([bp]).map(v => ((v % 12) + 12) % 12); if (pcs.includes(tones[1])) third++; }
      else third++;
      // v2.43: where the bass tune sings a note outside the chord, is the root above it?
      if (tones && !tones.includes(((bp % 12) + 12) % 12)){ tot.nct = (tot.nct || 0) + 1; if (others.some(v => ((v % 12) + 12) % 12 === ((info.rootPc % 12) + 12) % 12)) tot.nctRoot = (tot.nctRoot || 0) + 1; }
    }
  }
  const pB = pars(a, b);
  tot.below += below; tot.crowd += crowd; tot.third += third; tot.n += n; tot.parB += pB;
  // --- joins: tenor verse, chords-only ending ---
  load(file);
  const tId2 = S().parts.find(p => /^T/.test(p.role)).id;
  H.applyMelodyIn(a, b, tId2, 'chord', true);
  H.applyMelodyIn(c, T, null, 'chord', false);
  t0 = Date.now(); H.generatePartsFromMelodyAndChords(); tot.ms += Date.now() - t0;
  const tuneAt = x => x >= a - 1e-6 && x < b - 1e-6 ? tId2 : (x >= c - 1e-6 ? null : S().melodyPartId);
  let leap = 0, big = 0, pj = 0, cross = 0;
  [a, b, c].forEach(J => {
    tot.joins++;
    S().parts.forEach(p => {
      if (p.id === tuneAt(J - 0.01) || p.id === tuneAt(J + 0.01)) return;
      const u = before(p.id, J), v = after(p.id, J);
      if (u == null || v == null) return;
      leap += Math.abs(v - u); if (Math.abs(v - u) > 7){ big++; if (process.env.DBG) console.log('  big', file, 'J=' + J, p.role, u, '->', v); }
    });
    pj += pars(J - 1, J + 1);
    if (process.env.DBG) (H.findParallels() || []).filter(p => p.to >= J - 1 - 1e-6 && p.from < J + 1 - 1e-6).forEach(p => console.log('  par', file, 'J=' + J, p.kind, p.from, p.to, S().parts.find(q => q.id === p.a.partId).role, S().parts.find(q => q.id === p.b.partId).role, 'tune', tuneAt(p.from), tuneAt(p.to), JSON.stringify(H.getState ? '' : '')));
    const byRank2 = S().parts.slice().sort((x, y) => (rank[x.role] || 0) - (rank[y.role] || 0));
    for (let x = J - 1; x < J + 1; x += 0.5){
      const vs = byRank2.map(p => at(p.id, x));
      for (let i = 0; i + 1 < vs.length; i++){
        const hi = vs[i], lo = vs[i + 1];
        if (hi == null || lo == null) continue;
        const tune = tuneAt(x);
        if (byRank2[i].id === tune || byRank2[i + 1].id === tune) continue;   // a tune may cross (a tenor tune over the alto)
        if (lo > hi) cross++;
      }
    }
  });
  // the chords-only ending: parallels in it, the top line's motion, the voices' motion
  const topId = S().parts.slice().sort((x, y) => (rank[x.role] || 0) - (rank[y.role] || 0))[0].id; let parC = pars(c + 0.01, T), topLeap = 0, topBig = 0, inner = 0, prevTop = null;
  const prevBy = {};
  for (let x = c; x < T; x += 0.5){
    const v = at(topId, x); if (v != null){ if (prevTop != null){ topLeap += Math.abs(v - prevTop); if (Math.abs(v - prevTop) > 4) topBig++; } prevTop = v; }
    S().parts.forEach(p => { if (p.id === topId) return; const w = at(p.id, x); if (w != null){ if (prevBy[p.id] != null) inner += Math.abs(w - prevBy[p.id]); prevBy[p.id] = w; } });
  }
  tot.parC = (tot.parC || 0) + parC; tot.topLeap = (tot.topLeap || 0) + topLeap; tot.topBig = (tot.topBig || 0) + topBig; tot.inner = (tot.inner || 0) + inner;
  tot.leap += leap; tot.big += big; tot.parJ += pj; tot.cross += cross;
  console.log(file.padEnd(34) + ' bass tune mm. ' + H.measureAtBeatNum(a) + '–' + H.measureAtBeatNum(b - 1e-3) + ': below ' + below + '/' + n + ', crowded ' + crowd + ', third ' + third + '/' + n + ', parallels ' + pB +
    ' | joins: leaps ' + leap + ' st (' + big + ' over a 5th), parallels ' + pj + ', crossed ' + cross);
});
console.log('\nbass tune: another stave below it ' + Math.round(100 * tot.below / tot.n) + '%, crowded ' + Math.round(100 * tot.crowd / tot.n) + '%, third present ' + Math.round(100 * tot.third / tot.n) + '%, parallels ' + tot.parB + '; bass notes outside the chord ' + (tot.nct || 0) + ', root above ' + (tot.nctRoot || 0) +
  '\njoins (' + tot.joins + '): leaps ' + tot.leap + ' semitones, ' + tot.big + ' over a fifth, parallels ' + tot.parJ + ', crossings ' + tot.cross + '; time ' + tot.ms + 'ms' +
  '\nchords-only ending: parallels ' + tot.parC + ', top line moves ' + tot.topLeap + ' semitones (' + tot.topBig + ' leaps over a third), the other voices ' + tot.inner + ' semitones');
