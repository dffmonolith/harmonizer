// e2e.test.js -- optional real-browser smoke test, covering what logic.test.js can't: the
// actual static HTML/CSS (collapsible sections, icon rail) and real user interactions
// (clicks, keyboard shortcuts). Requires Playwright with a Chromium build available; skip
// this file (run-all.js does so automatically) if that's not set up.
//
// Usage:
//   npm install playwright              (once; downloads a Chromium build)
//   node tests/e2e.test.js              tests whatever current.txt points at
//   node tests/e2e.test.js harmonizer-2.9.html
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

const appDir = __dirname.replace(/[\\/]tests$/, '');
let target = process.argv[2];
if (!target) target = fs.readFileSync(path.join(appDir, 'current.txt'), 'utf8').trim();

let fails = 0, count = 0;
function check(label, cond){
  count++;
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + label);
  if (!cond) fails++;
}

function serveDir(dir){
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/' + target;
      if (p === '/favicon.ico'){ res.writeHead(204); res.end(); return; }
      const full = path.join(dir, p);
      fs.readFile(full, (err, data) => {
        if (err){ res.writeHead(404); res.end(); return; }
        const ext = path.extname(full);
        const type = ext === '.html' ? 'text/html' : ext === '.json' ? 'application/json' : 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': type });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

(async () => {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (e){
    console.log('SKIP: playwright is not installed (npm install playwright) -- skipping the browser smoke test.');
    process.exitCode = 0;
    return;
  }

  // v2.15: serve the folder ABOVE the app, so the app's ../data/ examples folder is reachable
  const server = await serveDir(path.dirname(appDir));
  const appBase = '/' + path.basename(appDir) + '/';
  const port = server.address().port;
  const executablePath = process.env.CHROMIUM_PATH || undefined; // let Playwright find its own if unset

  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  // (without a ../data/ folder the app's one look for data/index.json 404s -- expected, not an error)
  const noDataFolder = !fs.existsSync(path.join(path.dirname(appDir), 'data'));
  page.on('console', msg => { if (msg.type() === 'error' && !/favicon/.test(msg.text()) && !(noDataFolder && /Failed to load resource/.test(msg.text()))) errors.push('CONSOLE: ' + msg.text()); });

  await page.goto('http://127.0.0.1:' + port + appBase + target);
  // v2.28: an import that loses anything opens the Import report -- close it before going on
  const hasReport = async () => !!(await page.$('#importReportOverlay'));
  async function closeReport(){ if ((await hasReport()) && !(await page.$eval('#importReportOverlay', el => el.hidden))){ await page.click('#importReportOkBtn'); await page.waitForTimeout(100); } }
  await page.waitForTimeout(400);
  await page.waitForTimeout(400);
  // v2.15: with no music at all, a welcome dialog offers the examples in ../data/ (when that
  // folder exists next to the app, as it does in the real site); otherwise Help opens as before
  const welcomeShown = await page.$eval('#welcomeOverlay', el => !el.hidden);
  const hasData = fs.existsSync(path.join(path.dirname(appDir), 'data'));
  if (hasData){
    check('with no songs yet, a welcome dialog offers the examples', welcomeShown && (await page.$$eval('#welcomeList button', els => els.length)) >= 1);
    check('the Examples menu is in the header', !(await page.$eval('#examplesWrap', el => el.hidden)));
  }
  if (welcomeShown) await page.click('#welcomeEmptyBtn');
  const helpVisible = await page.$eval('#helpOverlay', el => !el.hidden);
  if (helpVisible) await page.click('#helpCloseBtn');
  await page.waitForTimeout(150);

  // ---- build a melody via the Melody Text box, so this test needs no external fixture file ----
  await page.click('.acc-strip[data-acc-toggle="notes"]');
  await page.waitForTimeout(150);
  await page.click('#sideRail button[data-rail="melody"]');
  await page.waitForTimeout(200);
  await page.fill('#melodyText', 'C4q D4q E4q F4q G4h');
  await page.click('#applyTextBtn');
  await page.waitForTimeout(300);
  let noteCount = await page.$$eval('#staffSvg .note-group', els => els.length);
  check('typing into Melody Text and clicking Apply produces notes on the staff', noteCount === 5);

  // ---- collapsible sections: single-open accordion ----
  await page.click('#sideSlideoutClose');
  await page.click('.acc-strip[data-acc-toggle="chords"]');
  await page.waitForTimeout(200);
  let openItems = await page.$$eval('#toolAccordion .acc-item.open', els => els.map(e => e.getAttribute('data-acc')));
  check('opening one accordion strip closes the others', openItems.length === 1 && openItems[0] === 'chords');
  await page.click('.acc-strip[data-acc-toggle="chords"]');
  await page.waitForTimeout(200);
  openItems = await page.$$eval('#toolAccordion .acc-item.open', els => els.length);
  check('clicking an open strip again closes it', openItems === 0);

  // ---- icon rail: click a note, Inspector auto-opens ----
  const firstNote = await page.$('#staffSvg .note-group');
  await firstNote.click();
  await page.waitForTimeout(200);
  let slideOpen = await page.$eval('#sideSlideout', el => el.classList.contains('open'));
  let activePane = slideOpen ? await page.$eval('.rail-pane.active', el => el.getAttribute('data-rail-pane')) : null;
  check('clicking a note auto-opens the Inspector rail panel', slideOpen && activePane === 'inspector');
  await page.click('#sideSlideoutClose');

  // ---- undo / redo ----
  const undoBtnDisabled = await page.$eval('#undoBtn', el => el.disabled);
  check('Undo is enabled after edits have happened', undoBtnDisabled === false);

  noteCount = await page.$$eval('#staffSvg .note-group', els => els.length);
  await page.click('#staffSvg .note-group'); // select the first note
  await page.waitForTimeout(150);
  const deleteBtnVisible = await page.$eval('#deleteNoteBtn', el => el.offsetParent !== null || true); // accordion may be closed; just click via JS
  await page.click('.acc-strip[data-acc-toggle="notes"]');
  await page.waitForTimeout(150);
  await page.click('#staffSvg .note-group'); // re-select now that the strip is open
  await page.click('#deleteNoteBtn');
  await page.waitForTimeout(200);
  let afterDelete = await page.$$eval('#staffSvg .note-group', els => els.length);
  check('deleting a note reduces the note count by one', afterDelete === noteCount - 1);

  await page.evaluate(() => document.activeElement && document.activeElement.blur()); // make sure focus isn't in a text field before the shortcut (v2.23: not a click -- the page centre is now on a stave)
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(250);
  let afterUndo = await page.$$eval('#staffSvg .note-group', els => els.length);
  check('Ctrl+Z restores the deleted note', afterUndo === noteCount);

  await page.keyboard.press('Control+y');
  await page.waitForTimeout(250);
  let afterRedo = await page.$$eval('#staffSvg .note-group', els => els.length);
  check('Ctrl+Y re-deletes it (redo)', afterRedo === noteCount - 1);

  const redoBtnDisabled = await page.$eval('#redoBtn', el => el.disabled);
  check('Redo is disabled once the redo stack is exhausted', redoBtnDisabled === true);

  // ---- Instrument field, Settings modal, Save .wav / Print buttons (v2.10) ----
  const instCount = await page.$$eval('#partsBar input[list="instrumentPresetsList"]', els => els.length);
  check('each stave in the parts bar has an Instrument field', instCount >= 1);


  await page.click('#settingsBtn');
  await page.waitForTimeout(150);
  let settingsVisible = await page.$eval('#settingsOverlay', el => !el.hidden);
  check('the gear icon opens the Settings modal', settingsVisible);
  const paperInModal = await page.$('#settingsOverlay #paperToggle');
  check('Black on white lives in the Settings modal', !!paperInModal);
  await page.click('#settingsCloseBtn');
  await page.waitForTimeout(150);
  settingsVisible = await page.$eval('#settingsOverlay', el => !el.hidden);
  check('closing Settings hides the modal again', !settingsVisible);

  const wavBtn = await page.$('#saveWavBtn');
  const printBtnEl = await page.$('#printBtn');
  check('Save .wav and Print / PDF buttons are in the header', !!wavBtn && !!printBtnEl);

  // ---- v2.11: pointer-event dragging (touch as well as mouse) ----
  const melBefore = await page.$eval('#melodyText', el => el.value);
  const dragged = await page.evaluate(() => {
    const g = document.querySelector('#staffSvg .note-group');
    if (!g) return false;
    const r = g.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const opts = (yy) => ({ bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, clientX: x, clientY: yy });
    g.dispatchEvent(new PointerEvent('pointerdown', opts(y)));
    document.dispatchEvent(new PointerEvent('pointermove', opts(y - 12)));
    document.dispatchEvent(new PointerEvent('pointermove', opts(y - 24)));
    document.dispatchEvent(new PointerEvent('pointerup', opts(y - 24)));
    return true;
  });
  await page.waitForTimeout(250);
  const melAfter = await page.$eval('#melodyText', el => el.value);
  check('a touch (pointer) drag on a notehead re-pitches it', dragged && melAfter !== melBefore);
  const touchAction = await page.$eval('#staffSvg .note-group', el => getComputedStyle(el).touchAction);
  check('noteheads opt out of touch scrolling so a finger-drag edits instead', touchAction === 'none');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(250);
  check('the whole drag undoes as one step', (await page.$eval('#melodyText', el => el.value)) === melBefore);

  // ---- v2.11: a failed save is visible, and clears on the next good save ----
  await page.evaluate(() => {
    window.__realSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(){ const e = new DOMException('full', 'QuotaExceededError'); throw e; };
  });
  await page.fill('#titleInput', 'Quota test');
  await page.waitForTimeout(700);
  check('a failed autosave shows the warning in the status bar', await page.$eval('#saveWarning', el => !el.hidden && /storage full/.test(el.textContent)));
  await page.evaluate(() => { Storage.prototype.setItem = window.__realSetItem; });
  await page.fill('#titleInput', 'Quota test 2');
  await page.waitForTimeout(700);
  check('the warning clears once saving works again', await page.$eval('#saveWarning', el => el.hidden));

  // ---- v2.11: Export library from Settings ----
  await page.click('#settingsBtn');
  await page.waitForTimeout(150);
  check('Settings shows how many songs are stored', /song/.test(await page.$eval('#libraryInfo', el => el.textContent)));
  const [libDl] = await Promise.all([ page.waitForEvent('download'), page.click('#exportLibraryBtn') ]);
  const libJson = JSON.parse(fs.readFileSync(await libDl.path(), 'utf8'));
  check('Export library downloads a backup holding the songs', libJson.format === 'harmonizer-library' && libJson.entries.length >= 1 &&
    libJson.entries.some(e => e.song.title === 'Quota test 2'));
  await page.click('#settingsCloseBtn');
  await page.waitForTimeout(150);

  // ---- v2.11: rehearsal tracks (real offline render through the piano samples) ----
  // v2.21: Rehearsal tracks lives in the Save menu now
  await page.click('#saveMenuBtn');
  await page.waitForTimeout(100);
  await page.click('#rehearsalBtn');
  await page.waitForTimeout(150);
  check('Rehearsal tracks opens its dialog', await page.$eval('#rehearsalOverlay', el => !el.hidden));
  check('the dialog lists the voices with notes', (await page.$$eval('#rehearsalParts input', els => els.length)) >= 1);
  const [zipDl] = await Promise.all([ page.waitForEvent('download', { timeout: 60000 }), page.click('#rehearsalGoBtn') ]);
  const zipBuf = fs.readFileSync(await zipDl.path());
  const zname = zipDl.suggestedFilename();
  // count local file headers and check each stored member is a WAV
  let members = 0, wavs = 0;
  for (let i = 0; i + 30 < zipBuf.length; ){
    if (zipBuf.readUInt32LE(i) !== 0x04034b50) break;
    const size = zipBuf.readUInt32LE(i + 18), nlen = zipBuf.readUInt16LE(i + 26), elen = zipBuf.readUInt16LE(i + 28);
    const dataAt = i + 30 + nlen + elen;
    members++;
    if (zipBuf.toString('ascii', dataAt, dataAt + 4) === 'RIFF' && zipBuf.toString('ascii', dataAt + 8, dataAt + 12) === 'WAVE') wavs++;
    i = dataAt + size;
  }
  check('rehearsal tracks download as one .zip', /rehearsal tracks\.zip$/.test(zname));
  check('the zip holds one WAV per voice plus the full mix', members >= 2 && wavs === members);
  await page.click('#rehearsalCancelBtn');
  await page.waitForTimeout(150);

  // ---- v2.11: loop + practice speed in the play window ----
  await page.click('#playBtn');
  await page.waitForTimeout(600);
  await page.click('#playModalStopBtn');
  await page.waitForTimeout(150);
  check('the play window has a Loop button, off by default', (await page.$eval('#playLoopBtn', el => el.getAttribute('aria-pressed'))) === 'false');
  await page.keyboard.press('l');
  await page.waitForTimeout(100);
  check('L toggles Loop on', (await page.$eval('#playLoopBtn', el => el.getAttribute('aria-pressed'))) === 'true');
  check('the loop range is shown', /Looping/.test(await page.$eval('#playLoopInfo', el => el.textContent)));
  await page.$eval('#playSpeedRange', el => { el.value = '80'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(100);
  check('the speed slider shows percent and effective tempo', /^80%.*bpm/.test(await page.$eval('#playSpeedLabel', el => el.textContent)));
  await page.keyboard.press(']');
  await page.waitForTimeout(100);
  check('] nudges the speed up by 5%', /^85%/.test(await page.$eval('#playSpeedLabel', el => el.textContent)));
  // a looped pass comes round again rather than stopping: 5 quarter notes at 96 bpm x 0.85 is ~3.7 s
  await page.click('#playModalPlayBtn');
  await page.waitForTimeout(5200);
  check('with Loop on, playback keeps going past the end of the range', await page.evaluate(() => !document.getElementById('playModalStopBtn').disabled));
  await page.keyboard.press('l');
  await page.click('#playModalStopBtn');
  await page.waitForTimeout(150);
  await page.click('#playCloseBtn');
  await page.waitForTimeout(150);

  // ---- v2.12: Generate parts style preset ----
  await page.selectOption('#staveCountSelect', '4');
  await page.waitForTimeout(250);
  const styleOpts = await page.$$eval('#harmonyStyleSelect option', os => os.map(o => o.value).join(','));
  check('Generate parts has a style dropdown with Close / Traditional / Open', styleOpts === 'close,hymn,open');
  await page.selectOption('#harmonyStyleSelect', 'hymn');
  await page.waitForTimeout(150);
  check('picking a style says what it does', /Traditional \(hymn\)/.test(await page.$eval('#statusText', el => el.textContent)));
  // ---- v2.32: Generate parts refines the draft; Refine parts and the Refine report ----
  await page.click('#sideRail button[data-rail="melody"]');
  await page.waitForTimeout(200);
  await page.fill('#melodyText', 'E4q D4q C4q D4q E4q E4q E4h D4q D4q D4h E4q G4q G4h E4q D4q C4q D4q E4q E4q E4q E4q D4q D4q E4q D4q C4w');
  await page.click('#applyTextBtn');
  await page.waitForTimeout(250);
  page.once('dialog', d => d.accept().catch(() => {}));
  await page.evaluate(() => document.getElementById('suggestChordsBtn').click());
  await page.waitForTimeout(250);
  check('Refine parts sits beside Generate parts', await page.$('#refinePartsBtn') !== null);
  // v2.33: the Added notes menu beside the style menu
  check('an Added notes menu offers none / some / more', (await page.$$eval('#harmonyMotionSelect option', os => os.map(o => o.value).join(','))) === 'none,some,more');
  check('a Repeated music menu offers keep alike / vary lightly / write fresh, keep alike by default (v2.34)',
    (await page.$$eval('#harmonyRecurSelect option', os => os.map(o => o.value).join(','))) === 'same,vary,fresh' && (await page.$eval('#harmonyRecurSelect', el => el.value)) === 'same');
  await page.selectOption('#harmonyRecurSelect', 'vary');
  await page.waitForTimeout(100);
  check('picking one says what it does', /vary lightly/.test(await page.$eval('#statusText', el => el.textContent)));
  await page.selectOption('#harmonyRecurSelect', 'same');
  await page.selectOption('#harmonyMotionSelect', 'more');
  await page.waitForTimeout(100);
  check('picking an Added notes level says what it does', /More added notes/.test(await page.$eval('#statusText', el => el.textContent)));
  await page.evaluate(() => document.getElementById('generatePartsBtn').click());
  await page.waitForFunction(() => /refined:/.test(document.getElementById('statusText').textContent), null, { timeout: 15000 }).catch(() => {});
  check('Generate parts writes a draft and refines it', /refined:/.test(await page.$eval('#statusText', el => el.textContent)));
  check('...and adds notes of the voices’ own (v2.33)', /added note/.test(await page.$eval('#statusText', el => el.textContent)));
  const rrShown = await page.$eval('#refineReportBtn', el => !el.hidden);
  check('the Refine report button appears in the status bar', rrShown);
  if (rrShown){
    await page.evaluate(() => document.getElementById('refineReportBtn').click());
    await page.waitForTimeout(150);
    check('the Refine report opens with its before/after table', await page.$eval('#refineReportOverlay', el => !el.hidden) && (await page.$$eval('#refineReportBody .refine-stats tr', els => els.length)) >= 4);
    // v2.34: the report's Repeated music section -- this tune states its opening bar twice
    check('the Refine report has a Repeated music section with a line to link passages by hand (v2.34)',
      /Repeated music/.test(await page.$eval('#refineReportBody', el => el.textContent)) && await page.$('#recurAddBtn') !== null && await page.$('#recurApplyBtn') !== null);
    const recurBoxes = await page.$$('#refineReportBody input[data-recur]');
    check('...listing the repeat it found, ticked', recurBoxes.length >= 1 && await recurBoxes[0].evaluate(el => el.checked));
    if (recurBoxes.length){
      await recurBoxes[0].click();
      await page.waitForTimeout(100);
      check('unticking one says it will go its own way', /its own way/.test(await page.$eval('#recurMsg', el => el.textContent)));
      await page.click('#recurApplyBtn');
      await page.waitForFunction(() => /^Generated/.test(document.getElementById('statusText').textContent), null, { timeout: 15000 }).catch(() => {});
      check('Apply closes the report and regenerates the parts', await page.$eval('#refineReportOverlay', el => el.hidden) && /^Generated/.test(await page.$eval('#statusText', el => el.textContent)));
      await page.evaluate(() => document.getElementById('refineReportBtn').click());
      await page.waitForTimeout(150);
      const boxes2 = await page.$$('#refineReportBody input[data-recur]');
      check('...and the report now shows it unticked', boxes2.length >= 1 && !(await boxes2[0].evaluate(el => el.checked)));
      await boxes2[0].click();   // back on, for the checks below
    }
    await page.evaluate(() => document.getElementById('refineReportOkBtn').click());
    await page.waitForTimeout(100);
  }
  await page.evaluate(() => document.getElementById('refinePartsBtn').click());
  await page.waitForFunction(() => /Refine/.test(document.getElementById('statusText').textContent) && !/Refining/.test(document.getElementById('statusText').textContent), null, { timeout: 15000 }).catch(() => {});
  check('Refine parts runs on the written parts', /Refined the parts|found nothing to improve/.test(await page.$eval('#statusText', el => el.textContent)));
  check('Settings has Refine after Generate parts, on by default', await page.$eval('#refineToggle', el => el.checked));
  page.once('dialog', d => d.accept().catch(() => {}));
  await page.evaluate(() => document.getElementById('clearChordsBtn').click());
  await page.waitForTimeout(200);
  await page.click('#sideRail button[data-rail="melody"]');   // close the melody panel again, as the next section expects
  await page.waitForTimeout(200);
  await page.selectOption('#staveCountSelect', '1');
  await page.waitForTimeout(250);

  // ---- v2.12: key / tempo changes from the Selected panel ----
  await page.click('#sideRail button[data-rail="melody"]');
  await page.waitForTimeout(200);
  await page.fill('#melodyText', 'C4q D4q E4q F4q G4q F4q E4q D4q C4q D4q E4q F4q G4w');
  await page.click('#applyTextBtn');
  await page.waitForTimeout(250);
  await page.click('#sideRail button[data-rail="inspector"]');
  await page.waitForTimeout(150);
  await page.click('#staffSvg .note-group >> nth=8');
  await page.waitForTimeout(150);
  const accBefore = await page.$$eval('#staffSvg .accidental', els => els.length);
  await page.selectOption('#chgKeySelect', 'D');
  await page.fill('#chgTempoInput', '72');
  await page.click('#changesBox button.accent');
  await page.waitForTimeout(250);
  const accAfter = await page.$$eval('#staffSvg .accidental', els => els.length);
  check('a key change draws the new signature (and naturals where the old pitches now need them)', accAfter >= accBefore + 4);
  check('a tempo change is shown above the staff', /= 72/.test(await page.$$eval('#staffSvg .tempo-mark', els => els.map(e => e.textContent).join(' '))));
  check('the changes panel lists both changes', /m\. 3: Key . D major/.test(await page.$eval('#changesBox', el => el.innerText)) && /m\. 3: Tempo/.test(await page.$eval('#changesBox', el => el.innerText)));
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(250);
  check('Undo takes the key/tempo change back off', (await page.$$eval('#staffSvg .tempo-mark', els => els.length)) === 0);
  await page.keyboard.press('Control+y');
  await page.waitForTimeout(250);
  check('Redo puts it back', (await page.$$eval('#staffSvg .tempo-mark', els => els.length)) === 1);
  // playing across the tempo change runs cleanly
  await page.click('#staffSvg .note-group >> nth=6');
  await page.click('#playBtn');
  await page.waitForTimeout(2500);
  await page.click('#playModalStopBtn');
  await page.waitForTimeout(150);
  await page.click('#playCloseBtn');
  await page.waitForTimeout(150);

  // ---- v2.12: Save .mid, then open it back ----
  const [midDl] = await Promise.all([ page.waitForEvent('download'), page.click('#saveMenuBtn').then(() => page.click('#saveMidiBtn')) ]);
  const midBuf = fs.readFileSync(await midDl.path());
  check('Save .mid downloads a Standard MIDI File', midBuf.toString('ascii', 0, 4) === 'MThd' && /\.mid$/.test(midDl.suggestedFilename()));
  await page.setInputFiles('#loadJsonInput', { name: 'roundtrip.mid', mimeType: 'audio/midi', buffer: midBuf });
  await page.waitForTimeout(700);
  await closeReport();
  const midStatus = await page.$eval('#statusText', el => el.textContent);
  check('Open… reads a .mid file back in as a new song', /Imported/.test(midStatus) && /1 key change/.test(midStatus) && /1 tempo change/.test(midStatus));
  check('the reopened song has the same notes', (await page.$$eval('#staffSvg .note-group', els => els.length)) === 13);

  // ---- v2.12: MusicXML divisi, second voice, key change, dynamics on a harmony part ----
  const xmlFix = '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><work><work-title>Divisi test</work-title></work>' +
    '<part-list><score-part id="P1"><part-name>Soprano</part-name></score-part><score-part id="P2"><part-name>Alto</part-name></score-part></part-list>' +
    '<part id="P1">' +
      '<measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>' +
        '<direction><direction-type><dynamics><mf/></dynamics></direction-type></direction>' +
        '<note><pitch><step>E</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>half</type></note>' +
        '<note><chord/><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>half</type></note>' +
        '<note><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>half</type></note>' +
        '<note><chord/><pitch><step>B</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>half</type></note>' +
        '<backup><duration>4</duration></backup>' +
        '<note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><voice>2</voice><type>whole</type></note></measure>' +
      '<measure number="2"><attributes><key><fifths>2</fifths><mode>major</mode></key></attributes>' +
        '<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>60</per-minute></metronome></direction-type><sound tempo="60"/></direction>' +
        '<note><pitch><step>F</step><alter>1</alter><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type></note>' +
        '<note><chord/><pitch><step>D</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type></note>' +
        '<backup><duration>4</duration></backup>' +
        '<note><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><voice>2</voice><type>whole</type></note></measure>' +
    '</part>' +
    '<part id="P2">' +
      '<measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>' +
        '<direction><direction-type><dynamics><p/></dynamics></direction-type></direction>' +
        '<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>half</type><notations><slur type="start"/></notations></note>' +
        '<note><pitch><step>B</step><octave>3</octave></pitch><duration>2</duration><voice>1</voice><type>half</type><notations><slur type="stop"/></notations></note></measure>' +
      '<measure number="2"><attributes><key><fifths>2</fifths></key></attributes>' +
        '<note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type></note></measure>' +
    '</part></score-partwise>';
  await page.setInputFiles('#loadJsonInput', { name: 'divisi.musicxml', mimeType: 'application/xml', buffer: Buffer.from(xmlFix) });
  await page.waitForTimeout(500);
  const rowNames = await page.$$eval('#importTable tr td:nth-child(3)', tds => tds.map(t => t.textContent));
  check('divisi chord notes and a second voice are offered as separate staves',
    rowNames.some(n => /Soprano .*voice 1, upper/.test(n)) && rowNames.some(n => /voice 1, lower/.test(n)) && rowNames.some(n => /voice 2/.test(n)) && rowNames.includes('Alto'));
  // tick everything -- v2.26: with "Keep divisi on one stave" off, so the divisi comes in as two staves as before
  await page.uncheck('#importDivisiBox');
  const boxes = await page.$$('#importTable input[type=checkbox]');
  for (const b of boxes){ if (!(await b.isChecked()) && !(await b.isDisabled())) await b.check(); }
  await page.click('#importOkBtn');
  await page.waitForTimeout(500);
  await closeReport();
  const xmlStatus = await page.$eval('#statusText', el => el.textContent);
  check('the import keeps the key change and tempo change', /1 key change/.test(xmlStatus) && /1 tempo change/.test(xmlStatus));
  check('the split staves come in', /divisi notes came in as their own staves/.test(xmlStatus) && (await page.$$eval('#partsBar .part-grp', els => els.length)) === 4);

  // v2.21: one stave per line, with its controls in aligned columns
  {
    const wasOpen = await page.$eval('.acc-item[data-acc="staves"]', el => el.classList.contains('open'));
    if (!wasOpen) await page.click('.acc-strip[data-acc-toggle="staves"]');
    await page.waitForTimeout(350);
    const rows = await page.$$eval('#partsBar .part-grp', grps => grps.map(g => ({
      tops: Array.from(g.querySelectorAll('.pcell')).map(c => Math.round(c.getBoundingClientRect().top)),
      roleX: Math.round(g.querySelector('.pc-role').getBoundingClientRect().left),
      playX: Math.round(g.querySelector('.pc-play').getBoundingClientRect().left),
      melody: g.classList.contains('is-melody') })));
    check('Staves: each stave is on a line of its own', rows.length >= 2 && rows.every(r => new Set(r.tops).size === 1) && new Set(rows.map(r => r.tops[0])).size === rows.length);
    check('Staves: the columns line up from stave to stave', new Set(rows.map(r => r.roleX)).size === 1 && new Set(rows.map(r => r.playX)).size === 1);
    check('Staves: exactly one row is marked as the melody', rows.filter(r => r.melody).length === 1);
    if (!wasOpen) await page.click('.acc-strip[data-acc-toggle="staves"]');
    await page.waitForTimeout(300);
  }
  const dynTexts = await page.$$eval('#staffSvg .dynamic, #staffSvg text', els => els.map(e => e.textContent).filter(t => t === 'mf' || t === 'p'));
  check('dynamics show on the harmony staves too, not just the melody', dynTexts.filter(t => t === 'mf').length >= 2 && dynTexts.includes('p'));

  // ---- v2.13: range warnings and parallel marks ----
  await page.click('#newSongBtn');
  await page.waitForTimeout(200);
  await page.click('#sideRail button[data-rail="melody"]');
  await page.waitForTimeout(200);
  await page.fill('#melodyText', 'C5q D5q E5q C6q');
  await page.click('#applyTextBtn');
  await page.waitForTimeout(250);
  check('a note above the soprano range is tinted', (await page.$$eval('#staffSvg .note-group.out-of-range', els => els.length)) === 1);
  check('the tinted note explains itself on hover', /Above the Soprano/.test(await page.$eval('#staffSvg .note-group.out-of-range title', el => el.textContent)));
  await page.click('#settingsBtn');
  await page.waitForTimeout(150);
  await page.uncheck('#rangeWarnToggle');
  await page.waitForTimeout(150);
  check('range warnings can be turned off in Settings', (await page.$$eval('#staffSvg .note-group.out-of-range', els => els.length)) === 0);
  await page.check('#rangeWarnToggle');
  await page.check('#parallelsToggle');
  await page.click('#settingsCloseBtn');
  await page.waitForTimeout(150);
  // an own-rhythm bass in parallel fifths under the first three notes
  await page.selectOption('#staveCountSelect', '2');
  await page.waitForTimeout(250);
  const closeRail = await page.$('#sideSlideoutClose');
  if (closeRail && await closeRail.isVisible()) await closeRail.click();
  await page.waitForTimeout(200);
  if (!(await page.$eval('.acc-item[data-acc="staves"]', el => el.classList.contains('open')))) await page.click('.acc-strip[data-acc-toggle="staves"]');
  await page.waitForTimeout(300);
  await page.waitForTimeout(200);
  const grps = await page.$$('#partsBar .part-grp');
  const ownBox = await grps[1].$('label:has-text("Own rhythm") input');
  await ownBox.click();
  await page.waitForTimeout(300);
  // click C3, D3, E3 onto the (empty, own-rhythm) bass stave: octaves under the melody's C5 D5 E5
  const lines = await page.$$eval('#staffSvg .staffline', els => els.map(e => { const r = e.getBoundingClientRect(); return { y: r.top, x: r.left, w: r.width }; }));
  const bassBottom = lines[9].y, sp = lines[9].y - lines[8].y, sx = lines[9].x + 400;
  for (const steps of [1.5, 2, 2.5]){ await page.mouse.click(sx, bassBottom - steps * sp); await page.waitForTimeout(150); }
  // seeded with the melody's rhythm and pitches -> the bass copies the tune: parallel octaves/unisons with the melody
  const marks = await page.$$eval('#staffSvg .parallel-mark text', els => els.map(e => e.textContent));
  check('parallel octaves between two staves are marked when the option is on (' + marks.join(' ') + ')', marks.length >= 1 && marks.every(t => t === '8'));
  await page.click('#settingsBtn');
  await page.waitForTimeout(150);
  await page.uncheck('#parallelsToggle');
  await page.click('#settingsCloseBtn');
  await page.waitForTimeout(150);
  check('parallel marks go away when switched off', (await page.$$eval('#staffSvg .parallel-mark', els => els.length)) === 0);

  // ---- v2.14: Space pauses and resumes ----
  await page.click('#sideRail button[data-rail="melody"]');
  await page.waitForTimeout(200);
  await page.fill('#melodyText', 'C4q D4q E4q F4q G4q A4q B4q C5q D5q E5q F5q G5q C5w');
  await page.click('#applyTextBtn');
  await page.waitForTimeout(250);
  const rc = await page.$('#sideSlideoutClose'); if (rc && await rc.isVisible()) await rc.click();
  await page.keyboard.press('Escape');
  await page.click('#staffSvg .note-group >> nth=0');   // start from the top
  await page.click('#playBtn');
  await page.waitForTimeout(2400);
  await page.keyboard.press(' ');
  await page.waitForTimeout(200);
  const pauseStatus = await page.$eval('#statusText', el => el.textContent);
  check('Space while playing pauses', /Paused at measure/.test(pauseStatus) && (await page.$eval('#playModalStatus', el => el.textContent)) === 'Paused');
  check('the button offers Resume while paused', /Resume/.test(await page.$eval('#playModalPlayBtn', el => el.textContent)));
  const pausedX = await page.$eval('#playHeadLine', el => +el.getAttribute('x1'));
  check('the playhead stays parked at the paused spot', pausedX > 0);
  await page.keyboard.press(' ');
  await page.waitForTimeout(400);
  const resumedX = await page.$eval('#playHeadLine', el => +el.getAttribute('x1'));
  check('Space again resumes from the paused spot, not the start', (await page.$eval('#playModalStatus', el => el.textContent)) === 'Playing…' && resumedX >= pausedX - 2);
  await page.keyboard.press(' ');
  await page.waitForTimeout(200);
  // pick a later note while paused: resume starts there instead
  const tgtNote = await page.$('#staffSvg .note-group >> nth=10');
  const tx = await tgtNote.evaluate(el => el.getBBox().x);
  await tgtNote.click();
  await page.waitForTimeout(150);
  await page.keyboard.press(' ');
  await page.waitForTimeout(350);
  const fromSelX = await page.$eval('#playHeadLine', el => +el.getAttribute('x1'));
  check('a note selected while paused is where playback resumes', fromSelX >= tx - 30);
  await page.click('#playModalStopBtn');
  await page.waitForTimeout(200);
  check('Stop forgets the paused spot (button back to Play)', /Play/.test(await page.$eval('#playModalPlayBtn', el => el.textContent)) && !/Resume/.test(await page.$eval('#playModalPlayBtn', el => el.textContent)));
  // v2.22: Jump to beginning moves the play position, beating both a paused spot and a note
  // selected earlier (note 10 is still selected here -- the reported "jumps back" case)
  const n0x = await (await page.$('#staffSvg .note-group >> nth=0')).evaluate(el => el.getBBox().x);
  await page.click('#playFirstBtn');
  await page.waitForTimeout(150);
  check('Jump to beginning marks the play window Ready', (await page.$eval('#playModalStatus', el => el.textContent)) === 'Ready' && /Ready at measure/.test(await page.$eval('#statusText', el => el.textContent)));
  await page.keyboard.press(' ');
  await page.waitForTimeout(350);
  const fromTopX = await page.$eval('#playHeadLine', el => +el.getAttribute('x1'));
  check('after Stop + Jump to beginning, Play starts from the top (not the earlier selected note)', fromTopX < tx - 60 && fromTopX <= n0x + 40);
  await page.waitForTimeout(1200);
  await page.keyboard.press(' ');   // pause part-way
  await page.waitForTimeout(200);
  await page.click('#playFirstBtn');
  await page.waitForTimeout(150);
  check('Jump to beginning while paused replaces Resume with Play', !/Resume/.test(await page.$eval('#playModalPlayBtn', el => el.textContent)));
  await page.keyboard.press(' ');
  await page.waitForTimeout(350);
  const fromTop2X = await page.$eval('#playHeadLine', el => +el.getAttribute('x1'));
  check('after Pause + Jump to beginning, Play starts from the top (not the paused spot)', fromTop2X <= n0x + 40);
  await page.keyboard.press(' ');
  await page.waitForTimeout(200);
  await page.keyboard.press('End');
  await page.waitForTimeout(150);
  const endX = await page.$eval('#playHeadLine', el => +el.getAttribute('x1'));
  await page.keyboard.press(' ');
  await page.waitForTimeout(350);
  const fromEndX = await page.$eval('#playHeadLine', el => +el.getAttribute('x1'));
  check('End (Jump to end) then Play starts in the last measure', endX > tx && fromEndX >= endX - 5);
  await page.click('#playModalStopBtn');
  await page.waitForTimeout(200);
  check('Stop clears a jump mark too', (await page.$eval('#playModalStatus', el => el.textContent)) === 'Stopped');
  await page.click('#playCloseBtn');
  await page.waitForTimeout(150);

  // ---- v2.15: Save menu and Examples menu ----
  await page.click('#saveMenuBtn');
  await page.waitForTimeout(100);
  const saveItems = await page.$$eval('#saveMenu button', els => els.map(e => e.id).join(','));
  check('Save is one menu with .json, .musicxml, .mid, .wav and Rehearsal tracks', saveItems === 'saveJsonBtn,saveMusicXmlBtn,saveMidiBtn,saveWavBtn,rehearsalBtn' && !(await page.$eval('#saveMenu', el => el.hidden)));
  // v2.39: one navbar (title + file/app commands), one song-settings line, Play/Undo/Redo above the score
  check('the navbar holds the New / Open / Save / Print / Settings / Help commands (and not the song title)', await page.$$eval('.app-nav', els => els.length === 1 && !els[0].querySelector('#titleInput') && ['newSongBtn','loadJsonBtn','saveMenuBtn','printBtn','settingsBtn','helpBtn'].every(id => els[0].querySelector('#' + id))));
  check('the song settings sit on one line below the navbar', await page.$$eval('.song-line', els => els.length === 1 && ['songSelect','composerInput','keySelect','transposeSelect','staveCountSelect','timeSigNum','tempoInput'].every(id => els[0].querySelector('#' + id))) && await page.$eval('.song-line', el => el.getBoundingClientRect().height < 50));
  check('Play, Undo and Redo sit on the bar just above the score, and there is no Stop button', await page.evaluate(() => { const bar = document.getElementById('scoreBar'); return !!bar && ['playBtn','undoBtn','redoBtn','titleInput'].every(id => bar.contains(document.getElementById(id))) && !document.getElementById('stopBtn') && bar.compareDocumentPosition(document.getElementById('staffScroll')) & Node.DOCUMENT_POSITION_FOLLOWING && document.getElementById('toolAccordion').compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING; }));
  check('no Rehearsal tracks button left loose in the header', await page.$$eval('.app-header button', els => !els.some(b => /Rehearsal/.test(b.textContent) && !b.closest('.menu'))));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  check('Esc closes the menu', await page.$eval('#saveMenu', el => el.hidden));
  const [jsonDl] = await Promise.all([ page.waitForEvent('download'), page.click('#saveMenuBtn').then(() => page.click('#saveJsonBtn')) ]);
  check('Save ▾ → as .json downloads the song', /\.json$/.test(jsonDl.suggestedFilename()) && await page.$eval('#saveMenu', el => el.hidden));
  if (hasData){
    await page.click('#examplesBtn');
    await page.waitForTimeout(100);
    const exItems = await page.$$('#examplesMenu button');
    check('the Examples menu lists the files in data/', exItems.length >= 1);
    await exItems[0].click();
    await page.waitForTimeout(900);
    if (!(await page.$eval('#importOverlay', el => el.hidden))){
      check('v2.43: the import dialog for a MIDI example is titled "Import MIDI file"', (await page.$eval('#importTitle', el => el.textContent)) === 'Import MIDI file');
      await page.click('#importOkBtn'); await page.waitForTimeout(600);
    }
    await closeReport();
    check('choosing an example opens it as a new song', /Imported/.test(await page.$eval('#statusText', el => el.textContent)) && (await page.$$eval('#staffSvg .note-group', els => els.length)) > 20);
    // v2.16: the example's menu title ("Composer — Title") names the song above the score
    const stTitle = await page.$eval('#titleInput', el => el.value), stComp = await page.$eval('#scoreComposerText', el => el.textContent);
    check('the song title and composer show above the score', stTitle.length > 0 && stComp.length > 0 && !/\.mid/i.test(stTitle));
    await page.click('#playBtn');
    await page.waitForTimeout(400);
    check('the play window shows the title and composer too', (await page.$eval('#playModalTitle', el => el.textContent)).indexOf(stComp) >= 0);
    await page.keyboard.press(' ');
    await page.click('#playCloseBtn');
    await page.waitForTimeout(150);
    // v2.17: printing a long example lays it out in several page-width lines
    const sysCount = await page.evaluate(() => { window.dispatchEvent(new Event('beforeprint')); return document.querySelectorAll('#printScore .print-sys').length; });
    const leadClefs = await page.$$eval('#printScore .print-sys:nth-child(2) .clef', els => els.length);
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    check('Print lays a long piece out in several lines', sysCount >= 3);
    check('each later line starts with its own clefs', leadClefs >= 1);
  }

  // ---- v2.23: expressive marks -- MusicXML import, the Marks row, the play window's Section ----
  const marksXml = '<?xml version="1.0"?><score-partwise version="3.1"><work><work-title>Marks</work-title></work>' +
    '<part-list><score-part id="P1"><part-name>Soprano</part-name></score-part></part-list><part id="P1">' +
      '<measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>' +
        '<direction placement="above"><direction-type><words>Allegro</words></direction-type><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>120</per-minute></metronome></direction-type><sound tempo="120"/></direction>' +
        '<direction placement="above"><direction-type><rehearsal>A</rehearsal></direction-type></direction>' +
        '<direction placement="above"><direction-type><words>hum</words></direction-type></direction>' +
        '<direction placement="below"><direction-type><wedge type="crescendo"/></direction-type></direction>' +
        '<note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><notations><articulations><staccato/></articulations></notations></note>' +
        '<note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>' +
        '<direction placement="below"><direction-type><wedge type="stop"/></direction-type></direction>' +
        '<note><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><notations><articulations><accent/><breath-mark/></articulations></notations></note>' +
        '<note><pitch><step>F</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note></measure>' +
      '<measure number="2">' +
        '<direction placement="above"><direction-type><rehearsal>B</rehearsal></direction-type></direction>' +
        '<direction placement="above"><direction-type><words>rit.</words></direction-type><direction-type><dashes type="start"/></direction-type></direction>' +
        '<note><pitch><step>G</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>half</type></note>' +
        '<note><pitch><step>E</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>half</type><notations><fermata type="upright"/></notations></note>' +
        '<direction><direction-type><dashes type="stop"/></direction-type></direction></measure>' +
      '<measure number="3">' +
        '<direction placement="above"><direction-type><words>a tempo</words></direction-type></direction>' +
        '<note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type></note></measure>' +
    '</part></score-partwise>';
  await page.setInputFiles('#loadJsonInput', { name: 'marks.musicxml', mimeType: 'application/xml', buffer: Buffer.from(marksXml) });
  await page.waitForTimeout(500);
  if (!(await page.$eval('#importOverlay', el => el.hidden))){ await page.click('#importOkBtn'); await page.waitForTimeout(500); }
  await closeReport();
  const mkStatus = await page.$eval('#statusText', el => el.textContent);
  check('MusicXML import reports hairpins, fermatas, articulations, breath marks, text, rehearsal marks and tempo words',
    ['hairpins', 'fermatas', 'articulations', 'breath marks', 'text', 'rehearsal marks', 'tempo words'].every(w => mkStatus.indexOf(w) >= 0));
  const drawn = await page.evaluate(() => { const q = s => document.querySelectorAll('#staffSvg ' + s).length; return {
    fermata: q('.fermata'), artic: q('.artic') + q('.artic-dot'), breath: q('.breathmark'), wedge: q('.wedge'), text: q('.expr-text'),
    reh: Array.from(document.querySelectorAll('#staffSvg .rehearsal-text')).map(t => t.textContent).join(''),
    words: Array.from(document.querySelectorAll('#staffSvg .tempo-mark')).map(t => t.textContent).join('|') }; });
  check('the imported marks are drawn: fermata, accent + staccato, breath, hairpin, "hum"', drawn.fermata === 1 && drawn.artic === 2 && drawn.breath === 1 && drawn.wedge === 1 && drawn.text === 1);
  check('rehearsal letters A and B, Allegro, rit. and a tempo are drawn', drawn.reh === 'AB' && /Allegro/.test(drawn.words) && /rit\./.test(drawn.words) && /a tempo/.test(drawn.words));

  // the Marks row
  if (!(await page.$eval('.acc-item[data-acc="notes"]', el => el.classList.contains('open')))) await page.click('.acc-strip[data-acc-toggle="notes"]');
  await page.waitForTimeout(250);
  check('the Marks row sits under Note entry', await page.$eval('#marksBar', el => el.offsetParent !== null && !!el.closest('.acc-item[data-acc="notes"]')));
  await page.click('#staffSvg .note-group:not(.rest) >> nth=1');
  await page.click('#mkDynBtn');
  await page.waitForTimeout(120);
  const dynMenuOk = await page.evaluate(() => {
    const m = document.getElementById('mkDynMenu'); if (m.hidden) return false;
    const r = m.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + 12);
    return !!(hit && m.contains(hit));
  });
  check('the Dynamics menu opens on top of the page (not clipped by the tool section)', dynMenuOk);
  await page.click('#mkDynMenu [data-mk="dyn:ff"]');
  await page.waitForTimeout(150);
  check('choosing ff puts it under the note', (await page.$$eval('#staffSvg .dynamicmark', els => els.map(e => e.textContent))).includes('ff'));
  await page.click('#mkTenutoBtn');
  await page.keyboard.press('f');
  await page.waitForTimeout(150);
  check('Tenuto and the F key (fermata) mark the selected note, and light their buttons',
    (await page.$$eval('#staffSvg .fermata', els => els.length)) === 2 && await page.$eval('#mkTenutoBtn', el => el.classList.contains('toggled')) && await page.$eval('#mkFermataBtn', el => el.classList.contains('toggled')));
  await page.click('#mkTextBtn');
  await page.waitForTimeout(150);
  await page.fill('#inspTextInput', 'solo');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  check('Text… types into the Selected panel and draws above the stave', (await page.$$eval('#staffSvg .expr-text', els => els.map(e => e.textContent))).includes('solo'));
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);
  check('Undo takes the text back off', !(await page.$$eval('#staffSvg .expr-text', els => els.map(e => e.textContent))).includes('solo'));
  await page.click('#sideSlideoutClose').catch(() => {});

  // MusicXML export round trip keeps them
  const [mxDl] = await Promise.all([ page.waitForEvent('download'), page.click('#saveMenuBtn').then(() => page.click('#saveMusicXmlBtn')) ]);
  const mxText = fs.readFileSync(await mxDl.path(), 'utf8');
  check('Save .musicxml writes fermatas, articulations, the breath mark, hairpin, rehearsal marks and rit.',
    /<fermata/.test(mxText) && /<tenuto\/>/.test(mxText) && /<breath-mark\/>/.test(mxText) && /<wedge type="crescendo"/.test(mxText) && /<rehearsal[^>]*>B</.test(mxText) && /rit\.<\/words>/.test(mxText));

  // the play window's Section menu
  await page.click('#playBtn');
  await page.waitForTimeout(500);
  await page.click('#playModalStopBtn').catch(() => {});
  await page.waitForTimeout(150);
  check('the play window offers the rehearsal marks as sections', (await page.$$eval('#playSectionSelect option', os => os.map(o => o.textContent.split(' ')[0]).join(','))) === '—,A,B');
  await page.selectOption('#playSectionSelect', { index: 2 });
  await page.waitForTimeout(200);
  await page.click('#playLoopBtn');
  await page.waitForTimeout(100);
  check('picking B cues Play there, and Loop repeats section B', (await page.$eval('#playModalStatus', el => el.textContent)) === 'Ready' && /section B/.test(await page.$eval('#playLoopInfo', el => el.textContent)));
  await page.keyboard.press(' ');
  await page.waitForTimeout(1200);
  check('playing through the fermata and rit. runs without errors', errors.length === 0 && (await page.$eval('#playModalStatus', el => el.textContent)) === 'Playing…');
  await page.click('#playModalStopBtn');
  await page.click('#playLoopBtn');
  await page.click('#playCloseBtn');
  await page.waitForTimeout(150);

  // ---- v2.24: repeats, endings, D.S. al Fine; verses and lyric typing ----
  {
    const N = (step, oct, dur, type, extra='') => `<note><pitch><step>${step}</step><octave>${oct}</octave></pitch><duration>${dur}</duration><voice>1</voice><type>${type}</type>${extra}</note>`;
    const L = (n, syl, t, ext) => `<lyric number="${n}"><syllabic>${syl}</syllabic><text>${t}</text>${ext?'<extend/>':''}</lyric>`;
    const repXml = '<?xml version="1.0"?><score-partwise version="3.1"><work><work-title>Repeat Test</work-title></work>' +
     '<part-list><score-part id="P1"><part-name>Soprano</part-name></score-part></part-list><part id="P1">' +
     '<measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>' +
       N('C',5,1,'quarter', L(1,'begin','Twin')+L(2,'single','Up')) + N('C',5,1,'quarter', L(1,'end','kle')+L(2,'single','a-')) + N('G',5,1,'quarter', L(1,'begin','twin')+L(2,'single','bove')) + N('G',5,1,'quarter', L(1,'end','kle')+L(2,'single','the')) + '</measure>' +
     '<measure number="2"><barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline><direction><direction-type><segno/></direction-type></direction>' +
       N('A',5,1,'quarter', L(1,'begin','lit')+L(2,'single','world')) + N('A',5,1,'quarter', L(1,'end','tle')+L(2,'single','so')) + N('G',5,2,'half', L(1,'single','star',true)+L(2,'single','high')) + '</measure>' +
     '<measure number="3"><barline location="left"><ending number="1" type="start">1.</ending></barline>' +
       N('F',5,1,'quarter') + N('E',5,1,'quarter', L(1,'single','how')) + N('D',5,2,'half', L(1,'single','I')) +
       '<direction><direction-type><words>Fine</words></direction-type></direction>' +
       '<barline location="right"><bar-style>light-heavy</bar-style><ending number="1" type="stop"/><repeat direction="backward"/></barline></measure>' +
     '<measure number="4"><barline location="left"><ending number="2" type="start">2.</ending></barline>' +
       N('F',5,1,'quarter', L(1,'single','won')) + N('E',5,1,'quarter', L(1,'single','der')) + N('C',5,2,'half', L(1,'single','what')) +
       '<barline location="right"><ending number="2" type="discontinue"/></barline></measure>' +
     '<measure number="5">' + N('D',5,4,'whole', L(1,'single','you')) + '<direction><direction-type><words>D.S. al Fine</words></direction-type></direction></measure>' +
     '</part></score-partwise>';
    await page.setInputFiles('#loadJsonInput', { name: 'repeats.musicxml', mimeType: 'application/xml', buffer: Buffer.from(repXml) });
    await page.waitForTimeout(500);
    if (!(await page.$eval('#importOverlay', el => el.hidden))){ await page.click('#importOkBtn'); await page.waitForTimeout(500); }
    await closeReport();
    const rs = await page.$eval('#statusText', el => el.textContent);
    check('MusicXML import reports 2 verses, repeats and endings, and D.S. marks', /2 verses of lyrics/.test(rs) && /repeats and endings/.test(rs) && /D\.C\. \/ D\.S\./.test(rs));
    const d = await page.evaluate(() => { const q = s => document.querySelectorAll('#staffSvg ' + s).length; return {
      thick: q('.repeat-thick'), dots: q('.repeat-dot'), volta: q('.volta'), nav: Array.from(document.querySelectorAll('#staffSvg .nav-text')).map(t => t.textContent).join('|'),
      signs: q('.nav-sign'), verse: q('.lyric-verse'), hyph: q('.lyric-hyphen'), ext: q('.lyric-extender'),
      lyr: Array.from(document.querySelectorAll('#staffSvg .lyric')).map(t => t.textContent).slice(0, 3).join(',') }; });
    check('repeat barlines, two ending brackets, Fine / D.S. al Fine and a segno are drawn', d.thick === 2 && d.dots === 4 && d.volta === 2 && d.nav === 'Fine|D.S. al Fine' && d.signs === 1);
    check('verse numbers, centred hyphens and an extender are drawn, and syllables show without their hyphen', d.verse === 2 && d.hyph >= 3 && d.ext === 1 && d.lyr === 'Twin,Up,kle');
    // play: the playhead must come back to the repeat
    await page.click('#playBtn');
    await page.waitForTimeout(300);
    check('the play window has a Repeats switch for this song', !(await page.$eval('#playRepeatsWrap', el => el.hidden)) && await page.$eval('#playRepeatsToggle', el => el.checked));
    const xs = [];
    for (let i = 0; i < 40; i++){ xs.push(await page.evaluate(() => { const l = document.getElementById('playHeadLine'); return l ? +l.getAttribute('x1') : null; })); await page.waitForTimeout(450); }
    const back = xs.some((x, i) => i > 0 && x !== null && xs[i - 1] !== null && x < xs[i - 1] - 100);
    check('the playhead goes back to the start repeat after the 1st ending', back);
    await page.click('#playModalStopBtn');
    await page.click('#playCloseBtn');
    await page.waitForTimeout(150);
    // the Repeat menu
    if (!(await page.$eval('.acc-item[data-acc="notes"]', el => el.classList.contains('open')))) await page.click('.acc-strip[data-acc-toggle="notes"]');
    await page.waitForTimeout(200);
    const mpid = await page.$eval('#staffSvg .note-group', el => el.getAttribute('data-part-id'));
    const nth = i => `#staffSvg .note-group:not(.rest)[data-part-id="${mpid}"] >> nth=${i}`;
    await page.click(nth(12));
    await page.click('#mkRepeatBtn');
    await page.waitForTimeout(100);
    await page.click('#mkRepeatMenu [data-mk="jump:coda"]');
    await page.waitForTimeout(150);
    check('Repeat ▾ → Coda draws the coda sign', (await page.$$eval('#staffSvg .nav-sign', els => els.length)) === 2);
    // type lyrics through the song: Enter starts, "-" and Space move on, "_" holds
    await page.click(nth(0));
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await page.selectOption('#inspVerseSelect', '2');
    await page.waitForTimeout(150);
    await page.click('#inspLyricInput');
    await page.keyboard.type('Oh-ver there_ now');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    const v3 = await page.evaluate(() => Array.from(document.querySelectorAll('#staffSvg .lyric')).filter(t => Math.abs(+t.getAttribute('y') - +document.querySelector('#staffSvg .lyric').getAttribute('y') - 30) < 1).map(t => t.textContent).join(' '));
    check('typing "Oh-ver there_ now" fills verse 3 note by note', v3 === 'Oh ver there now');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(150);
    check('one Undo takes the typed lyrics back off', (await page.$$eval('#staffSvg .lyric-verse', els => els.length)) === 2);
    await page.click('#sideSlideoutClose').catch(() => {});
    const [rx] = await Promise.all([ page.waitForEvent('download'), page.click('#saveMenuBtn').then(() => page.click('#saveMusicXmlBtn')) ]);
    const rxt = fs.readFileSync(await rx.path(), 'utf8');
    check('Save .musicxml keeps the repeats, endings, segno and both verses', /<repeat direction="backward"\/>/.test(rxt) && /<ending number="2" type="discontinue"\/>/.test(rxt) && /<segno\/>/.test(rxt) && /<lyric number="2">/.test(rxt));
  }

  // ---- v2.26: divisi on one stave ----
  {
    const coolin = path.join(path.dirname(appDir), 'data', 'Barber-The-Coolin.mid');
    if (fs.existsSync(coolin)){
      await page.evaluate(() => { document.getElementById('importDivisiBox').checked = true; });   // (an earlier import turned it off)
      await page.setInputFiles('#loadJsonInput', coolin);
      await page.waitForTimeout(600);
      const names = await page.$$eval('#importTable tr td:nth-child(3)', tds => tds.map(t => t.textContent));
      check('the import dialog offers the lower Alto and Bass lines as divisi on their upper staves', names.filter(n => /as divisi on the/.test(n)).length === 2 && /4 of 8 staves/.test(await page.$eval('#importNote', el => el.textContent)));
      await page.click('#importOkBtn');
      await page.waitForTimeout(700);
      await closeReport();
      check('The Coolin comes in on four staves with divisi noteheads', (await page.$$eval('#partsBar .part-grp', els => els.length)) === 4 && (await page.$$eval('#staffSvg .divisi-head', els => els.length)) > 20 && /divisi kept on one stave/.test(await page.$eval('#statusText', el => el.textContent)));
      if (!(await page.$eval('.acc-item[data-acc="staves"]', el => el.classList.contains('open')))) await page.click('.acc-strip[data-acc-toggle="staves"]');
      await page.waitForTimeout(250);
      const splitBtns = await page.$$('#partsBar .split-btn');
      check('Staves shows Split divisi on the Alto and Bass', splitBtns.length === 2);
      await splitBtns[0].click();
      await page.waitForTimeout(300);
      check('Split divisi makes an Alto II stave below', (await page.$$eval('#partsBar .part-grp', els => els.length)) === 5 && (await page.$$eval('#partsBar .part-grp select', els => els.map(e => e.value))).includes('A2'));
      const combine = await page.$$('#partsBar .combine-btn');
      await combine[1].click();   // Alto: combine with Alto II
      await page.waitForTimeout(300);
      check('Combine with Alto II folds it back into divisi', (await page.$$eval('#partsBar .part-grp', els => els.length)) === 4 && /Combined/.test(await page.$eval('#statusText', el => el.textContent)));
      await page.click('.acc-strip[data-acc-toggle="staves"]');
      // Selected panel: add a divisi to a soprano note
      const before = await page.$$eval('#staffSvg .divisi-head', els => els.length);
      const smp = await page.$eval('#staffSvg .note-group', el => el.getAttribute('data-part-id'));
      await page.click(`#staffSvg .note-group:not(.rest)[data-part-id="${smp}"] >> nth=0`);
      await page.waitForTimeout(200);
      await page.click('.divisi-row button:has-text("3rd below")');
      await page.waitForTimeout(200);
      check('Selected › Divisi › + 3rd below adds a second notehead', (await page.$$eval('#staffSvg .divisi-head', els => els.length)) === before + 1);
      await page.click('#sideSlideoutClose').catch(() => {});
      await page.click('#playBtn');
      await page.waitForTimeout(1200);
      check('playing divisi runs without errors', errors.length === 0 && (await page.$eval('#playModalStatus', el => el.textContent)) === 'Playing…');
      await page.click('#playModalStopBtn');
      await page.click('#playCloseBtn');
      await page.waitForTimeout(150);
    }
  }


  // ---- v2.28: import fidelity ----
  {
    // MusicXML: a section word on a rest, a transposing part, an ornament -> named rehearsal mark,
    // concert pitch, and an Import report that opens by itself (something wasn't brought across)
    const fxml = '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><work><work-title>Untitled score</work-title></work>' +
      '<part-list><score-part id="P1"><part-name>Clarinet in Bb</part-name></score-part></part-list><part id="P1">' +
      '<measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time>' +
      '<clef><sign>G</sign><line>2</line></clef><transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose></attributes>' +
      '<direction placement="above"><direction-type><words>Verse 1</words></direction-type></direction>' +
      '<note><rest/><duration>1</duration><voice>1</voice><type>quarter</type></note>' +
      '<note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><notations><ornaments><trill-mark/></ornaments></notations></note>' +
      '<note><pitch><step>E</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>half</type></note></measure></part></score-partwise>';
    await page.setInputFiles('#loadJsonInput', { name: 'fidelity-test.musicxml', mimeType: 'application/xml', buffer: Buffer.from(fxml) });
    await page.waitForTimeout(600);
    if (!(await page.$eval('#importOverlay', el => el.hidden))){ await page.click('#importOkBtn'); await page.waitForTimeout(500); }
    check('an import that leaves something behind opens the Import report', !(await page.$eval('#importReportOverlay', el => el.hidden)) &&
      /Ornaments/.test(await page.$eval('#importReportBody', el => el.textContent)) && /Transposing/.test(await page.$eval('#importReportBody', el => el.textContent)));
    await page.click('#importReportOkBtn');
    await page.waitForTimeout(150);
    check('the Import report button stays in the status bar, flagged', await page.$eval('#importReportBtn', el => !el.hidden && el.classList.contains('fid-warn')));
    check('"Untitled score" falls back to the file name', (await page.$eval('#titleInput', el => el.value)) === 'fidelity-test');
    check('a section word becomes a named rehearsal mark', (await page.$$eval('#staffSvg .rehearsal-text', els => els.map(e => e.textContent))).join('|') === 'Verse 1');
    check('a clarinet-in-B-flat part comes in at concert pitch (written D5 E5 sounds C5 D5)', /C5q\S*\s+D5h/.test(await page.$eval('#melodyText', el => el.value)));
    await page.click('#importReportBtn');
    await page.waitForTimeout(150);
    check('the button reopens the report', !(await page.$eval('#importReportOverlay', el => el.hidden)));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    check('Esc closes the report', await page.$eval('#importReportOverlay', el => el.hidden));

    // MIDI: the Byrd names its SATB lines after recorders -- all four come in, as S A T B
    const byrd = path.join(path.dirname(appDir), 'data', 'Byrd-Ave-Verum-Corpus.mid');
    if (fs.existsSync(byrd)){
      await page.setInputFiles('#loadJsonInput', byrd);
      await page.waitForTimeout(700);
      const ticked = await page.$$eval('#importTable input[type=checkbox]', els => els.filter(e => e.checked).length);
      check('all four recorder-named tracks are ticked', ticked === 4);
      await page.click('#importOkBtn');
      await page.waitForTimeout(700);
      await closeReport();
      check('...and come in as Soprano, Alto, Tenor, Bass', /Soprano \(melody\), Alto, Tenor, Bass/.test(await page.$eval('#statusText', el => el.textContent)));
      check('a clean MIDI import leaves the report closed, but the button is there', await page.$eval('#importReportOverlay', el => el.hidden) && await page.$eval('#importReportBtn', el => !el.hidden));
    }
    const coolin = path.join(path.dirname(appDir), 'data', 'Barber-The-Coolin.mid');
    if (fs.existsSync(coolin)){
      await page.setInputFiles('#loadJsonInput', coolin);
      await page.waitForTimeout(700);
      await page.click('#importOkBtn');
      await page.waitForTimeout(800);
      await closeReport();
      check('The Coolin opens in 12/8 (its first two time signatures share tick 0)', (await page.$eval('#timeSigNum', el => el.value)) === '12');
      check('The Coolin gets fermatas from its tempo drops', (await page.$$eval('#staffSvg .fermata', els => els.length)) >= 8);
    }
  }

  // ---- v2.16: section strips say what clicking does ----
  const stripTitle = await page.$eval('.acc-strip[data-acc-toggle="chords"]', el => el.title);
  check('the tool-section strips have hover text saying click to show/hide', /^Click to (show|hide)/.test(stripTitle));

  // ---- v2.35: the measure ruler, Selected measures, melody sections, Rewrite ----
  await page.click('#newSongBtn');
  await page.waitForTimeout(200);
  await page.click('#sideRail button[data-rail="melody"]');
  await page.waitForTimeout(200);
  await page.fill('#melodyText', 'E5q D5q C5q D5q E5q E5q E5h D5q D5q E5q D5q C5w E5q D5q C5q D5q E5q E5q E5h D5q D5q E5q D5q C5w');
  await page.click('#applyTextBtn');
  await page.waitForTimeout(250);
  await page.selectOption('#staveCountSelect', '4');
  await page.waitForTimeout(250);
  await page.evaluate(() => document.getElementById('suggestChordsBtn').click());
  await page.waitForTimeout(250);
  await page.evaluate(() => document.getElementById('generatePartsBtn').click());
  await page.waitForTimeout(1500);
  { const cr = await page.$('#sideSlideoutClose'); if (cr && await cr.isVisible()) await cr.click(); }
  await page.waitForTimeout(150);
  const rulerNums = await page.$$eval('#staffSvg .ruler-num', els => els.map(e => e.textContent));
  check('v2.35: a row of measure numbers runs above the chord lane', rulerNums.join(',') === '1,2,3,4,5,6,7,8');
  const numAt = async i => page.$$eval('#staffSvg .ruler-num', (els, k) => { els[k].scrollIntoView({ block: 'nearest', inline: 'center' }); const r = els[k].getBoundingClientRect(); return { x: r.left + 12, y: r.top + r.height / 2 }; }, i);
  let q0 = await numAt(4);
  await page.mouse.click(q0.x, q0.y);
  await page.waitForTimeout(250);
  { const cr = await page.$('#sideSlideoutClose'); if (cr && await cr.isVisible()) await cr.click(); }
  await page.waitForTimeout(600);   // the panel slides away
  q0 = await numAt(7);
  await page.keyboard.down('Shift'); await page.mouse.click(q0.x, q0.y); await page.keyboard.up('Shift');
  await page.waitForTimeout(300);
  check('clicking a measure number, then Shift-clicking another, selects mm. 5–8 on every stave', /mm\. 5–8 selected/.test(await page.$eval('#measuresBox', el => el.textContent)) && !!(await page.$('#staffSvg .measure-band')));
  check('...and opens Selected measures, with the ticked staves (not the tune)', !(await page.$eval('#measuresPanel', el => el.hidden)) &&
    JSON.stringify(await page.$$eval('#measuresBox input[data-stave]', els => els.map(e => [e.checked, e.disabled]))) === JSON.stringify([[false, true], [true, false], [true, false], [true, false]]));
  const tenorId = await page.$$eval('#melodyInSelect option', els => (els.find(o => /Tenor/.test(o.textContent)) || {}).value);
  await page.selectOption('#melodyInSelect', tenorId);
  check('Melody in: Tenor offers to bring the tune, ticked (the tenor has no notes of its own there)', await page.$eval('#bringTuneBox', el => el.checked && !el.parentNode.hidden));
  await page.click('#measuresBox button.accent');
  await page.waitForTimeout(300);
  check('Apply: the tune is in the tenor for mm. 5–8, and the ruler says so', /Tune in the Tenor in mm\. 5–8 — copied 12 notes/.test(await page.$eval('#statusText', el => el.textContent)) &&
    (await page.$$eval('#staffSvg .ruler-sec-label', els => els.map(e => e.textContent))).includes('Tune: Tenor'));
  await page.click('#rewriteBtn');
  await page.waitForTimeout(1500);
  check('Rewrite writes the other staves around the tenor tune in those measures', /Rewrote Soprano, Alto, Bass in mm\. 5–8/.test(await page.$eval('#statusText', el => el.textContent)));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  check('Esc clears the measure selection', !(await page.$('#staffSvg .measure-band')));
  await page.evaluate(() => document.getElementById('generatePartsBtn').click());
  await page.waitForTimeout(1500);
  check('Generate parts then goes by melody section', /by melody section \(tune in the Soprano mm\. 1–4; tune in the Tenor mm\. 5–8/.test(await page.$eval('#statusText', el => el.textContent)));
  check('v2.37: ...and goes back over the joins, with both sides in place', /at the joins between sections written again with both sides in place/.test(await page.$eval('#statusText', el => el.textContent)));
  await page.click('#undoBtn').catch(() => {});
  await page.waitForTimeout(200);
  const pr = await page.evaluate(() => { window.dispatchEvent(new Event('beforeprint')); const n = document.querySelectorAll('#printScore .ruler, #printScore .measure-band').length; const sys = document.querySelectorAll('#printScore .print-sys').length; window.dispatchEvent(new Event('afterprint')); return [n, sys]; });
  check('the ruler and the band stay out of the print copy', pr[0] === 0 && pr[1] > 0);

  // ---- v2.36: measure numbers on the score, lock marks ----
  const mnums = async () => page.$$eval('#staffSvg .score-mnum', els => els.map(e => e.textContent));
  check('v2.36: measure numbers sit over the top stave at each barline (2–8; none on m. 1)', (await mnums()).join(',') === '2,3,4,5,6,7,8');
  await page.evaluate(() => { const s = document.getElementById('measureNumSelect'); s.value = 'all'; s.dispatchEvent(new Event('change')); });
  check('...Settings › Measure numbers › Above every stave numbers all four', (await mnums()).length === 28);
  await page.evaluate(() => { const s = document.getElementById('measureNumSelect'); s.value = 'off'; s.dispatchEvent(new Event('change')); });
  check('...and Off takes them away (the ruler stays)', (await mnums()).length === 0 && (await page.$$('#staffSvg .ruler-num')).length === 8);
  await page.evaluate(() => { const s = document.getElementById('measureNumSelect'); s.value = 'top'; s.dispatchEvent(new Event('change')); });
  check('no lock marks before anything is locked', (await page.$$('#staffSvg .lock-mark')).length === 0);
  q0 = await numAt(0);
  await page.mouse.click(q0.x, q0.y);
  await page.waitForTimeout(600);
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('#measuresBox button')).find(x => x.textContent === 'Lock'); b.click(); });
  await page.waitForTimeout(250);
  const lockMarks = await page.$$eval('#staffSvg .lock-mark', els => els.map(e => e.querySelector('title').textContent));
  check('Lock on m. 1 draws a padlock over the locked notes of each ticked stave (' + lockMarks.length + ')', lockMarks.length === 3 && lockMarks.every(t => /locked note/.test(t)));
  check('...and the Staves list in Selected measures says how much is locked', /all locked/.test(await page.$eval('#measuresBox .measure-staves', el => el.textContent)));
  await page.evaluate(() => document.querySelector('#staffSvg .lock-mark').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await page.waitForTimeout(300);
  check('clicking a lock mark selects those notes, with Unlock selected at hand', await page.evaluate(() => Array.from(document.querySelectorAll('button')).some(b => b.textContent === 'Unlock selected' && b.offsetParent)));
  await page.evaluate(() => { const t = document.getElementById('lockMarksToggle'); t.checked = false; t.dispatchEvent(new Event('change')); });
  check('Settings › Show locked notes off hides them', (await page.$$('#staffSvg .lock-mark')).length === 0);
  await page.evaluate(() => { const t = document.getElementById('lockMarksToggle'); t.checked = true; t.dispatchEvent(new Event('change')); });
  const pr2 = await page.evaluate(() => { window.dispatchEvent(new Event('beforeprint')); const n = document.querySelectorAll('#printScore .lock-mark').length; const m = document.querySelectorAll('#printScore .score-mnum').length; window.dispatchEvent(new Event('afterprint')); return [n, m]; });
  check('the print copy keeps the measure numbers and leaves out the lock marks', pr2[0] === 0 && pr2[1] > 0);

  // ---- v2.38: marks over generated notes, and the partwriting checks ----
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  const genMarks = await page.$$eval('#staffSvg .gen-mark', els => els.map(e => e.querySelector('title').textContent));
  check('v2.38: runs of generated notes are marked on the staves that mix them with the tune (' + genMarks.length + ')', genMarks.length >= 2 && genMarks.every(t => /written by Generate parts/.test(t)));
  await page.evaluate(() => document.querySelector('#staffSvg .gen-mark').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await page.waitForTimeout(250);
  check('...clicking one selects its notes', (await page.$$('#staffSvg .note-group.selected')).length >= 1);
  await page.keyboard.press('Escape');
  const setGen = async v => { await page.evaluate(v => { const s = document.getElementById('genMarksSelect'); s.value = v; s.dispatchEvent(new Event('change')); }, v); await page.waitForTimeout(150); return (await page.$$('#staffSvg .gen-mark')).length; };
  const nAll = await setGen('all');
  check('...Settings › Mark generated notes › on every stave marks the all-generated staves too', nAll > genMarks.length);
  check('...and off marks none', (await setGen('off')) === 0);
  await setGen('mixed');
  const pr3 = await page.evaluate(() => { window.dispatchEvent(new Event('beforeprint')); const n = document.querySelectorAll('#printScore .gen-mark, #printScore .parallel-mark').length; window.dispatchEvent(new Event('afterprint')); return n; });
  check('...never printed', pr3 === 0);
  check('Settings has a tick box for each partwriting check', (await page.$$('#pwKindsRow input[type=checkbox]')).length === 6);
  await page.evaluate(() => { const t = document.getElementById('parallelsToggle'); t.checked = true; t.dispatchEvent(new Event('change')); });
  await page.waitForTimeout(200);
  const pwStatus = await page.$eval('#statusText', el => el.textContent);
  check('Mark partwriting problems reports what it found (' + pwStatus + ')', /^Marked: |^No partwriting problems found/.test(pwStatus));
  const kinds = await page.$$eval('#staffSvg .parallel-mark', els => els.map(e => e.getAttribute('class')));
  check('...and draws a mark for each (' + kinds.length + ')', /^Marked/.test(pwStatus) ? kinds.length >= 1 : kinds.length === 0);
  await page.evaluate(() => { document.querySelectorAll('#pwKindsRow input').forEach(cb => { if (cb.checked){ cb.checked = false; cb.dispatchEvent(new Event('change')); } }); });
  await page.waitForTimeout(200);
  check('...unticking every kind clears the marks', (await page.$$('#staffSvg .parallel-mark')).length === 0);
  await page.evaluate(() => { document.querySelectorAll('#pwKindsRow input').forEach(cb => { cb.checked = true; cb.dispatchEvent(new Event('change')); }); const t = document.getElementById('parallelsToggle'); t.checked = false; t.dispatchEvent(new Event('change')); });
  await page.waitForTimeout(150);

  // ---- v2.37: the tune in the bass ----
  await page.keyboard.press('Escape');
  q0 = await numAt(0);
  await page.mouse.click(q0.x, q0.y);
  await page.waitForTimeout(600);
  const bassId = await page.$$eval('#melodyInSelect option', els => (els.find(o => /Bass/.test(o.textContent)) || {}).value);
  await page.selectOption('#melodyInSelect', bassId);
  await page.waitForTimeout(100);
  await page.click('#measuresBox button.accent');
  await page.waitForTimeout(300);
  const st37 = await page.$eval('#statusText', el => el.textContent);
  check('v2.37: Melody in Bass for m. 1 — no "not handled" caveat any more', /Tune in the Bass in m\. 1/.test(st37) && !/isn’t handled/.test(st37));
  await page.click('#rewriteBtn');
  await page.waitForTimeout(1500);
  check('...Rewrite writes the other staves above the bass tune', /Rewrote .*in m\. 1/.test(await page.$eval('#statusText', el => el.textContent)));

  console.log('\nJS errors captured during the run:', JSON.stringify(errors));
  check('no console/page errors during the whole run', errors.length === 0);

  await browser.close();
  server.close();

  console.log('\n' + count + ' checks, ' + fails + ' failure(s).');
  process.exitCode = fails ? 1 : 0;
})();
