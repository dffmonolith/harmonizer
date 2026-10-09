// sound.test.js (v3.0) -- the instrument sounds, in a real browser (Playwright + Chromium):
// banks load only when something plays them, every bank sounds at the written pitch, the
// sustained sounds really sustain (their loops hold a long note at an even level, without
// clicks), their loudness sits near the piano's, the piano itself is unchanged, the Sound
// setting (Per stave / Piano / Choir) works and is remembered, and a bank that fails to load
// falls back to the piano. Skips (exit 0) if Playwright isn't installed, like e2e.test.js.
//
//   node tests/sound.test.js                       tests whatever current.txt points at
//   node tests/sound.test.js harmonizer-3.0.html
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

const appDir = __dirname.replace(/[\\/]tests$/, '');
let target = process.argv[2];
if (!target) target = fs.readFileSync(path.join(appDir, 'current.txt'), 'utf8').trim();

let fails = 0, count = 0;
function check(label, cond, detail){
  count++;
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + label + (detail !== undefined ? '  [' + detail + ']' : ''));
  if (!cond) fails++;
}
function section(t){ console.log('\n=== ' + t + ' ==='); }

function serveDir(dir){
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const p = decodeURIComponent(req.url.split('?')[0]);
      const full = path.join(dir, p);
      fs.readFile(full, (err, data) => {
        if (err){ res.writeHead(404); res.end(); return; }
        const ext = path.extname(full);
        res.writeHead(200, { 'Content-Type': ext === '.html' ? 'text/html' : ext === '.json' ? 'application/json' : 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

(async () => {
  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch (e){ console.log('SKIP: playwright is not installed -- skipping the sound tests.'); process.exitCode = 0; return; }

  const server = await serveDir(appDir);
  const base = 'http://127.0.0.1:' + server.address().port + '/' + target;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

  async function openApp(context){
    const page = await context.newPage();
    const errors = [], requests = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { const m = /harmonizer-(bank-[a-z-]+|piano-samples)\.json/.exec(r.url()); if (m) requests.push(m[1]); });
    await page.addInitScript(() => { window.__HARMONIZER_TEST__ = true; });
    await page.goto(base);
    await page.waitForTimeout(500);
    for (const [ov, btn] of [['#welcomeOverlay', '#welcomeEmptyBtn'], ['#helpOverlay', '#helpCloseBtn']]){
      if (await page.$(ov) && !(await page.$eval(ov, el => el.hidden))) await page.click(btn);
    }
    await page.waitForTimeout(150);
    return { page, errors, requests };
  }

  // Put a one-stave (or several-stave) song in place: staves = [{instrument, notes:'A4w ...'}]
  // (each stave its own rhythm), tempo in bpm.
  async function setSong(page, staves, tempo, chords){
    await page.evaluate(({ staves, tempo, chords }) => {
      const H = window.__harmonizer, song = H.getSong();
      const parse = (txt) => txt.trim().split(/\s+/).map((t, i) => {
        const m = /^([A-G])(#|b)?(\d)([whqe])$/.exec(t);
        return { id: 'x' + Math.random(), type: 'note', letter: m[1], accidental: m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0, octave: +m[3], duration: m[4], dotted: false, tuplet: null, lyric: '', tied: false };
      });
      const roles = ['S', 'A', 'T', 'B'], clefs = ['treble', 'treble', 'treble', 'bass'];
      song.parts = staves.map((s, i) => ({ id: 'P' + i, role: roles[i], clef: s.clef || clefs[i], instrument: s.instrument, notes: i ? parse(s.notes) : undefined, ownRhythm: i > 0 }));
      song.melodyPartId = 'P0';
      song.notes = parse(staves[0].notes);
      song.tempo = tempo; song.chords = chords || []; song.tempoChanges = []; song.meterChanges = [];
    }, { staves, tempo, chords });
  }

  // Render the song offline (Save .wav's renderer) and analyse it in the page: RMS per window,
  // the pitch (autocorrelation) in a window, and the biggest sample-to-sample jump relative to
  // the local level (a loop seam that doesn't join shows up as a click there).
  async function renderAndMeasure(page, windows, pitchWin){
    return page.evaluate(async ({ windows, pitchWin }) => {
      const H = window.__harmonizer;
      const buf = await H.renderSongOfflineBuffer({ channels: 1, chords: false });
      const x = buf.getChannelData(0), sr = buf.sampleRate;
      const rms = (a, b) => { let s = 0, n = 0; for (let i = Math.floor(a * sr); i < Math.min(x.length, b * sr); i++){ s += x[i] * x[i]; n++; } return n ? Math.sqrt(s / n) : 0; };
      const out = { rms: windows.map(w => rms(w[0], w[1])), length: x.length / sr };
      if (pitchWin){
        const a = Math.floor(pitchWin[0] * sr), n = Math.floor((pitchWin[1] - pitchWin[0]) * sr);
        const seg = x.subarray(a, a + n);
        const minLag = Math.floor(sr / 2000), maxLag = Math.floor(sr / 50);
        const ac = new Float64Array(maxLag + 2);
        for (let L = minLag; L <= maxLag + 1; L++){ let s = 0; for (let i = 0; i + L < seg.length; i++) s += seg[i] * seg[i + L]; ac[L] = s; }
        let mx = 0; for (let L = minLag; L <= maxLag; L++) mx = Math.max(mx, ac[L]);
        let lag = 0;
        for (let L = minLag + 1; L <= maxLag; L++) if (ac[L] > 0.85 * mx && ac[L] >= ac[L - 1] && ac[L] >= ac[L + 1]){ lag = L; break; }
        const p = 0.5 * (ac[lag - 1] - ac[lag + 1]) / (ac[lag - 1] - 2 * ac[lag] + ac[lag + 1]);
        out.freq = sr / (lag + p);
        // clicks: a steady tone is predictable from its last few dozen samples, a seam that
        // doesn't join isn't. Fit a linear predictor (order 24, Levinson) over 1.2-4.5 s -- which
        // crosses every loop seam -- and compare the largest prediction error with the typical
        // one. Good loops score under ~9 (the flute up to ~13: its waveform has one very steep, but
        // smooth, edge per cycle); a seam knocked out of line scores 20+.
        const c0 = Math.floor(1.2 * sr), c1 = Math.min(x.length, Math.floor(4.5 * sr));
        const seg2 = Array.from(x.subarray(c0, c1)), N = seg2.length, P = 24;
        const mean = seg2.reduce((u, v) => u + v, 0) / N; for (let i = 0; i < N; i++) seg2[i] -= mean;
        const r = new Float64Array(P + 1);
        for (let k = 0; k <= P; k++){ let s2 = 0; for (let i = 0; i + k < N; i++) s2 += seg2[i] * seg2[i + k]; r[k] = s2; }
        let A = new Float64Array(P + 1); A[0] = 1; let E = r[0];
        for (let i = 1; i <= P; i++){
          let acc = r[i]; for (let j = 1; j < i; j++) acc += A[j] * r[i - j];
          const k = -acc / E, nA = A.slice();
          for (let j = 1; j <= i; j++) nA[j] = A[j] + k * A[i - j];
          A = nA; E *= (1 - k * k);
        }
        let emax = 0, esum = 0;
        for (let i = P; i < N; i++){ let e = 0; for (let j = 0; j <= P; j++) e += A[j] * seg2[i - j]; emax = Math.max(emax, Math.abs(e)); esum += e * e; }
        out.jumpRatio = emax / Math.sqrt(esum / (N - P));
      }
      return out;
    }, { windows, pitchWin });
  }
  const midiFreq = m => 440 * Math.pow(2, (m - 69) / 12);
  const cents = (f, g) => 1200 * Math.log2(f / g);

  // ---------------------------------------------------------------------------------------
  section('Loading only what plays');
  const ctxA = await browser.newContext();
  let { page, errors, requests } = await openApp(ctxA);
  check('opening the app fetches no sound at all', requests.length === 0, requests.join(','));
  await page.evaluate(() => { localStorage.removeItem('harmonizer.soundMode'); window.__harmonizer.setSoundMode('staves'); });
  check('a new browser starts with Sound = Per stave', (await page.evaluate(() => window.__harmonizer.getSoundMode())) === 'staves');
  await setSong(page, [{ instrument: 'Choir Aahs', notes: 'A4w' }], 30);
  let m = await renderAndMeasure(page, [[0.3, 1.0], [3.0, 4.0], [6.5, 7.5]], [2.0, 3.0]);
  check('a choir-only song loads the choir sound and nothing else (not even the piano)', requests.join(',') === 'bank-choir-aah', requests.join(','));
  check('Choir Aahs A4 sounds at 440 Hz (within 10 cents)', Math.abs(cents(m.freq, 440)) < 10, m.freq.toFixed(1) + ' Hz');
  check('a long choir note holds its level: 8 s whole note, end within 3 dB of the start', m.rms[2] > 0.7 * m.rms[0] && m.rms[1] > 0.7 * m.rms[0], m.rms.map(v => v.toFixed(4)).join(' / '));
  check('no click where the choir loop joins (largest prediction error under 15x the typical one)', m.jumpRatio < 15, m.jumpRatio.toFixed(3));
  const choirLevel = m.rms[1];

  await setSong(page, [{ instrument: 'Piano', notes: 'A4w' }], 30);
  m = await renderAndMeasure(page, [[0.05, 0.55], [6.5, 7.5]], [0.1, 0.6]);
  check('switching a stave to Piano loads the piano then', requests.indexOf('piano-samples') >= 0);
  check('the piano still fades as a piano does (last second far quieter than the first)', m.rms[1] < 0.25 * m.rms[0], m.rms.map(v => v.toFixed(4)).join(' / '));
  check('piano A4 still sounds at 440 Hz', Math.abs(cents(m.freq, 440)) < 10, m.freq.toFixed(1) + ' Hz');
  check('a held choir note sits near the piano’s strike in loudness (0.35 to 1.4 of it)', choirLevel > 0.35 * m.rms[0] && choirLevel < 1.4 * m.rms[0], (choirLevel / m.rms[0]).toFixed(2));

  // ---------------------------------------------------------------------------------------
  section('Every sound at the written pitch, sustaining, at a sensible level');
  const pitches = [['C3', 48, 'bass'], ['G3', 55, 'bass'], ['C4', 60, 'treble'], ['E4', 64, 'treble'], ['A4', 69, 'treble'], ['D5', 74, 'treble'], ['G5', 79, 'treble']];
  for (const inst of ['Choir Aahs', 'Organ', 'Strings', 'Flute']){
    let worst = 0, octaveOk = true, holdOk = true, clickOk = true, levels = [], jumps = [];
    for (const [name, midi, clef] of pitches){
      if (inst === 'Flute' && midi < 60) continue;                   // below the flute's range
      await setSong(page, [{ instrument: inst, notes: name + 'w', clef }], 40);
      const r = await renderAndMeasure(page, [[0.4, 1.4], [4.0, 5.0]], [1.5, 2.5]);
      const c = cents(r.freq, midiFreq(midi));
      worst = Math.max(worst, Math.abs(c));
      if (Math.abs(c) > 50) octaveOk = false;
      if (!(r.rms[1] > 0.6 * r.rms[0])) holdOk = false;
      if (!(r.jumpRatio < 15)) clickOk = false;
      jumps.push(name + ':' + r.jumpRatio.toFixed(2));
      levels.push(r.rms[0]);
    }
    check(inst + ': every test note at the written pitch and octave (worst ' + worst.toFixed(1) + ' cents)', octaveOk && worst < 12);
    check(inst + ': every test note holds its level through a 6 s note', holdOk);
    check(inst + ': no loop clicks', clickOk, jumps.join(' '));
    const lo = Math.min.apply(null, levels), hi = Math.max.apply(null, levels);
    check(inst + ': even level across the range (loudest within 2.5x the quietest)', hi < 2.5 * lo, (hi / lo).toFixed(2));
  }
  // and the click check itself: knock one loop point out of line and it must notice
  await setSong(page, [{ instrument: 'Organ', notes: 'A4w' }], 40);
  await page.evaluate(() => { const z = window.__harmonizer.getAudio().banks.organ.zones.find(z => z.lo <= 69 && z.hi >= 69); z._ls = z.loopStart; z.loopStart += 37 / 44100; });
  m = await renderAndMeasure(page, [[0.4, 1.4]], [1.5, 2.5]);
  await page.evaluate(() => { const z = window.__harmonizer.getAudio().banks.organ.zones.find(z => z.lo <= 69 && z.hi >= 69); z.loopStart = z._ls; });
  check('(the click check catches a loop that doesn’t join)', m.jumpRatio > 15, m.jumpRatio.toFixed(2));
  check('no page errors so far', errors.length === 0, errors.join(' | '));

  // ---------------------------------------------------------------------------------------
  section('The Sound setting');
  await setSong(page, [{ instrument: 'Piano', notes: 'C5w' }, { instrument: 'Organ', notes: 'E4w' }], 60);
  let ids = await page.evaluate(() => { const H = window.__harmonizer, s = H.getSong(); return s.parts.map(p => H.bankIdForPart(p)); });
  check('Per stave: each stave plays its own Instrument', ids.join(',') === 'piano,organ', ids.join(','));
  await page.evaluate(() => window.__harmonizer.setSoundMode('choir'));
  ids = await page.evaluate(() => { const H = window.__harmonizer, s = H.getSong(); return s.parts.map(p => H.bankIdForPart(p)); });
  check('Choir: every stave plays Choir Aahs, whatever its Instrument says', ids.join(',') === 'choir-aah,choir-aah');
  check('Choir: chords still need the piano', (await page.evaluate(() => { const H = window.__harmonizer; H.getSong().chords = [{ id: 'c1', beat: 0, root: { letter: 'C', accidental: 0 }, quality: 'maj' }]; return H.banksForSong(true).join(','); })) === 'choir-aah,piano');
  await page.evaluate(() => window.__harmonizer.setSoundMode('piano'));
  ids = await page.evaluate(() => { const H = window.__harmonizer, s = H.getSong(); return s.parts.map(p => H.bankIdForPart(p)); });
  check('Piano: every stave plays piano (the 2.43 behaviour)', ids.join(',') === 'piano,piano');
  // the switch in the play window, its shortcut, and that it's remembered
  await page.evaluate(() => window.__harmonizer.setSoundMode('staves'));
  await page.click('#playBtn');
  await page.waitForTimeout(600);
  await page.click('#playSoundSeg button[data-sound="choir"]');
  await page.waitForTimeout(300);
  check('clicking Choir in the play window selects it', (await page.$eval('#playSoundSeg button[data-sound="choir"]', b => b.getAttribute('aria-pressed'))) === 'true'
    && (await page.evaluate(() => window.__harmonizer.getSoundMode())) === 'choir');
  check('changing Sound while playing keeps playing', await page.evaluate(() => !document.getElementById('playModalPlayBtn').textContent.match(/Play|Resume/)));
  await page.keyboard.press('v');
  await page.waitForTimeout(300);
  check('V moves on to the next Sound (Choir -> Per stave)', (await page.evaluate(() => window.__harmonizer.getSoundMode())) === 'staves');
  await page.keyboard.press('v');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('the Sound choice is remembered in this browser', (await page.evaluate(() => localStorage.getItem('harmonizer.soundMode'))) === 'piano');
  await page.reload(); await page.waitForTimeout(600);
  check('… and comes back after a reload', (await page.evaluate(() => window.__harmonizer.getSoundMode())) === 'piano');
  await page.evaluate(() => window.__harmonizer.setSoundMode('staves'));
  check('no page errors in the play window', errors.length === 0, errors.join(' | '));

  // ---------------------------------------------------------------------------------------
  section('Instrument names');
  const names = await page.evaluate(() => {
    const H = window.__harmonizer, t = {
      'Piano': 'piano', 'Acoustic Grand Piano': 'piano', 'Harpsichord': 'piano', 'Guitar': 'piano', 'Harp': 'piano', 'Electric Bass': 'piano',
      'Choir Aahs': 'choir-aah', 'Choir Oohs': 'choir-aah', 'Voice': 'choir-aah', 'Voice Oohs': 'choir-aah', 'Soprano': 'choir-aah', 'Alto': 'choir-aah', 'Tenor': 'choir-aah', 'Bass': 'choir-aah', 'Baritone': 'choir-aah', 'S': 'choir-aah',
      'Organ': 'organ', 'Church Organ': 'organ', 'Pipe Organ': 'organ', 'Reed Organ': 'organ',
      'Strings': 'strings', 'String Ensemble 1': 'strings', 'Violin': 'strings', 'Viola': 'strings', 'Cello': 'strings', 'Double Bass': 'strings', 'Contrabass': 'strings',
      'Flute': 'flute', 'Piccolo': 'flute', 'Recorder': 'flute', 'Oboe': 'flute', 'Clarinet': 'flute', 'Bass Clarinet': 'flute', 'Bassoon': 'flute', 'Tenor Sax': 'flute', 'Alto Sax': 'flute',
      'Trumpet': 'organ', 'French Horn': 'organ', 'Trombone': 'organ', 'Bass Trombone': 'organ',
      'Kazoo': 'piano', '': 'piano'
    };
    return Object.keys(t).filter(k => H.bankIdForLabel(k) !== t[k]).map(k => k + ' -> ' + H.bankIdForLabel(k) + ' (wanted ' + t[k] + ')');
  });
  check('instrument names map to the right sound (voices, GM names, look-alikes like Tenor Sax and Double Bass)', names.length === 0, names.join('; '));
  check('a MusicXML/MIDI program is guessed from the sound for names not in the table (Voice Oohs -> 53, Viola -> 49)',
    await page.evaluate(() => window.__harmonizer.gmProgramFor('Voice Oohs') === 53 && window.__harmonizer.gmProgramFor('Viola') === 49 && window.__harmonizer.gmProgramFor('Kazoo') === 1));
  await ctxA.close();

  // ---------------------------------------------------------------------------------------
  section('A sound that fails to load');
  const ctxB = await browser.newContext();
  await ctxB.route(/harmonizer-bank-flute\.json/, r => r.fulfill({ status: 404, body: '' }));
  ({ page, errors, requests } = await openApp(ctxB));
  await page.evaluate(() => window.__harmonizer.setSoundMode('staves'));
  await setSong(page, [{ instrument: 'Flute', notes: 'A4w' }], 60);
  m = await renderAndMeasure(page, [[0.05, 0.5]], [0.1, 0.6]);
  const status = await page.evaluate(() => window.__harmonizer.getStatus());
  check('the stave falls back to the piano and still sounds, at its pitch', m.rms[0] > 0.01 && Math.abs(cents(m.freq, 440)) < 10, m.rms[0].toFixed(4) + ', ' + (m.freq || 0).toFixed(1) + ' Hz');
  check('the status line says which sound didn’t load and that it’s playing on piano', /Flute/.test(status) && /piano/.test(status), status);
  check('no page errors when a sound is missing', errors.length === 0, errors.join(' | '));
  await ctxB.close();

  await browser.close(); server.close();
  console.log('\n' + count + ' checks, ' + fails + ' failure(s).');
  process.exitCode = fails ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
