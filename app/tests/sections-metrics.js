// sections-metrics.js (v2.35) -- melody sections and Rewrite on the example songs.
//
//   node tests/sections-metrics.js [harmonizer-x.y.html]
//
// For each example (chords from the composers' voices, one per beat; STYLE=close|hymn|open, Close by default):
//   tenor   -- regenerate every stave but the melody, then give the second quarter of the song
//              to the tenor (tune brought across) and Generate parts again: how often the soprano
//              sits above the tenor tune, parallels, time
//   chords  -- the first quarter as chords only (per chord, held, on the beat): every stave sings?
//   rewrite -- the composer's soprano and bass kept, the inner parts rewritten over the whole song
'use strict';
const fs = require('fs'), path = require('path');
const { loadApp } = require('./dom-stub');
const appDir = __dirname.replace(/[\\/]tests$/, '');
const dataDir = path.join(appDir, '..', 'data');
let target = process.argv[2] || fs.readFileSync(path.join(appDir, 'current.txt'), 'utf8').trim();
if (!path.isAbsolute(target)) target = path.join(appDir, target);
const H = loadApp(target);
const examples = fs.readdirSync(dataDir).filter(f => /\.mid$/i.test(f)).sort();
function load(file){
  const score = H.midiToScore(H.parseMidiBytes(new Uint8Array(fs.readFileSync(path.join(dataDir, file)))), file);
  const cands = score.parts.filter(p => p.pitchedCount > 0);
  if (cands.length < 3) return null;
  const s = H.buildSongFromScore(score, { melody: cands[0].index, include: cands.map(p => p.index) }, file).song;
  H.setSong(s); H.render();
  s.chords = H.analyzeChordsFromVoices('beat').chords; s.harmonyStyle = process.env.STYLE || 'close';
  return s;
}
const S = () => H.getSong();
const list = id => id === S().melodyPartId ? S().notes : S().parts.find(p => p.id === id).notes;
const clef = id => S().parts.find(p => p.id === id).clef;
function at(id, beat){ let t = 0; for (const n of list(id) || []){ const d = H.noteBeats(n); if (beat >= t - 1e-6 && beat < t + d - 1e-6) return n.type === 'note' ? H.soundingSemitoneOfNote(n, clef(id)) : null; t += d; } return undefined; }
const par = () => { const f = H.findParallels(); return Array.isArray(f) ? f.length : (f && f.size) || 0; };
const total = () => Math.max(...S().parts.map(p => (list(p.id) || []).reduce((a, n) => a + H.noteBeats(n), 0)));
const tot = { tenor: [0, 0], chords: 0, chordsOk: 0, par1: 0, par2: 0, parR: 0, parC: 0, ms: 0, msR: 0 };
examples.forEach(file => {
  if (!load(file)) return;
  const T = total(), ml = H.measureList(T), q = Math.floor(ml.length / 4);
  const a = ml[q].start, b = ml[2 * q].start;
  // tenor section
  S().parts.forEach(p => { if (p.id !== S().melodyPartId){ p.notes = []; delete p._generated; } });
  H.render(); H.generatePartsFromMelodyAndChords();
  const p1 = par();
  const tId = S().parts.find(p => /^T/.test(p.role)).id, sId = S().melodyPartId;
  H.applyMelodyIn(a, b, tId, 'chord', true);
  let t0 = Date.now(); H.generatePartsFromMelodyAndChords(); const ms = Date.now() - t0;
  let above = 0, n = 0;
  for (let x = a; x < b; x += 0.5){ const tp = at(tId, x), sp = at(sId, x); if (tp != null){ n++; if (sp != null && sp >= tp) above++; } }
  const p2 = par();
  // chords only in the first quarter, each fill
  const c0 = ml[0].start, c1 = ml[q].start, fills = {};
  ['chord', 'held', 'beat'].forEach(fill => {
    H.applyMelodyIn(c0, c1, null, fill, false); H.generatePartsFromMelodyAndChords();
    let ok = true; S().parts.forEach(p => { for (let x = c0; x < c1; x += 1) if (at(p.id, x) == null) ok = false; });
    fills[fill] = ok; tot.chords++; if (ok) tot.chordsOk++;
  });
  const pc = par();
  // rewrite inner parts of the composer's own song, soprano and bass kept
  load(file);
  const inner = {}; S().parts.forEach(p => { if (!/^(S|B)$/.test(p.role)) inner[p.id] = true; });
  const p0 = par();
  t0 = Date.now(); H.generateWithSections({ a: 0, b: total(), staves: inner }); const msR = Date.now() - t0;
  const pr = par();
  console.log(file.padEnd(34) + ' tenor mm. ' + H.measureAtBeatNum(a) + '–' + H.measureAtBeatNum(b - 1e-3) + ': soprano above ' + above + '/' + n + ', parallels ' + p1 + ' → ' + p2 + ' (' + ms + 'ms)' +
    ' | chords only ' + Object.keys(fills).map(k => k + (fills[k] ? ' ok' : ' GAPS')).join(', ') + ' par ' + pc +
    ' | rewrite inner: parallels ' + p0 + ' (composer) → ' + pr + ' (' + msR + 'ms)');
  tot.tenor[0] += above; tot.tenor[1] += n; tot.par1 += p1; tot.par2 += p2; tot.parC += p0; tot.parR += pr; tot.ms += ms; tot.msR += msR;
});
console.log('\nsoprano above the tenor tune ' + Math.round(100 * tot.tenor[0] / tot.tenor[1]) + '%; parallels without/with the tenor section ' + tot.par1 + ' / ' + tot.par2 +
  '; chords-only passages with every stave singing ' + tot.chordsOk + '/' + tot.chords + '; inner parts rewritten: parallels ' + tot.parC + ' (composers) → ' + tot.parR + '; time ' + tot.ms + 'ms / ' + tot.msR + 'ms');
