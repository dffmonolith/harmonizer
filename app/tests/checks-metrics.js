// checks-metrics.js -- v2.38: counts what the partwriting checks (findPartwritingIssues: parallel,
// contrary and hidden fifths/octaves, overlaps, cross-relations, augmented seconds) find in Generate
// parts' output on the example songs in ../data, per style. Not pass/fail -- a report to compare
// versions (the checks themselves are 2.38's, so older versions are measured with 2.38's checker by
// loading both: the first file generates, CHECKER=<file> judges; by default each file judges itself).
//
//   node tests/checks-metrics.js harmonizer-2.38.html [harmonizer-2.39.html]
//
// Env: STYLES=close,hymn,open  MOTION=none|some|more  ORIGINAL=1 (the composers' own voices)
//      ONLY=<part of a file name>  DBG=1 (list every finding)
'use strict';
const fs = require('fs');
const path = require('path');
const { loadApp } = require('./dom-stub');
const appDir = __dirname.replace(/[\\/]tests$/, '');
const dataDir = path.join(appDir, '..', 'data');
const ORIGINAL = !!process.env.ORIGINAL;
const files = process.argv.slice(2);
if (!files.length){ console.log('usage: node tests/checks-metrics.js a.html [b.html ...]'); process.exit(1); }
const STYLES = ORIGINAL ? ['close'] : (process.env.STYLES || 'close,hymn,open').split(',');
const examples = fs.readdirSync(dataDir).filter(f => /\.mid$/i.test(f) && (!process.env.ONLY || f.includes(process.env.ONLY))).sort();
const KINDS = ['par', 'con', 'hid', 'ovl', 'xrel', 'aug2'];

function run(H, style, file){
  const bytes = new Uint8Array(fs.readFileSync(path.join(dataDir, file)));
  const score = H.midiToScore(H.parseMidiBytes(bytes), file);
  const cands = score.parts.filter(p => p.pitchedCount > 0);
  if (cands.length < 3) return null;
  const built = H.buildSongFromScore(score, { melody: cands[0].index, include: cands.map(p => p.index) }, file);
  const s = built.song;
  H.setSong(s); H.render();
  const r = H.analyzeChordsFromVoices('beat');
  s.chords = r.chords; s.harmonyStyle = style;
  if (process.env.MOTION) s.harmonyMotion = process.env.MOTION;
  if (!ORIGINAL){
    s.parts.forEach(p => { if (p.id !== s.melodyPartId){ p.notes = []; delete p._generated; } });
    H.render();
    H.generatePartsFromMelodyAndChords();
  }
  const list = H.findPartwritingIssues({ par: 1, con: 1, hid: 1, ovl: 1, xrel: 1, aug2: 1 });
  const g = H.getSong(), role = id => (g.parts.find(p => p.id === id) || {}).role;
  const c = {}; KINDS.forEach(k => c[k] = 0);
  list.forEach(x => {
    c[x.kind]++;
    if (process.env.DBG) console.log('   ', style, file, x.kind + (x.sub || ''), 'beat ' + x.from + '->' + x.to, role(x.a.partId) + (x.b ? '/' + role(x.b.partId) : ''),
      x.a.n0.midi + (x.a.n1 ? '>' + x.a.n1.midi : ''), x.b ? x.b.n0.midi + (x.b.n1 ? '>' + x.b.n1.midi : '') : '');
  });
  return c;
}
const totals = {};
files.forEach(f => {
  const H = loadApp(path.isAbsolute(f) ? f : path.join(appDir, f));
  totals[f] = {};
  STYLES.forEach(st => {
    const tot = {}; KINDS.forEach(k => tot[k] = 0);
    examples.forEach(x => {
      let c; try { c = run(H, st, x); } catch (e) { console.log('ERROR', f, st, x, String(e && e.stack || e).slice(0, 300)); return; }
      if (!c) return;
      KINDS.forEach(k => tot[k] += c[k]);
      console.log(f.replace(/harmonizer-|\.html/g, '').padEnd(6), st.padEnd(6), x.replace(/\.mid$/, '').padEnd(30), KINDS.map(k => k + ' ' + String(c[k]).padStart(2)).join('  '));
    });
    totals[f][st] = tot;
  });
});
console.log('\nTotals over the examples:');
STYLES.forEach(st => files.forEach(f => console.log('  ' + f.replace(/harmonizer-|\.html/g, '').padEnd(6) + st.padEnd(6) + KINDS.map(k => k + ' ' + String(totals[f][st][k]).padStart(3)).join('  '))));
