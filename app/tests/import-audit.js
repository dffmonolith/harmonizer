// import-audit.js -- runs every MIDI / MusicXML file it can find through Harmonizer's importer
// (in a real Chromium, via Playwright) and prints the Import report for each: what the file held,
// what came across, and what didn't. Not a pass/fail test -- a way to see where import stands.
//
// Usage:
//   node tests/import-audit.js                         every file in ../data and ../data-private (and their subfolders)
//   node tests/import-audit.js some.mxl other.mid      just those files
//   node tests/import-audit.js --app harmonizer-2.28.html [files...]
//   node tests/import-audit.js --roundtrip [files...]   also save each as MusicXML, open that back
//                                                      in, and report any note that came back different
//
// Imports use the dialog's default choices (as a user clicking Import straight away would).
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

const appDir = __dirname.replace(/[\\/]tests$/, '');
const siteDir = path.dirname(appDir);
let args = process.argv.slice(2), target = null;
const ai = args.indexOf('--app');
if (ai >= 0){ target = args[ai + 1]; args.splice(ai, 2); }
const roundTrip = args.indexOf('--roundtrip') >= 0;
args = args.filter(a => a !== '--roundtrip');
if (!target) target = fs.readFileSync(path.join(appDir, 'current.txt'), 'utf8').trim();

let files = args;
if (!files.length){
  ['data', 'data-private'].forEach(d => {
    const dir = path.join(siteDir, d);
    const walk = d2 => fs.readdirSync(d2, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).forEach(e => {
      if (e.isDirectory() && !/^[._]/.test(e.name)) walk(path.join(d2, e.name));
      else if (e.isFile() && /\.(mid|midi|kar|mxl|musicxml|xml)$/i.test(e.name)) files.push(path.join(d2, e.name));
    });
    if (fs.existsSync(dir)) walk(dir);
  });
}
if (!files.length){ console.log('No files to audit.'); process.exit(0); }

(async () => {
  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch (e){ console.log('playwright is not installed (npm install playwright).'); process.exit(1); }
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    fs.readFile(path.join(siteDir, p), (err, data) => {
      if (err){ res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': p.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
      res.end(data);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { globalThis.__HARMONIZER_TEST__ = true; });
  await page.goto('http://127.0.0.1:' + server.address().port + '/' + path.basename(appDir) + '/' + target);
  await page.waitForTimeout(800);
  await page.evaluate(() => document.querySelectorAll('.modal-overlay').forEach(o => { o.hidden = true; }));
  console.log('Auditing imports with ' + target + '\n');

  for (const f of files){
    await page.setInputFiles('#loadJsonInput', f);
    await page.waitForTimeout(700);
    let chosen = '';
    if (!(await page.$eval('#importOverlay', el => el.hidden))){
      chosen = (await page.$$eval('#importTable tr', trs => trs.slice(1).map(tr => {
        const c = tr.querySelector('input[type=checkbox]');
        return (c && c.checked ? '[x] ' : '[ ] ') + tr.children[2].textContent;
      }))).join('\n      ');
      await page.click('#importOkBtn');
      await page.waitForTimeout(800);
    }
    const r = await page.evaluate(() => {
      const R = __harmonizer.getLastImportReport();
      document.getElementById('importReportOverlay').hidden = true;
      return R ? { lossy: R.fid.lossy, rows: R.fid.rows, notKept: R.fid.notKept, status: document.getElementById('statusText').textContent } : null;
    });
    console.log('== ' + path.basename(f) + (r && r.lossy ? '   (something not brought across)' : ''));
    if (chosen) console.log('   chooser:\n      ' + chosen);
    if (!r){ console.log('   (no report -- import failed?)\n'); continue; }
    r.rows.forEach(x => console.log('   ' + (x.label + ':').padEnd(38) + String(x.src).padStart(10) + ' -> ' + String(x.got).padEnd(10) + (x.short ? ' ' + (x.src - x.got) + ' FEWER' : '') + (x.note ? '  (' + x.note + ')' : '')));
    r.notKept.forEach(x => console.log('   not brought across: ' + x));
    console.log('   status: ' + r.status);
    if (roundTrip){
      // what each stave SOUNDS like -- every note as start-end:pitch, ties followed (main or divisi),
      // plus its lyric -- so writing the same thing differently (a tied e + s vs a dotted e) isn't a difference
      const dump = () => page.evaluate(() => {
        const H = __harmonizer, s = H.getSong();
        const lists = [s.notes].concat(s.parts.filter(p => p.id !== s.melodyPartId).map(p => p.notes || []));
        const BEATS = { w: 4, h: 2, q: 1, e: 0.5, s: 0.25 };
        const len = n => BEATS[n.duration] * (n.dotted ? 1.5 : 1) * (n.tuplet ? n.tuplet.timeOf / n.tuplet.count : 1);
        const key = p => p.letter + (p.accidental | 0) + p.octave;
        return lists.map(l => {
          const segs = []; let t = 0;
          l.forEach(n => {
            const d = len(n);
            if (n.type === 'note'){
              segs.push({ t0: t, t1: t + d, k: key(n), tied: !!n.tied, ly: n.lyric || '' });
              if (n.divisi) segs.push({ t0: t, t1: t + d, k: key(n.divisi), tied: !!n.divisi.tied, ly: '' });
            }
            t += d;
          });
          const out = [], used = new Set();
          segs.forEach((g, i) => {
            if (used.has(i)) return;
            let cur = g, end = g.t1;
            for (;;){
              if (!cur.tied) break;
              const j = segs.findIndex((h, jj) => !used.has(jj) && jj !== i && Math.abs(h.t0 - end) < 1e-6 && h.k === cur.k);
              if (j < 0) break;
              used.add(j); cur = segs[j]; end = cur.t1;
            }
            out.push(Math.round(g.t0 * 1000) / 1000 + '-' + Math.round(end * 1000) / 1000 + ':' + g.k + (g.ly ? '"' + g.ly : ''));
          });
          return out.sort().join(' ');
        });
      });
      const before = await dump();
      const xml = await page.evaluate(() => __harmonizer.buildMusicXml(__harmonizer.getSong()));
      await page.setInputFiles('#loadJsonInput', { name: 'roundtrip.musicxml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
      await page.waitForTimeout(600);
      if (!(await page.$eval('#importOverlay', el => el.hidden))){ await page.click('#importOkBtn'); await page.waitForTimeout(700); }
      await page.evaluate(() => { document.getElementById('importReportOverlay').hidden = true; });
      const after = await dump();
      const diffs = [];
      before.forEach((line, i) => {
        const b = after[i] || '';
        if (line !== b){
          const A = line.split(' '), B = new Set(b.split(' ')), Aset = new Set(A);
          const gone = A.filter(x => !B.has(x)), added = b.split(' ').filter(x => x && !Aset.has(x));
          diffs.push('stave ' + (i + 1) + ': ' + gone.length + ' note(s) changed' + (gone.length ? ', e.g. ' + gone[0] + (added.length ? ' became ' + added[0] : '') : ''));
        }
      });
      if (after.length !== before.length) diffs.push(before.length + ' staves became ' + after.length);
      console.log('   round trip through MusicXML: ' + (diffs.length ? 'DIFFERENT (' + diffs.join(', ') + ')' : 'identical'));
    }
    console.log('');
  }
  if (errors.length) console.log('JS errors: ' + JSON.stringify(errors));
  await browser.close();
  server.close();
})();
