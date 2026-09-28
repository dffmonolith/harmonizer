// logic.test.js -- standing regression suite for Harmonizer's core logic (no browser needed).
//
// Usage:
//   node tests/logic.test.js                       tests whatever current.txt points at
//   node tests/logic.test.js harmonizer-2.9.html    tests a specific file (e.g. before
//                                                    promoting it to current.txt)
//
// Exits 0 if everything passes, 1 if anything fails (so it can be used as a gate before you
// repoint current.txt at a new release). Add new scenarios as you add features -- see the
// comment above HISTORY TESTS for the shape a new section should take.
'use strict';
const fs = require('fs');
const path = require('path');
const { loadApp } = require('./dom-stub');

const appDir = __dirname.replace(/[\\/]tests$/, '');
let target = process.argv[2];
if (!target){
  const cur = fs.readFileSync(path.join(appDir, 'current.txt'), 'utf8').trim();
  target = cur;
}
if (!path.isAbsolute(target)) target = path.join(appDir, target);
console.log('Testing: ' + target);

let fails = 0, count = 0;
function check(label, cond){
  count++;
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + label);
  if (!cond) fails++;
}
function section(title){ console.log('\n=== ' + title + ' ==='); }

function note(letter, accidental, octave, duration, dotted){
  return { id: 'n' + Math.random(), type: 'note', letter, accidental, octave, duration: duration || 'q', dotted: !!dotted, tuplet: null, lyric: '', tied: false };
}
function chord(root, quality, beat){
  const accidental = root.indexOf('#') >= 0 ? 1 : (root.indexOf('b') >= 0 ? -1 : 0);
  return { id: 'c' + Math.random(), beat, root: { letter: root[0], accidental }, quality };
}
function fourPartSong(overrides){
  const base = {
    version: 5, title: '', composer: '', key: 'C', timeSig: { beats: 4, unit: 4 }, showBarlines: true, tempo: 96,
    notes: [], chords: [],
    parts: [
      { id: 'S', role: 'S', clef: 'treble' },
      { id: 'A', role: 'A', clef: 'treble' },
      { id: 'T', role: 'T', clef: 'tenor8va' },
      { id: 'B', role: 'B', clef: 'bass' }
    ],
    melodyPartId: 'S', pickupBeats: 0, meterChanges: []
  };
  return Object.assign(base, overrides);
}

const H = loadApp(target);
check('app script loaded and exposed the test hook', !!H);

// -------------------------------------------------------------------------
// KEY-MODE GUESSING (guessKeyMode) -- a MusicXML <key> with no <mode> element
// has to be inferred from the melody itself. See harmonizer.md project notes
// for the original bug report (a piece in C minor was guessed as Eb major).
// -------------------------------------------------------------------------
section('guessKeyMode');
(function(){
  function ev(letter, accidental){ return { rest: false, pitch: { letter, alter: accidental || 0, octave: 4 }, dur: 1 }; }
  const realMelody = [
    ['F',0],['G',0],['G',0],['A',-1],['G',0],['F',0],['G',0],['G',0],['C',0],['G',0],['F',0],['F',0],['F',0],
    ['E',-1],['F',0],['G',0],['C',0],['C',0],['E',-1],['F',0],['F',0],['F',0],['E',-1],['D',0],['E',-1],['E',-1],
    ['B',-1],['E',-1],['F',0],['F',0],['F',0],['E',-1],['E',-1],['F',0],['E',-1],['D',0],['E',0]
  ].map(p => ev(p[0], p[1]));
  check('minor melody (fifths=-3, Picardy-3rd ending) guesses minor', H.guessKeyMode(-3, realMelody) === 'minor');

  const majorMelody = [['E',-1],['F',0],['G',0],['A',-1],['B',-1],['C',0],['D',0],['E',-1]].map(p => ev(p[0], p[1]));
  check('genuine Eb-major scale run (fifths=-3) guesses major', H.guessKeyMode(-3, majorMelody) === 'major');

  const minorWithLT = [['C',0],['D',0],['E',-1],['F',0],['G',0],['A',-1],['B',0],['C',0]].map(p => ev(p[0], p[1]));
  check('minor melody with raised leading tone (fifths=-3) guesses minor', H.guessKeyMode(-3, minorWithLT) === 'minor');

  check('empty event list defaults to major', H.guessKeyMode(-3, []) === 'major');

  const cMajor = [['C',0],['E',0],['G',0],['C',0]].map(p => ev(p[0], p[1]));
  check('C major arpeggio (fifths=0) guesses major', H.guessKeyMode(0, cMajor) === 'major');

  const aMinor = [['A',0],['B',0],['C',0],['D',0],['E',0],['F',0],['G',1],['A',0]].map(p => ev(p[0], p[1]));
  check('A harmonic minor scale (fifths=0, G# present) guesses minor', H.guessKeyMode(0, aMinor) === 'minor');
})();

// -------------------------------------------------------------------------
// PICARDY THIRD AT A CADENCE -- the final chord should conform to the
// melody's raised third when the melody itself has one, so the generated
// bass/harmony doesn't clash against it (e.g. bass on Eb under a melody E-natural).
// -------------------------------------------------------------------------
section('Picardy third at the final cadence');
(function(){
  const song = fourPartSong({
    key: 'Cm',
    notes: [ note('G',0,4,'q'), note('F',0,4,'q'), note('E',-1,4,'q'), note('D',0,4,'q'), note('E',0,4,'h') ],
    chords: [ chord('C','min',0), chord('C','min',3) ]
  });
  H.setSong(song);
  const built = H.buildEvents(H.melodyPart());
  const finalEv = built.events[built.events.length - 1];
  check("final event's chord tones include the melody's raised third (pc 4) and drop the minor third (pc 3)",
    finalEv.chordInfo.tones.indexOf(4) >= 0 && finalEv.chordInfo.tones.indexOf(3) < 0);
  check('final melody note now classifies as a chord tone', finalEv.classification === 'chordTone');

  H.generatePartsFromMelodyAndChords();
  const bass = H.findPart('B');
  const lastBass = bass.notes.filter(n => n.type === 'note').pop();
  check('generated bass does NOT end on the clashing Eb', !(lastBass.letter === 'E' && lastBass.accidental === -1));
  ['A', 'T'].forEach(pid => {
    const p = H.findPart(pid);
    const last = p.notes.filter(n => n.type === 'note').pop();
    check('generated ' + pid + ' voice does not end on the clashing Eb either', !(last && last.letter === 'E' && last.accidental === -1));
  });

  // Controls: an ordinary (non-Picardy) minor ending, and an already-major ending, must both be no-ops.
  const song2 = JSON.parse(JSON.stringify(song));
  song2.notes[4] = note('E', -1, 4, 'h');
  H.setSong(song2);
  const built2 = H.buildEvents(H.melodyPart());
  const finalEv2 = built2.events[built2.events.length - 1];
  check('control: ordinary minor-third ending is left untouched', !finalEv2.chordInfo.picardy && finalEv2.chordInfo.tones.indexOf(3) >= 0);

  const song3 = JSON.parse(JSON.stringify(song));
  song3.chords[1] = chord('C', 'maj', 3);
  H.setSong(song3);
  const built3 = H.buildEvents(H.melodyPart());
  const finalEv3 = built3.events[built3.events.length - 1];
  check('control: already-major final chord is a no-op', !finalEv3.chordInfo.picardy);
})();

// -------------------------------------------------------------------------
// GENERATE PARTS -- own-rhythm survival, stale-harmony invalidation, and
// hand-made staves being left alone around ones that DO get generated.
// -------------------------------------------------------------------------
section('Generate Parts regression');
(function(){
  const song = fourPartSong({
    notes: [ note('C',0,5,'q'), note('E',0,5,'q'), note('G',0,5,'q'), note('C',0,5,'h') ],
    chords: [ chord('C', 'maj', 0) ]
  });
  H.setSong(song);
  H.generatePartsFromMelodyAndChords();
  const alto = H.findPart('A');
  check('Generate Parts fills Alto as an own-rhythm generated stave',
    H.isIndependentPart(alto) && alto._generated && alto.notes && alto.notes.length > 0);

  H.clearGeneratedHarmony(alto);
  check('clearGeneratedHarmony wipes a generated stave back to blank', alto.notes === undefined && alto._generated === undefined);

  const handMade = { id: 'T', role: 'T', clef: 'tenor8va', notes: [ note('C', 0, 4, 'q') ] };
  H.clearGeneratedHarmony(handMade);
  check('clearGeneratedHarmony leaves a hand-made (non-_generated) stave alone', handMade.notes && handMade.notes.length === 1);

  const tenorHandMade = { id: 'T', role: 'T', clef: 'tenor8va', notes: [ note('E',0,4,'q'), note('D',0,4,'q'), note('C',0,4,'q'), note('C',0,4,'h') ] };
  const song3 = fourPartSong({
    notes: song.notes, chords: song.chords,
    parts: [ { id: 'S', role: 'S', clef: 'treble' }, { id: 'A', role: 'A', clef: 'treble' }, tenorHandMade, { id: 'B', role: 'B', clef: 'bass' } ]
  });
  H.setSong(song3);
  const before = JSON.stringify(tenorHandMade.notes.map(n => n.letter + n.octave));
  H.generatePartsFromMelodyAndChords();
  const after = JSON.stringify(H.findPart('T').notes.map(n => n.letter + n.octave));
  check('a hand-made own-rhythm stave (no lock, no _generated flag) is not silently overwritten by Generate Parts', before === after);
  const A3 = H.findPart('A'), B3 = H.findPart('B');
  check('the other, eligible staves still get generated harmony around the hand-made one',
    A3._generated && A3.notes.length && B3._generated && B3.notes.length);
})();

// -------------------------------------------------------------------------
// UNDO / REDO (v2.9) -- snapshot stack keyed off render(); see the app's own
// "v2.9: undo / redo" comment block for the design rationale.
// -------------------------------------------------------------------------
section('Undo / redo');
(function(){
  // Deliberately not H.init() here -- init() also runs wireUi(), which wires up static HTML
  // (toolbar buttons, the icon rail) that this dependency-free DOM stub doesn't model. That
  // full-page wiring is covered by tests/e2e.test.js against a real browser instead; this
  // section only exercises the history state machine itself, via setSong()/render() directly.
  const s0 = fourPartSong({});
  H.setSong(s0);
  H.render();
  check('a freshly-set song establishes a history baseline with nothing to undo', H.historyState().past === 0);

  s0.notes.push(note('C', 0, 5, 'q'));
  H.afterEdit();
  check('one edit -> one undo-able step', H.historyState().past === 1 && H.historyState().future === 0);

  s0.notes.push(note('D', 0, 5, 'q'));
  H.afterEdit();
  check('a second edit -> two undo-able steps', H.historyState().past === 2);

  H.undo();
  check('undo once removes the most recent note', H.getSong().notes.length === 1);
  check('undo moves one step from past to future', H.historyState().past === 1 && H.historyState().future === 1);

  H.undo();
  check('undo again empties the melody', H.getSong().notes.length === 0);
  check('past is now empty, future has both steps', H.historyState().past === 0 && H.historyState().future === 2);

  H.undo();
  check('undoing past the start is a harmless no-op', H.getSong().notes.length === 0 && H.historyState().past === 0);

  H.redo();
  H.redo();
  check('redo twice restores both notes', H.getSong().notes.length === 2);
  check('future is now empty again', H.historyState().future === 0);

  H.redo();
  check('redoing past the end is a harmless no-op', H.getSong().notes.length === 2);

  // Branching: undo, then make a DIFFERENT edit -- the old redo branch should be discarded.
  H.undo();
  check('undo before branching test leaves one note', H.getSong().notes.length === 1);
  H.getSong().notes.push(note('G', 0, 5, 'q')); // a different edit than the one we undid
  H.afterEdit();
  check('a new edit after undo discards the old redo branch', H.historyState().future === 0);
  check('the new edit is the one that stuck', H.getSong().notes[1].letter === 'G');

  // Gesture coalescing: several mutations under one begin/end pair record as ONE undo step.
  const beforeGesture = H.historyState().past;
  H.historyBeginGesture();
  for (let i = 0; i < 5; i++){
    H.getSong().notes.push(note('A', 0, 4, 'e'));
    H.render();
  }
  check('mutations inside a held gesture do not record intermediate steps', H.historyState().past === beforeGesture);
  const notesAfterGesture = H.getSong().notes.length;
  H.historyEndGesture();
  check('ending the gesture records exactly one step for the whole thing', H.historyState().past === beforeGesture + 1);
  H.undo();
  check('undoing a coalesced gesture reverts it in one step, not five', H.getSong().notes.length === notesAfterGesture - 5);

  // Switching to a different song resets history -- undo must never cross song boundaries.
  const song2 = fourPartSong({ notes: [ note('E', 0, 4, 'q') ] });
  H.setSong(song2);
  H.render();
  check('switching to a different song object resets the undo stack', H.historyState().past === 0 && H.historyState().future === 0);
})();

// -------------------------------------------------------------------------
// v2.10: MusicXML import no longer drops a part's instrument label, or dynamics/slurs/grace
// notes on the melody -- importEventsToNotes carries them from the parsed-event shape
// (see parseScorePart) onto the Harmonizer notes it builds. These events are hand-built here
// rather than parsed from real XML, since dom-stub.js has no DOMParser -- that's exactly the
// boundary logic tests are meant to sit at (see "Why not test through the full UI" in README.md).
section('MusicXML import: dynamics, slurs, grace notes (v2.10)');
(function(){
  const stats = { folded: 0, rounded: 0 };
  const events = [
    { start: 0, dur: 1, rest: false, pitch: { letter: 'C', alter: 0, octave: 4 }, tieStart: false, tieStop: false, tm: null, type: 'quarter', dots: 0, lyric: '',
      dynamic: 'mf', slurStart: true, slurStop: false, grace: [ { letter: 'B', alter: 0, octave: 3 } ] },
    { start: 1, dur: 1, rest: false, pitch: { letter: 'D', alter: 0, octave: 4 }, tieStart: false, tieStop: false, tm: null, type: 'quarter', dots: 0, lyric: '',
      dynamic: '', slurStart: false, slurStop: true, grace: null }
  ];
  const conv = H.importEventsToNotes(events, 'treble', 0, stats);
  check('a dynamic mark lands on the note whose event carried it', conv.notes[0].dynamic === 'mf');
  check('a slur-start flag is carried onto the note', conv.notes[0].slurStart === true);
  check('a slur-stop flag is carried onto the later note', conv.notes[1].slurStop === true);
  check('grace pitches are converted (through importPitch) and attached to the following note',
    Array.isArray(conv.notes[0].graceBefore) && conv.notes[0].graceBefore.length === 1 && conv.notes[0].graceBefore[0].letter === 'B');
  check('a note with no dynamic/grace of its own carries neither', !conv.notes[1].dynamic && !conv.notes[1].graceBefore);
})();

// v2.10: a stave's Instrument field is a label only -- Harmonizer's own playback and MusicXML
// export never change the piano sampler because of it -- but "Save .musicxml" should still write
// whatever label is set, plus the dynamics/slurs/grace notes now kept on import, so a real
// notation program opening the file sees them.
section('MusicXML export: instrument labels, dynamics, slurs, grace notes (v2.10)');
(function(){
  const gn = note('E', 0, 4, 'q');
  gn.dynamic = 'mf'; gn.slurStart = true;
  gn.graceBefore = [ { letter: 'D', accidental: 0, octave: 4 } ];
  const n2 = note('F', 0, 4, 'q');
  n2.slurStop = true;
  const testSong = fourPartSong({
    notes: [ gn, n2 ],
    parts: [
      { id: 'S', role: 'S', clef: 'treble', instrument: 'Choir Aahs' },
      { id: 'A', role: 'A', clef: 'treble', instrument: 'Piano' },
      { id: 'T', role: 'T', clef: 'tenor8va', instrument: 'Piano' },
      { id: 'B', role: 'B', clef: 'bass', instrument: 'Piano' }
    ],
    melodyPartId: 'S'
  });
  H.setSong(testSong);
  H.render();
  const xml = H.buildMusicXml();
  check('a non-piano Instrument label is written as the part’s instrument-name', xml.indexOf('<instrument-name>Choir Aahs</instrument-name>') >= 0);
  check('a General MIDI program is guessed for a non-piano instrument name', H.gmProgramFor('Choir Aahs') !== 1);
  check('Piano still maps to General MIDI program 1', H.gmProgramFor('Piano') === 1);
  check('a dynamic mark is written as a MusicXML <dynamics> direction', xml.indexOf('<dynamics><mf/></dynamics>') >= 0);
  check('a slur start is written as <slur type="start">', xml.indexOf('<slur type="start" number="1"/>') >= 0);
  check('the matching slur stop is written on the later note', xml.indexOf('<slur type="stop" number="1"/>') >= 0);
  check('a grace note is written as its own <note><grace/>...</note>', xml.indexOf('<note><grace/>') >= 0);
})();

// v2.10: defaultSong() and normalizeSong() should always give every part a usable Instrument
// label (new songs/staves default to Piano; older saved songs with no instrument field at all
// normalize to Piano too, rather than ending up undefined).
section('Instrument defaults (v2.10)');
(function(){
  const fresh = H.defaultSong();
  check('a brand-new song’s sole part defaults to Piano', fresh.parts[0].instrument === 'Piano');
  const legacy = { title: 'Old song', parts: [ { id: 'x', role: 'S', clef: 'treble' } ], melodyPartId: 'x', notes: [] };
  const normalized = H.normalizeSong(legacy);
  check('normalizing a pre-2.10 song (no instrument field) fills in Piano', normalized.parts[0].instrument === 'Piano');
})();

// v2.11: a failed save must no longer be silent. saveLibrary() now returns whether the write
// landed, and a failure (e.g. the browser's ~5 MB storage quota being full) raises a warning in
// the status bar that stays until a later save succeeds.
section('Save failure warning (v2.11)');
(function(){
  H.setLibrary({ activeId: 'e1', entries: [ { id: 'e1', updatedAt: 1, song: H.defaultSong() } ] });
  const warn = document.getElementById('saveWarning');
  warn.hidden = true;
  const realSet = localStorage.setItem;
  localStorage.setItem = function(){ const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; };
  const ok1 = H.saveLibrary();
  check('saveLibrary() reports failure when storage throws', ok1 === false);
  check('a failed save shows the status-bar warning', warn.hidden === false);
  check('the warning says storage is full for a quota error', /storage full/.test(warn.textContent));
  localStorage.setItem = realSet;
  const ok2 = H.saveLibrary();
  check('saveLibrary() reports success once storage works again', ok2 === true);
  check('a successful save clears the warning', warn.hidden === true);
})();

// v2.11: Export library writes every song; Import merges a backup in without overwriting
// anything -- new ids are added, identical songs skipped, a changed same-id song added as a copy.
section('Library backup: export / import merge (v2.11)');
(function(){
  const s1 = H.normalizeSong(Object.assign(H.defaultSong(), { title: 'One' }));
  const s2 = H.normalizeSong(Object.assign(H.defaultSong(), { title: 'Two' }));
  H.setLibrary({ activeId: 'a', entries: [ { id: 'a', updatedAt: 1, song: s1 }, { id: 'b', updatedAt: 2, song: s2 } ] });
  H.setSong(s1);
  const exp = H.libraryExportObject();
  check('export is recognised as a library backup', H.isLibraryFile(exp));
  check('export carries every song', exp.entries.length === 2 && exp.entries[1].song.title === 'Two');
  check('a single song is not mistaken for a library backup', !H.isLibraryFile(s1));

  const roundTrip = JSON.parse(JSON.stringify(exp));
  let r = H.mergeLibraryObject(roundTrip);
  check('re-importing an identical backup adds nothing', r.added === 0 && r.skipped === 2 && H.getLibrary().entries.length === 2);

  const changed = JSON.parse(JSON.stringify(exp));
  changed.entries[0].song.title = 'One (edited elsewhere)';
  changed.entries.push({ id: 'c', updatedAt: 3, song: Object.assign(H.defaultSong(), { title: 'Three' }) });
  r = H.mergeLibraryObject(changed);
  const lib = H.getLibrary();
  check('a new song in the backup is added', r.added === 2 && lib.entries.some(e => e.id === 'c' && e.song.title === 'Three'));
  check('a changed same-id song comes in as a copy, original untouched',
    lib.entries.find(e => e.id === 'a').song.title === 'One' && lib.entries.some(e => e.id !== 'a' && e.song.title === 'One (edited elsewhere)'));
  check('merged library has 4 songs', lib.entries.length === 4);
})();

// v2.11: rehearsal tracks -- which staves get a track, their names, and the per-track mix.
section('Rehearsal tracks (v2.11)');
(function(){
  const s = fourPartSong({
    notes: [ note('E', 0, 4), note('F', 0, 4) ],
    parts: [
      { id: 'S', role: 'S', clef: 'treble' },
      { id: 'A', role: 'A', clef: 'treble', notes: [ note('C', 0, 4, 'h') ] },
      { id: 'T', role: 'T', clef: 'tenor8va' },                     // blank -- no track
      { id: 'B', role: 'S', clef: 'bass', generatedNotes: [ { letter: 'C', accidental: 0, octave: 3 }, { letter: 'D', accidental: 0, octave: 3 } ] }
    ]
  });
  H.setSong(s);
  const ids = H.partsWithContent().map(p => p.id);
  check('only staves with notes get a rehearsal track', ids.join(',') === 'S,A,B');
  const names = H.partTrackNames();
  check('track names come from the voice part', names.S === 'Soprano' && names.A === 'Alto');
  check('a repeated voice name is made unique', names.B === 'Soprano (2)');
  const mix = H.rehearsalMix('A', { othersLevel: 0.3, pan: false, chords: false, speed: 0.8 });
  check('the focus voice plays at full level', mix.level('A') === 1);
  check('other voices are ducked', mix.level('S') === 0.3 && mix.level('B') === 0.3);
  check('unpanned tracks render mono at the chosen speed', mix.channels === 1 && mix.speed === 0.8);
  const panned = H.rehearsalMix('S', { othersLevel: 0, pan: true, chords: true });
  check('panned tracks put the voice left and the rest right, in stereo',
    panned.channels === 2 && panned.pan('S') < 0 && panned.pan('A') > 0 && panned.level('A') === 0);

  // the zip writer: a stored zip whose CRCs and directory an unzip tool accepts
  check('crc32 matches the standard check value', H.crc32(new TextEncoder().encode('123456789')) === 0xCBF43926);
  const zip = H.makeZip([ { name: 'a.txt', data: new TextEncoder().encode('hello') }, { name: 'Alto – b.txt', data: new Uint8Array([1,2,3]) } ]);
  const zpath = require('path').join(require('os').tmpdir(), 'harmonizer-zip-test.zip');
  require('fs').writeFileSync(zpath, Buffer.from(zip));
  let listing = '';
  try { listing = require('child_process').execFileSync('python3', ['-c',
    'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print("|".join(i.filename+":"+str(i.file_size) for i in z.infolist()))', zpath]).toString().trim(); }
  catch (e) { listing = 'ERR ' + e.message; }
  if (listing.indexOf('No such file') >= 0 || listing.indexOf('ENOENT') >= 0){
    check('zip writer output (python3 not available to verify -- signature check only)', zip[0] === 0x50 && zip[1] === 0x4b);
  } else {
    check('the zip opens cleanly with both files and their sizes', listing === 'a.txt:5|Alto – b.txt:3');
  }
})();

// v2.11: Loop -- the range snaps out to whole measures around the selection.
section('Loop range (v2.11)');
(function(){
  // 4/4, three measures of quarter notes
  const ns = [];
  for (let i = 0; i < 12; i++) ns.push(note('C', 0, 4, 'q'));
  const s = fourPartSong({ notes: ns, parts: [ { id: 'S', role: 'S', clef: 'treble' } ] });
  H.setSong(s);
  const st = H.getState();
  st.selection = []; st.selectedChordId = null;
  let r = H.loopRange();
  check('nothing selected loops the whole song', r.whole && r.start === 0 && r.end === 12);
  st.selection = [ { partId: 'S', index: 5 } ];            // beat 5 -> measure 2
  r = H.loopRange();
  check('one selected note loops its own measure', r.start === 4 && r.end === 8 && r.from === 2 && r.to === 2);
  check('loop label for one measure', H.loopRangeText(r) === 'm. 2');
  st.selection = [ { partId: 'S', index: 3 }, { partId: 'S', index: 9 } ];
  r = H.loopRange();
  check('a selection across measures loops them all', r.start === 0 && r.end === 12 && r.from === 1 && r.to === 3);
  st.selection = [ { partId: 'S', index: 7 } ];             // last beat of measure 2 must not spill into m. 3
  r = H.loopRange();
  check('a note ending on a barline does not pull in the next measure', r.end === 8 && r.to === 2);
  const ps = H.playStartAtBeat(4);
  check('playback can start at an arbitrary beat', ps.idx === 4 && ps.offset === 0);
  // pickup measure numbering
  const s2 = fourPartSong({ notes: [ note('G', 0, 4, 'q') ].concat(ns.slice(0, 4)), parts: [ { id: 'S', role: 'S', clef: 'treble' } ], pickupBeats: 1 });
  H.setSong(s2);
  st.selection = [ { partId: 'S', index: 2 } ];
  r = H.loopRange();
  check('with a pickup, the first full measure is m. 1', r.from === 1 && r.start === 1 && r.end === 5);
  st.selection = [];
})();

// v2.12: style presets for Generate parts. Same melody + chords, three styles: all must run,
// Traditional (hymn) must write no parallel fifths or octaves, and Open must spread the upper
// voices wider than Close.
section('Generate parts style presets (v2.12)');
(function(){
  check('three style presets exist', ['close', 'hymn', 'open'].every(k => H.HARMONY_STYLES[k] && H.HARMONY_STYLES[k].table));
  check('an old song with no style normalizes to Close harmony', H.normalizeSong({ notes: [] }).harmonyStyle === 'close');
  check('an unknown style normalizes to Close harmony', H.normalizeSong({ notes: [], harmonyStyle: 'bogus' }).harmonyStyle === 'close');
  const tune = ['E4','D4','C4','D4','E4','E4','E4h','D4','D4','D4h','E4','G4','G4h','E4','D4','C4','D4','E4','E4','E4','E4','D4','D4','E4','D4','C4w'];
  const prog = ['C','G','C','G','C','F','C','G','C','F','G','C','G','C'];
  const BEATS = { w: 4, h: 2, q: 1, e: 0.5, s: 0.25 };
  const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }, SHIFT = { treble: 0, tenor8va: -12, bass: 0 };
  function run(style){
    const s = fourPartSong({ harmonyStyle: style,
      notes: tune.map(t => { const m = /([A-G])(\d)(h|w)?/.exec(t); return note(m[1], 0, +m[2], m[3] || 'q'); }),
      chords: prog.map((r, i) => chord(r, 'maj', i * 2)) });
    H.setSong(s); H.render(); H.generatePartsFromMelodyAndChords();
    const song = H.getSong();
    function at(list, clef, beat){ let t = 0; for (const n of list){ const d = BEATS[n.duration] * (n.dotted ? 1.5 : 1);
      if (beat >= t - 1e-6 && beat < t + d - 1e-6) return n.type === 'note' ? SEMI[n.letter] + n.accidental + 12 * (n.octave + 1) + SHIFT[clef] : null; t += d; } return null; }
    const beats = []; let t = 0; for (const n of song.notes){ beats.push(t); t += BEATS[n.duration]; }
    const V = beats.map(b => [at(song.notes, 'treble', b), at(song.parts[1].notes, 'treble', b), at(song.parts[2].notes, 'tenor8va', b), at(song.parts[3].notes, 'bass', b)]);
    let parallels = 0, spread = 0;
    for (let i = 1; i < V.length; i++) for (let a = 0; a < 4; a++) for (let c = a + 1; c < 4; c++){
      const x0 = V[i-1][a], y0 = V[i-1][c], x1 = V[i][a], y1 = V[i][c];
      if ([x0, y0, x1, y1].includes(null) || x0 === x1) continue;
      const i0 = ((x0 - y0) % 12 + 12) % 12, i1 = ((x1 - y1) % 12 + 12) % 12;
      if (i0 === i1 && (i1 === 7 || i1 === 0) && Math.sign(x1 - x0) === Math.sign(y1 - y0)) parallels++;
    }
    V.forEach(v => { spread += (v[0] - v[2]); });
    return { parallels, spread: spread / V.length, notes: song.parts.slice(1).map(p => p.notes.map(n => n.letter + n.octave).join(' ')).join('|') };
  }
  const close = run('close'), hymn = run('hymn'), open = run('open');
  check('every style fills the other staves', !!close.notes && !!hymn.notes && !!open.notes);
  check('Traditional (hymn) writes no parallel fifths or octaves', hymn.parallels === 0);
  check('Open spreads the upper voices wider than Close', open.spread > close.spread + 2);
  check('the styles really produce different voicings', open.notes !== close.notes);
})();

// v2.12: key changes and tempo changes live in song.keyChanges / song.tempoChanges.
section('Key and tempo changes (v2.12)');
(function(){
  const ns = []; for (let i = 0; i < 12; i++) ns.push(note('F', 0, 4, 'q'));
  const s = fourPartSong({ notes: ns, parts: [ { id: 'S', role: 'S', clef: 'treble' } ] });
  H.setSong(s); H.render();
  check('before any change, the whole song is in the opening key', H.keyAt(9) === 'C');
  check('a change in the first measure is refused (the header owns the opening)', typeof H.applyChangesAt(1, { key: 'D' }) === 'string');
  check('a change applied from a note in m. 3 lands on that measure’s first beat', H.applyChangesAt(9, { key: 'D', bpm: 60 }) === null &&
    H.getSong().keyChanges.length === 1 && H.getSong().keyChanges[0].beat === 8 && H.getSong().tempoChanges[0].beat === 8);
  check('keyAt / tempoAt follow the change', H.keyAt(7.9) === 'C' && H.keyAt(8) === 'D' && H.tempoAt(8) === 60 && H.tempoAt(2) === 96);
  check('sharpsAt gives the local signature', H.sharpsAt(10) === 2 && H.sharpsAt(0) === 0);
  const parsed = H.parseMelodyText('F4q F4q F4q F4q F4q F4q F4q F4q F4q Fn4q F#4q');
  check('an unmarked letter takes the key in force where it lands (F -> F# in D major)',
    parsed.notes[0].accidental === 0 && parsed.notes[8].accidental === 1 && parsed.notes[9].accidental === 0 && parsed.notes[10].accidental === 1);
  H.getSong().notes = parsed.notes;
  const txt = H.serializeMelodyText();
  check('the text view writes "n" only where the local key needs it', /^F4q/.test(txt) && txt.indexOf('Fn4q') > 0 && txt.split('Fn4q').length === 2);
  const lay = H.computeLayout();
  check('the layout places a key signature change and a tempo mark', lay.keyMarks.length === 1 && lay.keyMarks[0].to === 2 && lay.tempoMarks.length === 1 && lay.tempoMarks[0].bpm === 60);
  check('choosing the key already in force removes the change instead', H.applyChangesAt(9, { key: 'C' }) === null && H.getSong().keyChanges.length === 0);
  H.applyChangesAt(9, { key: 'G' });
  H.transposeSong('D');
  check('transposing moves key changes too (C -> D, so G -> A)', H.getSong().key === 'D' && H.getSong().keyChanges[0].key === 'A');
  // tempo map: 8 beats at 96, then 60 -- 8 beats at 96 bpm is 5 s, 4 more at 60 is 4 s
  const tm = H.tempoMap(1);
  check('the tempo map accounts for a tempo change', Math.abs(tm.sec(8) - 5) < 1e-9 && Math.abs(tm.sec(12) - 9) < 1e-9);
  check('beatAt inverts it', Math.abs(tm.beatAt(7) - 10) < 1e-9);
  check('practice speed scales the whole map', Math.abs(H.tempoMap(0.5).sec(12) - 18) < 1e-9);
  const xml = H.buildMusicXml();
  check('MusicXML export writes the key change', xml.indexOf('<attributes><key><fifths>3</fifths><mode>major</mode></key></attributes>') >= 0);
  check('MusicXML export writes the tempo change', xml.indexOf('<per-minute>60</per-minute>') >= 0);
  const norm = H.normalizeSong(JSON.parse(JSON.stringify(H.getSong())));
  check('key/tempo changes survive save & reload', norm.keyChanges.length === 1 && norm.tempoChanges.length === 1 && norm.tempoChanges[0].bpm === 60);
  check('a bad key change is dropped on reload', H.normalizeSong({ notes: [], keyChanges: [ { beat: 4, key: 'H' } ] }).keyChanges.length === 0);
})();

// v2.12: MIDI export and import round trip.
section('MIDI export / import (v2.12)');
(function(){
  const mel = [ note('E', 0, 4, 'q'), note('D', 0, 4, 'q'), note('C', 0, 4, 'h'), note('G', 0, 4, 'h'), note('G', 0, 4, 'h') ];
  mel[0].lyric = 'Si-'; mel[0].dynamic = 'p'; mel[3].tied = true;
  const alto = [ note('C', 0, 4, 'h'), note('B', 0, 3, 'h'), note('D', 0, 4, 'w') ];
  const s = fourPartSong({ notes: mel, tempo: 80, key: 'C',
    parts: [ { id: 'S', role: 'S', clef: 'treble' }, { id: 'A', role: 'A', clef: 'treble', notes: alto } ],
    keyChanges: [ { beat: 4, key: 'G' } ], tempoChanges: [ { beat: 4, bpm: 120 } ] });
  H.setSong(s); H.render();
  const bytes = H.buildMidi();
  check('Save .mid writes a Standard MIDI File header', String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === 'MThd' && bytes[9] === 1);
  const smf = H.parseMidiBytes(bytes);
  check('one conductor track plus one track per stave', smf.tracks.length === 3 && smf.tracks[1].name === 'Soprano' && smf.tracks[2].name === 'Alto');
  const ons = smf.tracks[1].events.filter(e => e.type === 'on');
  check('tied notes become one long MIDI note', ons.length === 4);
  check('a dynamic sets the velocity', ons[0].vel === 54);
  check('lyrics are written as lyric events', smf.tracks[1].events.some(e => e.type === 'lyric' && e.text === 'Si-'));
  const score = H.midiToScore(smf, 'test.mid');
  check('the conductor track’s name becomes the title', score.title === 'Harmonizer song');
  const built = H.buildSongFromScore(score, { melody: 0, include: [0, 1], independent: true }, 'test.mid');
  const t = built.song;
  const pitches = t.notes.filter(n => n.type === 'note').map(n => n.letter + n.accidental + n.octave + n.duration).join(' ');
  check('melody pitches and rhythms survive the round trip', pitches === 'E04q D04q C04h G04w');
  check('tempo and tempo change survive', t.tempo === 80 && t.tempoChanges.length === 1 && t.tempoChanges[0].beat === 4 && t.tempoChanges[0].bpm === 120);
  check('key change survives', t.key === 'C' && t.keyChanges.length === 1 && t.keyChanges[0].key === 'G');
  check('the second stave comes back as Alto with its own rhythm', t.parts[1].role === 'A' && t.parts[1].notes.filter(n => n.type === 'note').length === 3);
  check('lyrics come back', t.notes[0].lyric === 'Si-');

  // a single track playing two notes at once is split into two lines (top / bottom)
  function vlq(n){ const b = [n & 0x7f]; n >>= 7; while (n){ b.unshift((n & 0x7f) | 0x80); n >>= 7; } return b; }
  const ev = [];
  function on(d, k){ ev.push(...vlq(d), 0x90, k, 80); }
  function off(d, k){ ev.push(...vlq(d), 0x80, k, 0); }
  on(0, 72); on(0, 64); off(480, 72); off(0, 64);     // C5 + E4, one beat
  on(0, 71); on(0, 62); off(480, 71); off(0, 62);     // B4 + D4
  on(0, 72); off(960, 72);                             // C5 alone
  ev.push(0, 0xFF, 0x2F, 0);
  const trk = [0x4D,0x54,0x72,0x6B, 0,0,(ev.length>>8)&255, ev.length&255].concat(ev);
  const file = new Uint8Array([0x4D,0x54,0x68,0x64,0,0,0,6,0,0,0,1,1,0xE0].concat(trk));
  const sc2 = H.midiToScore(H.parseMidiBytes(file), 'duet.mid');
  check('a two-note-at-a-time track is split into an upper and a lower line', sc2.parts.length === 2 && /upper/.test(sc2.parts[0].name) && /lower/.test(sc2.parts[1].name));
  const up = sc2.parts[0].events.filter(e => !e.rest).map(e => e.pitch.letter + e.pitch.octave).join(' ');
  const lo = sc2.parts[1].events.filter(e => !e.rest).map(e => e.pitch.letter + e.pitch.octave).join(' ');
  check('upper line takes the top notes', up === 'C5 B4 C5');
  check('lower line takes the bottom notes, doubling where only one sounds', lo === 'E4 D4 C5');
  check('no key signature in the file: a key is picked from the notes', sc2.parts[0].key.fifths === 0);
})();

// v2.13: range warnings and parallel fifths/octaves detection.
section('Range warnings and parallels (v2.13)');
(function(){
  check('a soprano C4 is in range', H.rangeStatus('S', 60) === 0);
  check('a soprano B5 is above range', H.rangeStatus('S', 83) === 1);
  check('a bass D2 is below range', H.rangeStatus('B', 38) === -1);
  const st = H.getState();
  st.showRangeWarnings = true;
  check('a tenor-clef note is judged at sounding pitch (written C5 = sounding C4: fine for a tenor)',
    H.rangeWarningFor({ role: 'T', clef: 'tenor8va' }, { letter: 'C', accidental: 0, octave: 5 }) === null);
  const w = H.rangeWarningFor({ role: 'A', clef: 'treble' }, { letter: 'G', accidental: 0, octave: 5 });
  check('an alto G5 gets a warning that names the range', /Above the Alto/.test(w || '') && /G3/.test(w) && /D5/.test(w));
  st.showRangeWarnings = false;
  check('warnings can be switched off', H.rangeWarningFor({ role: 'A', clef: 'treble' }, { letter: 'G', accidental: 0, octave: 5 }) === null);
  st.showRangeWarnings = true;

  // soprano C5 D5 E5 over bass F3 G3 A3: C5/F3 is a fifth (compound), D5/G3 a fifth -> parallel
  // fifths; D5/G3 -> E5/A3 again. Alto holds, so it is never part of a parallel.
  const s = fourPartSong({
    notes: [ note('C', 0, 5), note('D', 0, 5), note('E', 0, 5), note('E', 0, 5) ],
    parts: [ { id: 'S', role: 'S', clef: 'treble' }, { id: 'A', role: 'A', clef: 'treble', notes: [ note('A', 0, 4, 'w') ] },
             { id: 'B', role: 'B', clef: 'bass', notes: [ note('F', 0, 3), note('G', 0, 3), note('A', 0, 3), note('C', 0, 3) ] } ]
  });
  H.setSong(s); H.render();
  const par = H.findParallels();
  check('parallel fifths between two moving voices are found', par.length === 2 && par.every(p => p.kind === 5 && p.a.partId === 'S' && p.b.partId === 'B'));
  check('contrary motion out of the fifth is not flagged', !par.some(p => p.from === 2));
  // octaves (v2.25: a unison-to-unison move is a doubled part and is NOT flagged)
  const s2 = fourPartSong({
    notes: [ note('C', 0, 5), note('D', 0, 5) ],
    parts: [ { id: 'S', role: 'S', clef: 'treble' }, { id: 'A', role: 'A', clef: 'treble', notes: [ note('C', 0, 5), note('D', 0, 5) ] },
             { id: 'B', role: 'B', clef: 'bass', notes: [ note('C', 0, 3), note('D', 0, 3) ] } ]
  });
  H.setSong(s2); H.render();
  const p2 = H.findParallels();
  check('parallel octaves are found as 8s, unisons are not (doubled part)', p2.length === 2 && p2.every(p => p.kind === 8 && p.b.partId === 'B'));
  // a fifth that holds (no motion) or moves to a different interval is fine
  const s3 = fourPartSong({
    notes: [ note('G', 0, 4), note('A', 0, 4) ],
    parts: [ { id: 'S', role: 'S', clef: 'treble' }, { id: 'B', role: 'B', clef: 'bass', notes: [ note('C', 0, 4), note('C', 0, 4) ] } ]
  });
  H.setSong(s3); H.render();
  check('a fifth moving to a sixth over a held bass is not a parallel', H.findParallels().length === 0);
})();

// v2.15: the examples list (data/index.json, or a server's directory listing) and "no music yet".
section('Examples list and empty library (v2.15)');
(function(){
  const fromJson = H.parseExampleIndex([ 'Byrd-Ave-Verum-Corpus.mid', { file: 'Poulenc-Salve-Regina.mid', title: 'Poulenc — Salve Regina' }, 'notes.txt', '../secret.mid', 'http://x/y.mid' ], false);
  check('index.json: names and {file,title} entries are read; other files and escapes are ignored',
    fromJson.length === 2 && fromJson[0].title === 'Byrd Ave Verum Corpus' && fromJson[1].title === 'Poulenc — Salve Regina');
  const html = '<a href="../">Parent Directory</a><a href="?C=N;O=D">Name</a><a href="Poulenc-O-Magnum.mid">x</a><a href="Barber%20Coolin.midi">y</a><a href="index.json">i</a>';
  const fromHtml = H.parseExampleIndex(html, true);
  check('a directory listing page yields its music files, sorted by title', fromHtml.map(e => e.file).join('|') === 'Barber%20Coolin.midi|Poulenc-O-Magnum.mid' && fromHtml[0].title === 'Barber Coolin');
  check('a song with no notes counts as blank', H.isBlankSong(H.defaultSong()));
  const withNote = H.defaultSong(); withNote.notes = [ note('C', 0, 4) ];
  check('a song with a note is not blank', !H.isBlankSong(withNote));
  H.setLibrary({ activeId: 'a', entries: [ { id: 'a', updatedAt: 1, song: H.defaultSong() } ] });
  check('a library of only empty songs counts as empty (so the welcome shows)', H.libraryIsEmpty());
  H.setLibrary({ activeId: 'a', entries: [ { id: 'a', updatedAt: 1, song: H.defaultSong() }, { id: 'b', updatedAt: 1, song: withNote } ] });
  check('one song with music makes it non-empty', !H.libraryIsEmpty());
})();

// v2.17: paginated printing -- where lines (systems) break.
section('Print layout (v2.17)');
(function(){
  // barlines every 300 units, content to 3000; lines 1400 wide, 100 of lead-in after the first
  const bars = []; for (let x = 300; x <= 3000; x += 300) bars.push(x);
  const sys = H.planPrintSystems({ barlinesX: bars }, 3000, 100, 1400);
  check('a long score is cut into several lines', sys.length === 3);
  check('lines break just after a barline', sys.slice(0, -1).every(s => bars.includes(s.xb - 1)));
  check('each line fits the width (with its lead-in)', sys.every(s => (s.xb - s.xa) + (s.first ? 0 : 100) <= 1400));
  check('lines join up with nothing lost', sys[0].xa === 0 && sys.every((s, i) => i === 0 || s.xa === sys[i - 1].xb) && sys[sys.length - 1].xb === 3000);
  const wide = H.planPrintSystems({ barlinesX: [2000, 2600] }, 2600, 100, 1400);
  check('a single measure wider than a line still gets a line of its own', wide.length === 2 && wide[0].xb === 2001);
  check('a short piece is one line', H.planPrintSystems({ barlinesX: [300, 600] }, 600, 100, 1400).length === 1);
})();

// v2.18: how Generate parts reads the music -- second-order search, cadences, suspensions,
// secondary dominants, and hearing the local key.
section('Part-writing analysis (v2.18)');
(function(){
  // viterbi2 must find the true optimum of unary + pair + triple costs (brute force check)
  const sizes = [3, 3, 3, 3];
  const U = (e, j) => ((e * 7 + j * 3) % 5) * 0.7;
  const P = (e, i, j) => Math.abs(i - j) * 0.9 + ((e + i) % 2);
  const T = (e, h, i, j) => (h === j ? 1.3 : 0) + (i === 1 ? 0.4 : 0);
  const path = H.viterbi2(4, sizes, U, P, T);
  let best = Infinity, bestPath = null;
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) for (let c = 0; c < 3; c++) for (let d = 0; d < 3; d++){
    const x = [a, b, c, d];
    let tot = U(0, a) + U(1, b) + U(2, c) + U(3, d) + P(1, a, b) + P(2, b, c) + P(3, c, d) + T(2, a, b, c) + T(3, b, c, d);
    if (tot < best - 1e-9){ best = tot; bestPath = x; }
  }
  const got = U(0, path[0]) + U(1, path[1]) + U(2, path[2]) + U(3, path[3]) + P(1, path[0], path[1]) + P(2, path[1], path[2]) + P(3, path[2], path[3]) + T(2, path[0], path[1], path[2]) + T(3, path[1], path[2], path[3]);
  check('the two-moves-back search finds the true optimum', Math.abs(got - best) < 1e-9);
  check('a leap followed by a step back costs less than one followed by more of the same', H.secondOrderMotion(60, 67, 65, 1) < 0 && H.secondOrderMotion(60, 67, 69, 1) > 0);
  check('two leaps the same way past an octave cost extra', H.secondOrderMotion(60, 67, 74, 1) > H.secondOrderMotion(60, 67, 69, 1));
  check('octave leaps in the bass are exempt', H.secondOrderMotion(48, 36, 38, 0.5, true) === 0);

  // I - V(held two notes) - I with a rest after the first phrase: 4-3 suspension and cadences
  function song4(notes, chords, style){
    return fourPartSong({ notes, chords, harmonyStyle: style || 'close' });
  }
  const s1 = song4([ note('E', 0, 5, 'h'), note('D', 0, 5), note('G', 0, 4), note('C', 0, 5, 'w') ], [ chord('C', 'maj', 0), chord('G', 'maj', 2), chord('C', 'maj', 4) ]);
  H.setSong(s1); H.render(); H.generatePartsFromMelodyAndChords();
  const g = H.getSong();
  const lines = g.parts.slice(1).map(p => p.notes.filter(n => n.type === 'note'));
  const sus = lines.find(l => l.length >= 3 && l[0].letter === 'C' && l[0].tied && l[1].letter === 'C' && l[2].letter === 'B');
  check('a 4-3 suspension is written at the cadence: prepared (tied over), then resolved down a step', !!sus);
  check('the status reports cadences and suspensions', /1 cadence/.test(H.getStatus()) && /suspension/.test(H.getStatus()));
  const bass = g.parts[3].notes.filter(n => n.type === 'note');
  check('the final chord has its root in the bass', bass[bass.length - 1].letter === 'C');

  // phrase ends: a rest ends a phrase; the chord before it is the cadence
  const s2 = song4([ note('E', 0, 5), note('D', 0, 5), note('C', 0, 5), note('D', 0, 5), note('E', 0, 5, 'h'), { id: 'r1', type: 'rest', letter: 'B', accidental: 0, octave: 4, duration: 'h', dotted: false, tuplet: null, lyric: '' },
    note('G', 0, 5), note('F', 0, 5), note('E', 0, 5), note('D', 0, 5), note('C', 0, 5, 'w') ],
    [ chord('C', 'maj', 0), chord('G', 'maj', 2), chord('C', 'maj', 4), chord('F', 'maj', 8), chord('G', 'maj', 10), chord('C', 'maj', 12) ]);
  H.setSong(s2); H.render();
  const ev = H.buildEvents(H.melodyPart()).events;
  const cads = ev.filter(e => e.cadence).map(e => e.beat + ':' + e.cadence);
  check('a rest ends a phrase, and the last note ends the piece', cads.join(',') === '4:1,12:2');
  check('the chord before a cadence is marked as its approach', ev.filter(e => e.preCadence).map(e => e.beat).join(',') === '3,11');

  // secondary dominant: D7 -> G in C major is V7/V, so F# is a leading tone to G
  const s3 = song4([ note('E', 0, 5, 'h'), note('F', 1, 5, 'h'), note('G', 0, 5, 'h'), note('G', 0, 5, 'h'), note('C', 0, 5, 'w') ],
    [ chord('C', 'maj', 0), chord('D', 'dom7', 2), chord('G', 'maj', 4), chord('G', 'dom7', 6), chord('C', 'maj', 8) ]);
  H.setSong(s3); H.render();
  const b3 = H.buildEvents(H.melodyPart());
  const d7 = b3.events.find(e => e.beat === 2);
  check('a D7 going to G is heard as V7 of G (leading tone F sharp)', b3.tonicizations === 1 && d7.chordInfo.isDominantFn && d7.chordInfo.leadingTonePc === 6);
  check('the ordinary V7 is not counted as a secondary dominant', b3.events.find(e => e.beat === 6).tonicized !== true);

  // hearing the local key: eight measures of C major, then eight of clearly G major (F sharps)
  const mel = [], chs = [];
  const cBar = ['C','E','G','E'];
  for (let m = 0; m < 8; m++){ cBar.forEach(l => mel.push(note(l, 0, 5))); chs.push(chord(m % 2 ? 'G' : 'C', 'maj', m * 4)); }
  // G major: G, C and D chords with C naturals and F sharps both present, so it can't be D major
  const gCycle = [ [['G','B','D','B'], 'G'], [['C','E','G','E'], 'C'], [['D','F','A','F'], 'D'], [['G','D','B','G'], 'G'] ];
  for (let m = 8; m < 16; m++){ const [ns, root] = gCycle[m % 4]; ns.forEach(l => mel.push(note(l, l === 'F' ? 1 : 0, 5))); chs.push({ id: 'k' + m, beat: m * 4, root: { letter: root, accidental: 0 }, quality: 'maj' }); }
  const s4 = song4(mel, chs);
  H.setSong(s4); H.render();
  const lk = H.inferLocalKeys();
  check('a long passage with F sharps is heard as G major, without any key change written', lk.at(50).tonicPc === 7 && !lk.at(50).minor && lk.at(4).tonicPc === 0);
  check('the heard key area is reported by measures', lk.heard.length === 1 && lk.heard[0].tonicPc === 7);
})();

// -------------------------------------------------------------------------
// EXPRESSIVE MARKS (v2.23) -- fermatas, breaths, tempo words, rit./accel., dynamics and
// hairpins, articulations, slurs, text, rehearsal letters; the tempo map and the dynamics
// curve that make them play; MusicXML/MIDI export; the play window's section loop.
// -------------------------------------------------------------------------
section('Expressive marks (v2.23)');
(function(){
  const q = (l, o) => note(l, 0, o || 5);
  function one(notes, extra){ return Object.assign(fourPartSong({ notes, parts: [{ id: 'S', role: 'S', clef: 'treble' }] }), extra || {}); }
  const near = (a, b, e) => Math.abs(a - b) < (e || 1e-6);

  // --- tempo map: plain, fermata, breath, rit., a tempo
  let s = one([q('C'), q('D'), q('E'), q('F')], { tempo: 60 });
  H.setSong(H.normalizeSong(s)); H.render();
  let tm = H.tempoMap(1);
  check('plain tempo: beat 3 at 3 s (60 bpm)', near(tm.sec(3), 3));

  s = one([q('C'), Object.assign(q('D'), { fermata: true }), q('E'), q('F')], { tempo: 60 });
  H.setSong(H.normalizeSong(s)); H.render();
  tm = H.tempoMap(1);
  check('a fermata holds its beat 1.75x', near(tm.endSec(2) - tm.sec(1), 1.75));
  check('...then leaves a half-beat silence before the next note', near(tm.sec(2), 1 + 1.75 + 0.5));
  check('the playhead maps back through the fermata', near(tm.beatAt(tm.sec(2.5)), 2.5));
  check('a time inside the silence reads as the next beat', near(tm.beatAt(1 + 1.75 + 0.25), 2));

  s = one([q('C'), Object.assign(q('D'), { breath: 'breath' }), q('E'), Object.assign(q('F'), { breath: 'caesura' }), q('G')], { tempo: 60 });
  H.setSong(H.normalizeSong(s)); H.render();
  tm = H.tempoMap(1);
  check('a breath mark lets go on time and adds a short silence', near(tm.endSec(2), 2) && near(tm.sec(2), 2.3));
  check('a caesura adds a full beat of silence', near(tm.sec(4) - tm.endSec(4), 1));
  const fb = H.fermataAndBreaths(H.getSong());
  check('fermataAndBreaths finds both silences', Object.keys(fb.gaps).length === 2);

  s = one([q('C'), q('D'), q('E'), q('F'), q('G'), q('A'), q('B'), q('C', 6)], { tempo: 100,
    gradualTempos: [{ beat: 0, endBeat: 4, kind: 'rit', amount: 0.5 }],
    tempoChanges: [{ beat: 6, bpm: 0, ref: 'atempo', text: 'a tempo' }] });
  H.setSong(H.normalizeSong(s)); H.render();
  const pcs = H.tempoPieces(H.getSong());
  check('rit. ramps 100 -> 50 over its span', pcs.some(p => p.b0 === 0 && p.b1 === 4 && p.bpm0 === 100 && p.bpm1 === 50));
  check('...and stays slow until a tempo', Math.abs(H.tempoMap(1).spbAt(5) - 1.2) < 1e-6);
  check('"a tempo" goes back to the tempo before the rit.', H.getSong().tempoChanges[0].bpm === 100);
  tm = H.tempoMap(1);
  check('beats slow down inside the rit.', tm.spbAt(3.9) > tm.spbAt(0.1) * 1.8);
  check('after a tempo the beat is back to 0.6 s', near(tm.spbAt(6.5), 0.6));
  s.tempoChanges = [{ beat: 6, ref: 'tempo1' }]; s.tempo = 80;
  H.setSong(H.normalizeSong(s)); H.render();
  check('"Tempo I" goes back to the opening tempo', H.tempoAt(7) === 80);

  // --- dynamics curve
  const dnotes = [Object.assign(q('C'), { dynamic: 'p', wedgeStart: 'cresc' }), q('D'), Object.assign(q('E'), { wedgeStop: true }), Object.assign(q('F'), { dynamic: 'f' }),
    Object.assign(q('G'), { artic: 'staccato' }), Object.assign(q('A'), { dynamic: 'sfz' }), q('B')];
  const cv = H.dynamicsCurve(dnotes);
  check('no dynamic yet plays as before (gain 1)', H.dynamicsCurve([q('C')])[0].gain === 1 && H.dynamicsCurve([q('C')])[0].vel === null);
  check('a crescendo rises from p toward the f after it', cv[0].vel === 54 && cv[1].vel > 54 && cv[2].vel > cv[1].vel && cv[3].vel === 92);
  check('staccato shortens the note', cv[4].len < 0.6);
  check('sfz is one note only', cv[5].vel === 104 && cv[6].vel === 92);
  const dim = H.dynamicsCurve([Object.assign(q('C'), { dynamic: 'mf', wedgeStart: 'dim' }), Object.assign(q('D'), { wedgeStop: true }), q('E')]);
  check('a diminuendo with no target goes one step down', dim[2].vel < 78);
  check('an accent adds weight', H.dynamicsCurve([Object.assign(q('C'), { artic: 'accent' })])[0].gain > 1.2);

  // --- normalize keeps every mark
  const round = H.normalizeSong(JSON.parse(JSON.stringify(one([
    Object.assign(q('C'), { fermata: true, artic: 'tenuto', breath: 'caesura', text: 'hum', wedgeStart: 'dim', dynamic: 'pp' }),
    Object.assign(q('D'), { wedgeStop: true }),
    { id: 'r', type: 'rest', letter: 'B', accidental: 0, octave: 4, duration: 'q', dotted: false, tuplet: null, lyric: '', fermata: true, text: 'G.P.' }
  ], { tempoText: 'Andante', rehearsalMarks: [{ beat: 0, label: '' }], gradualTempos: [{ beat: 1, endBeat: 3, kind: 'accel' }] }))));
  const n0 = round.notes[0];
  check('save/reload keeps note marks', n0.fermata && n0.artic === 'tenuto' && n0.breath === 'caesura' && n0.text === 'hum' && n0.wedgeStart === 'dim' && round.notes[1].wedgeStop);
  check('save/reload keeps a fermata and text on a rest', round.notes[2].fermata && round.notes[2].text === 'G.P.');
  check('save/reload keeps tempo word, rit./accel. and rehearsal marks', round.tempoText === 'Andante' && round.gradualTempos[0].amount === 1.3 && round.rehearsalMarks.length === 1);
  check('junk marks are dropped', !H.normalizeSong({ notes: [Object.assign(q('C'), { artic: 'wiggle', breath: 'sigh' })] }).notes[0].artic);

  // --- rehearsal letters
  check('rehearsal letters run A..Z, AA', H.rehearsalLetter(0) === 'A' && H.rehearsalLetter(25) === 'Z' && H.rehearsalLetter(26) === 'AA');
  const rl = H.rehearsalList({ rehearsalMarks: [{ beat: 8, label: '' }, { beat: 0, label: '' }, { beat: 4, label: 'Coda' }, { beat: 12, label: '' }] });
  check('automatic letters skip custom labels', rl.map(r => r.text).join(',') === 'A,Coda,B,C');

  // --- the Marks row, driven through applyMark on a four-part song with own-rhythm staves
  const mel = [q('E'), q('D'), q('C'), q('D'), q('E'), q('E'), q('E', 5), q('D')];
  const own = () => [q('C'), q('B', 4), q('A', 4), q('B', 4), q('C'), q('C'), q('C'), q('B', 4)];
  s = fourPartSong({ notes: mel.map(n => Object.assign({}, n)), parts: [
    { id: 'S', role: 'S', clef: 'treble' }, { id: 'A', role: 'A', clef: 'treble', notes: own() },
    { id: 'T', role: 'T', clef: 'tenor8va', notes: own() }, { id: 'B', role: 'B', clef: 'bass', notes: own().map(n => Object.assign(n, { octave: 3 })) }] });
  H.setSong(H.normalizeSong(s)); H.render();
  const st = H.getState();
  const cb = { checked: false };
  const origGet = document.getElementById;
  document.getElementById = function(id){ if (id === 'mkAllVoices') return cb; return origGet.call(document, id); };
  try {
    st.selection = [{ partId: 'S', index: 3 }];
    H.applyMark('fermata');
    check('Fermata marks the selected note only', H.getSong().notes[3].fermata && !H.getSong().parts[1].notes[3].fermata);
    H.applyMark('fermata');
    check('pressing it again takes it off', !H.getSong().notes[3].fermata);
    cb.checked = true;
    H.applyMark('fermata');
    check('with All voices, every stave gets the fermata at that beat', H.getSong().parts.slice(1).every(p => p.notes[3].fermata) && H.getSong().notes[3].fermata);
    cb.checked = false;
    st.selection = [{ partId: 'A', index: 0 }, { partId: 'A', index: 1 }, { partId: 'A', index: 2 }];
    H.applyMark('wedge:cresc');
    const a = H.getSong().parts[1].notes;
    check('a hairpin runs from the first to the last selected note', a[0].wedgeStart === 'cresc' && a[2].wedgeStop && !a[1].wedgeStart);
    H.applyMark('slur');
    check('a slur likewise', a[0].slurStart && a[2].slurStop);
    H.applyMark('dyn:pp');
    check('a dynamic goes on every selected note', a.slice(0, 3).every(n => n.dynamic === 'pp'));
    H.applyMark('artic:staccato');
    check('an articulation goes on every selected note', a.slice(0, 3).every(n => n.artic === 'staccato'));
    H.applyMark('clear');
    check('Clear marks removes them all, hairpin and slur ends too', a.slice(0, 3).every(n => !n.dynamic && !n.artic && !n.wedgeStart && !n.wedgeStop && !n.slurStart && !n.slurStop));
    st.selection = [{ partId: 'S', index: 4 }];
    H.applyMark('rehearsal');
    check('a rehearsal mark lands on the start of the selected note\'s measure', H.getSong().rehearsalMarks.length === 1 && H.getSong().rehearsalMarks[0].beat === 4);
    H.applyMark('word:Andante:80');
    check('a tempo word mid-piece becomes a tempo change with the word', H.getSong().tempoChanges.some(t => t.beat === 4 && t.text === 'Andante' && t.bpm === 80));
    st.selection = [{ partId: 'S', index: 0 }];
    H.applyMark('word:Allegro:132');
    check('a tempo word on the first note sets the opening word and tempo', H.getSong().tempoText === 'Allegro' && H.getSong().tempo === 132);
    st.selection = [{ partId: 'S', index: 5 }, { partId: 'S', index: 6 }, { partId: 'S', index: 7 }];
    H.applyMark('grad:rit');
    check('rit. spans the selected notes', H.getSong().gradualTempos.length === 1 && H.getSong().gradualTempos[0].beat === 5 && H.getSong().gradualTempos[0].endBeat === 8);
    st.selection = [{ partId: 'S', index: 6 }];
    H.applyMark('ref:atempo');
    check('a tempo lands on the selected note', H.getSong().tempoChanges.some(t => t.beat === 6 && t.ref === 'atempo'));
    st.selection = [{ partId: 'S', index: 5 }, { partId: 'S', index: 6 }];
    H.applyMark('tempo-clear');
    check('Remove tempo marks clears rit. and a tempo in the selection', !H.getSong().gradualTempos.length && !H.getSong().tempoChanges.some(t => t.beat >= 5));
  } finally { document.getElementById = origGet; }

  // --- the section loop in the play window
  H.getSong().rehearsalMarks = [{ beat: 0, label: '' }, { beat: 4, label: '' }];
  st.selection = []; st.selectedChordId = null; st.playSection = 4;
  const lr = H.loopRange();
  check('with a section picked and nothing selected, Loop repeats that section', lr.start === 4 && lr.end === 8 && lr.section === 'B');
  check('the loop text names the section', /section B/.test(H.loopRangeText(lr)));
  st.playSection = null;

  // --- Generate parts carries the melody's marks into the voices it writes
  const gs = fourPartSong({ notes: [Object.assign(q('E'), { dynamic: 'p' }), q('D'), Object.assign(note('C', 0, 5, 'h'), { fermata: true })],
    chords: [chord('C', 'maj', 0), chord('G', 'maj', 1), chord('C', 'maj', 2)] });
  H.setSong(H.normalizeSong(gs)); H.render(); H.generatePartsFromMelodyAndChords();
  const gp = H.getSong().parts.filter(p => p.id !== 'S');
  check('generated voices take the melody\'s dynamics and fermatas', gp.every(p => p.notes[0].dynamic === 'p' && p.notes[p.notes.length - 1].fermata));

  // --- MusicXML export
  const xs = one([Object.assign(q('C'), { fermata: true, artic: 'accent', text: 'hum', wedgeStart: 'cresc', dynamic: 'p' }), Object.assign(q('D'), { wedgeStop: true, breath: 'breath' }), q('E'), q('F'), q('G')],
    { tempoText: 'Adagio', rehearsalMarks: [{ beat: 4, label: '' }], gradualTempos: [{ beat: 2, endBeat: 4, kind: 'rall' }], tempoChanges: [{ beat: 4, ref: 'atempo', text: 'a tempo' }] });
  H.setSong(H.normalizeSong(xs)); H.render();
  const xml = H.buildMusicXml();
  check('MusicXML: fermata and accent', /<fermata type="upright"\/>/.test(xml) && /<articulations><accent\/><\/articulations>/.test(xml));
  check('MusicXML: breath mark', /<breath-mark\/>/.test(xml));
  check('MusicXML: hairpin start and stop', /<wedge type="crescendo"/.test(xml) && /<wedge type="stop"/.test(xml));
  check('MusicXML: text, tempo word, rall. with dashes, a tempo, rehearsal', /<words font-style="italic">hum<\/words>/.test(xml) && /<words font-weight="bold">Adagio<\/words>/.test(xml)
    && /rall\.<\/words><\/direction-type><direction-type><dashes type="start"/.test(xml) && /<dashes type="stop"/.test(xml) && /a tempo<\/words>/.test(xml) && /<rehearsal enclosure="square">A<\/rehearsal>/.test(xml));
  check('MusicXML is still well-formed-ish (every <direction> closed)', (xml.match(/<direction[ >]/g) || []).length === (xml.match(/<\/direction>/g) || []).length);

  // --- MIDI: the rit. and the fermata become tempo events, staccato shortens, dynamics set velocity
  const ms = one([Object.assign(q('C'), { dynamic: 'pp' }), Object.assign(q('D'), { artic: 'staccato' }), Object.assign(q('E'), { fermata: true }), q('F')],
    { tempo: 100, gradualTempos: [{ beat: 0, endBeat: 2, kind: 'rit' }] });
  H.setSong(H.normalizeSong(ms)); H.render();
  const mn = H.midiNotesForPart(H.melodyPart());
  check('MIDI velocity follows the dynamic', mn[0].vel === 42);
  check('MIDI staccato is shorter than written', mn[1].dur < 480 * 0.6);
  const parsed = H.parseMidiBytes(H.buildMidi());
  const tempos = [];
  parsed.tracks.forEach(t => t.events.forEach(e => { if (e.type === 'tempo') tempos.push(e); }));
  check('MIDI has tempo events stepping down through the rit. and for the fermata', tempos.length >= 6 && tempos[0].bpm > 95 && tempos.some(e => e.bpm < 72) && tempos.some(e => Math.abs(e.bpm - 40) < 0.5));

  // --- words from MusicXML
  check('import reads "rit." / "a tempo" / "Tempo I" / "Allegro" / plain text', H.importTempoWord('rit.').grad === 'rit' && H.importTempoWord('a tempo').ref === 'atempo'
    && H.importTempoWord('Tempo I').ref === 'tempo1' && H.importTempoWord('Allegro moderato').bpm === 132 && H.importTempoWord('hum') === null);
})();

// -------------------------------------------------------------------------
// REPEATS AND LYRICS (v2.24) -- the performance order (repeats, endings, D.C./D.S., Fine,
// Coda), the unrolled copy used for playback, MIDI and MusicXML; verses, hyphens, "_" holds,
// copying lyrics between staves.
// -------------------------------------------------------------------------
section('Repeats and endings (v2.24)');
(function(){
  const LET = ['C','D','E','F','G','A','B'];
  function mk(nMeasures, extra){
    const notes = []; for (let i = 0; i < nMeasures * 4; i++) notes.push(note(LET[i % 7], 0, 5));
    return H.normalizeSong(Object.assign({ notes, parts: [{ id: 'S', role: 'S', clef: 'treble' }], melodyPartId: 'S', key: 'C', timeSig: { beats: 4, unit: 4 }, tempo: 60 }, extra));
  }
  const segs = s => { H.setSong(s); return H.performanceSegments(s).map(x => x.b0 + '-' + x.b1).join(','); };
  check('no repeats: one straight pass', segs(mk(3, {})) === '0-12');
  check('an end repeat with no start goes back to the beginning', segs(mk(3, { repeatEnds: [{ beat: 8 }] })) === '0-8,0-12');
  check('1st and 2nd endings', segs(mk(5, { repeatStarts: [{ beat: 4 }], repeatEnds: [{ beat: 12 }], endings: [{ beat: 8, endBeat: 12, nums: [1] }, { beat: 12, endBeat: 16, nums: [2] }] })) === '0-12,4-8,12-20');
  check('D.C. al Fine stops at Fine', segs(mk(4, { jumps: [{ beat: 8, kind: 'fine' }, { beat: 16, kind: 'dcfine' }] })) === '0-16,0-8');
  check('D.S. al Coda: back to the segno, To Coda jumps to the Coda', segs(mk(6, { jumps: [{ beat: 4, kind: 'segno' }, { beat: 12, kind: 'tocoda' }, { beat: 16, kind: 'dscoda' }, { beat: 16, kind: 'coda' }] })) === '0-16,4-12,16-24');
  check('a repeat played three times', segs(mk(2, { repeatEnds: [{ beat: 8, times: 3 }] })) === '0-8,0-8,0-8');
  check('after a D.C. the repeats are not taken again', segs(mk(4, { repeatEnds: [{ beat: 8 }], jumps: [{ beat: 8, kind: 'fine' }, { beat: 16, kind: 'dcfine' }] })) === '0-8,0-16,0-8');
  check('after a D.C. the last ending is played', segs(mk(4, { repeatEnds: [{ beat: 8 }], endings: [{ beat: 4, endBeat: 8, nums: [1] }, { beat: 8, endBeat: 12, nums: [2] }], jumps: [{ beat: 16, kind: 'dc' }] })) === '0-8,0-4,8-16,0-4,8-16');
  check('two repeated sections with endings each start again at pass 1', segs(mk(8, {
    repeatEnds: [{ beat: 8 }, { beat: 24 }], repeatStarts: [{ beat: 12 }],
    endings: [{ beat: 4, endBeat: 8, nums: [1] }, { beat: 8, endBeat: 12, nums: [2] }, { beat: 20, endBeat: 24, nums: [1] }, { beat: 24, endBeat: 28, nums: [2] }] })) === '0-8,0-4,8-24,12-20,24-32');

  const s = mk(3, { repeatEnds: [{ beat: 8 }], tempoChanges: [{ beat: 4, bpm: 90 }],
    chords: [{ beat: 0, root: { letter: 'C', accidental: 0 }, quality: 'maj' }, { beat: 4, root: { letter: 'G', accidental: 0 }, quality: 'maj' }] });
  s.notes[0].fermata = true;
  H.setSong(s); H.render();
  const P = H.performanceOf(s);
  check('the unrolled copy is as long as the performance', P.total === 20 && P.song.notes.length === 20);
  check('its notes keep their ids (so the score lights up)', P.song.notes[8].id === s.notes[0].id && P.song.notes[8].fermata);
  check('chords come round again', P.song.chords.map(c => c.beat).join(',') === '0,4,8,12');
  check('the tempo goes back to what it was at the repeat', JSON.stringify(P.song.tempoChanges.map(t => [t.beat, t.bpm])) === '[[4,90],[8,60],[12,90]]');
  check('score and performance beats map both ways', P.toPerf(5) === 5 && P.toScore(9) === 1 && P.toScore(13) === 5 && P.toScore(19) === 11);
  // own-rhythm staves are written out too
  const s2 = mk(2, { repeatEnds: [{ beat: 8 }] });
  s2.parts.push({ id: 'A', role: 'A', clef: 'treble', notes: [note('C', 0, 4, 'w'), note('D', 0, 4, 'w')] });
  H.setSong(H.normalizeSong(s2)); H.render();
  const P2 = H.performanceOf(H.getSong());
  check('every stave with its own notes is written out', P2.song.parts[1].notes.length === 4);

  // MIDI: the performance; MusicXML: as written, with the barlines
  const s3 = mk(4, { repeatStarts: [{ beat: 4 }], repeatEnds: [{ beat: 12, times: 3 }], endings: [{ beat: 8, endBeat: 12, nums: [1, 2] }, { beat: 12, endBeat: 16, nums: [3] }],
    jumps: [{ beat: 0, kind: 'segno' }, { beat: 16, kind: 'dsfine' }, { beat: 4, kind: 'fine' }] });
  H.setSong(s3); H.render();
  const onsOf = bytes => H.parseMidiBytes(bytes).tracks.reduce((a, t) => a + t.events.filter(e => e.type === 'on' || e.type === 'noteOn' || (e.vel > 0 && e.midi !== undefined)).length, 0);
  const perfN = JSON.stringify(H.parseMidiBytes(H.buildMidi())).length, asIsN = JSON.stringify(H.parseMidiBytes(H.buildMidiAsIs())).length;
  check('Save .mid writes the repeats out (longer than the score as written)', perfN > asIsN * 1.8);
  const xml = H.buildMusicXml();
  check('MusicXML: forward and backward repeats (times 3)', /<repeat direction="forward"\/>/.test(xml) && /<repeat direction="backward" times="3"\/>/.test(xml));
  check('MusicXML: endings "1, 2" (closed) and "3" (open)', /<ending number="1, 2" type="start">1\. 2\.<\/ending>/.test(xml) && /<ending number="1, 2" type="stop"\/>/.test(xml) && /<ending number="3" type="discontinue"\/>/.test(xml));
  check('MusicXML: segno, Fine and D.S. al Fine with their sound hints', /<segno\/>/.test(xml) && /Fine<\/words><\/direction-type><sound fine="yes"\/>/.test(xml) && /D\.S\. al Fine<\/words><\/direction-type><sound dalsegno="segno"\/>/.test(xml));
  check('import reads D.C./D.S./Fine/Coda words', H.importNavWord('D.C. al Fine') === 'dcfine' && H.importNavWord('D. S. al Coda') === 'dscoda' && H.importNavWord('Fine') === 'fine' && H.importNavWord('To Coda') === 'tocoda' && H.importNavWord('hum') === null);

  // editing through the Repeat menu
  const s4 = mk(4, {});
  H.setSong(s4); H.render();
  const st = H.getState();
  st.selection = [{ partId: 'S', index: 5 }, { partId: 'S', index: 9 }];
  H.applyMark('rep:both');
  check('"Repeat these measures" puts |: on the first and :| after the last', H.getSong().repeatStarts[0].beat === 4 && H.getSong().repeatEnds[0].beat === 12);
  st.selection = [{ partId: 'S', index: 9 }];
  H.applyMark('end:1');
  check('an ending covers the measure holding the note', H.getSong().endings[0].beat === 8 && H.getSong().endings[0].endBeat === 12);
  st.selection = [{ partId: 'S', index: 14 }];
  H.applyMark('jump:dc'); H.applyMark('jump:dcfine');
  check('a new D.C. replaces the one already at that barline', H.getSong().jumps.length === 1 && H.getSong().jumps[0].kind === 'dcfine' && H.getSong().jumps[0].beat === 16);
  st.selection = [{ partId: 'S', index: 0 }, { partId: 'S', index: 15 }];
  H.applyMark('rep-clear');
  check('Remove repeats & jumps clears the selected measures', !H.getSong().repeatStarts.length && !H.getSong().repeatEnds.length && !H.getSong().endings.length && !H.getSong().jumps.length);
  check('save/reload keeps repeats, endings and jumps', H.normalizeSong(JSON.parse(JSON.stringify(s3))).endings[0].nums.join() === '1,2' && H.normalizeSong(JSON.parse(JSON.stringify(s3))).jumps.length === 3);
  st.selection = [];
})();

section('Lyrics: verses, hyphens, holds (v2.24)');
(function(){
  check('words split into syllables keeping their hyphens', H.lyricTokens('Twin-kle twin-kle lit-tle star').join('|') === 'Twin-|kle|twin-|kle|lit-|tle|star');
  check('"_" and "word__" hold a syllable', H.lyricTokens('are__ _ how').join('|') === 'are|_|_|_|how');
  const n = note('C', 0, 5);
  H.setLyricAt(n, 0, 'one'); H.setLyricAt(n, 2, 'three');
  check('verses 2+ live in note.verses', n.lyric === 'one' && n.verses.length === 2 && n.verses[0] === '' && H.lyricAt(n, 2) === 'three');
  H.setLyricAt(n, 2, '');
  check('clearing the last verse tidies up', !n.verses);
  const s = fourPartSong({ notes: [note('C',0,5), note('D',0,5), note('E',0,5,'h'), note('F',0,5,'h')], parts: [{ id: 'S', role: 'S', clef: 'treble' },
    { id: 'A', role: 'A', clef: 'treble', notes: [note('A',0,4), note('B',0,4), note('C',0,5), note('C',0,5), note('C',0,5,'h')] }] });
  ['Twin-', 'kle', 'star', 'bright'].forEach((t, i) => H.setLyricAt(s.notes[i], 0, t));
  ['Up', 'a-', 'bove', 'high'].forEach((t, i) => H.setLyricAt(s.notes[i], 1, t));
  H.setSong(H.normalizeSong(JSON.parse(JSON.stringify(s)))); H.render();
  const g = H.getSong();
  check('save/reload keeps every verse', H.lyricAt(g.notes[1], 1) === 'a-' && H.verseCountOf(g) === 2);
  check('a verse reads back as text', H.lyricTextOf(g.notes, 0) === 'Twin-kle star bright');
  const r = H.copyLyricsToStaves('S');
  const a = g.parts[1].notes;
  check('Copy lyrics puts each syllable on the note starting with it, "_" inside a longer note', r.staves === 1 && a[0].lyric === 'Twin-' && a[1].lyric === 'kle' && a[2].lyric === 'star' && a[3].lyric === '_' && a[4].lyric === 'bright');
  check('...every verse of it', H.lyricAt(a[2], 1) === 'bove' && H.lyricAt(a[3], 1) === '_');
  H.render();
  const svg = document.getElementById('staffSvg');
  const count = cls => {
    let c = 0;
    (function walk(e){ (e && e.children || []).forEach(ch => { const k = (ch && ch.getAttribute && ch.getAttribute('class')) || ''; if (k.split(' ').indexOf(cls) >= 0) c++; walk(ch); }); })(svg);
    return c;
  };
  check('hyphens and extenders are drawn', count('lyric-hyphen') >= 2 && count('lyric-extender') >= 1);
  const xml = H.buildMusicXml();
  check('MusicXML writes both verses, with syllabic and <extend/>', /<lyric number="2"><syllabic>begin<\/syllabic><text>a<\/text>/.test(xml) && /<text>star<\/text><extend\/><\/lyric>/.test(xml) && /<lyric number="1"><syllabic>begin<\/syllabic><text>Twin<\/text>/.test(xml));
})();

section('Parallels: doubled parts (v2.25)');
(function(){
  const s = fourPartSong({ notes: [note('E',0,5), note('F',0,5), note('G',0,5)], parts: [
    { id: 'S', role: 'S', clef: 'treble' },
    { id: 'A', role: 'A', clef: 'treble', notes: [note('E',0,5), note('F',0,5), note('G',0,5)] },
    { id: 'T', role: 'T', clef: 'tenor8va', notes: [note('E',0,5), note('F',0,5), note('G',0,5)] } ] });
  H.setSong(H.normalizeSong(s)); H.render();
  const found = H.findParallels();
  const pairs = found.map(p => p.a.partId + p.b.partId);
  check('two staves on exactly the same notes are a doubled part, not parallel octaves', !pairs.some(p => p === 'SA'));
  check('the same line an octave apart is still flagged', pairs.includes('ST') && pairs.includes('AT'));
})();

section('Divisi on one stave (v2.26)');
(function(){
  const pr = n => n.type === 'note' ? n.letter + (n.accidental || '') + n.octave + (n.divisi ? '/' + n.divisi.letter + n.divisi.octave + (n.divisi.tied ? '~' : '') : '') + n.duration + (n.tied ? '~' : '') : 'r' + n.duration;
  const show = l => l.map(pr).join(' ');
  // same rhythm: unisons stay single notes, differences become two-note chords
  let r = H.mergeLines([note('F',0,4), note('G',0,4), note('A',0,4)], [note('F',0,4), note('E',0,4), note('A',0,4)]);
  check('same notes merge to one; a different note becomes a divisi', r.ok && show(r.notes) === 'F4q G4/E4q A4q' && r.divisi === 1);
  // one holds while the other moves: the held note is split into tied pieces
  r = H.mergeLines([note('C',0,5,'h')], [note('A',0,4), note('G',0,4)]);
  check('a held upper note over a moving lower line is split and tied', r.ok && show(r.notes) === 'C5/A4q~ C5/G4q');
  r = H.mergeLines([note('A',0,4), note('B',0,4)], [note('F',0,4,'h')]);
  check('a held lower note under a moving upper line: tied divisi', r.ok && show(r.notes) === 'A4/F4~q B4/F4q');
  // rests: where the upper rests the lower sings as the main note
  r = H.mergeLines([{ id: 'r', type: 'rest', letter: 'B', accidental: 0, octave: 4, duration: 'q', dotted: false, tuplet: null, lyric: '' }, note('D',0,5)], [note('A',0,4), note('B',0,4)]);
  check('where the upper rests, the lower line takes the stem', r.ok && show(r.notes) === 'A4q D5/B4q');
  // triplets that don't line up can't share a stem
  const trip = g => Object.assign(note('C',0,5,'e'), { tuplet: { groupId: g, count: 3, timeOf: 2 } });
  r = H.mergeLines([trip('t'), trip('t'), trip('t')], [note('A',0,4,'e'), note('A',0,4,'e')]);
  check('triplets against duplets are refused (reported, not mangled)', !r.ok && r.problems.length > 0);
  // marks and words stay with the first piece; a split gives back both lines
  const up = [Object.assign(note('E',0,5,'h'), { lyric: 'lip', dynamic: 'p' }), note('D',0,5)];
  const lo = [note('C',0,5), note('B',0,4), note('B',0,4)];
  r = H.mergeLines(up, lo);
  check('words and dynamics stay on the first piece of a split note', r.notes[0].lyric === 'lip' && r.notes[0].dynamic === 'p' && !r.notes[1].lyric && r.notes[0].tied);
  const sp = H.splitDivisi(r.notes);
  const beats = l => { const D = { w: 4, h: 2, q: 1, e: .5, s: .25 }; const out = []; l.forEach(n => { const d = D[n.duration] * (n.dotted ? 1.5 : 1); for (let x = 0; x < d - 1e-9; x += .25) out.push(n.type === 'note' ? n.letter + n.octave : '-'); }); return out.join(' '); };
  check('Split divisi gives back both lines exactly', beats(sp.upper) === beats(up) && beats(sp.lower) === beats(lo));
  // sounds: a tied divisi is one sound
  const ds = H.divisiSounds([Object.assign(note('A',0,4), { divisi: { letter: 'F', accidental: 0, octave: 4, tied: true } }), Object.assign(note('B',0,4), { divisi: { letter: 'F', accidental: 0, octave: 4 } })]);
  check('a tied divisi plays as one held note', ds.length === 1 && ds[0].beats === 2);
  // normalize keeps it; drops a divisi that equals its note
  const nn = H.normalizeSong({ notes: [Object.assign(note('A',0,4), { divisi: { letter: 'F', accidental: 1, octave: 4, tied: true } }), Object.assign(note('B',0,4), { divisi: { letter: 'B', accidental: 0, octave: 4 } })] });
  check('save/reload keeps a divisi (and drops one that duplicates its note)', nn.notes[0].divisi.accidental === 1 && nn.notes[0].divisi.tied && !nn.notes[1].divisi);

  // Staves: combine two own-rhythm staves, then split them again
  const s = fourPartSong({ notes: [note('C',0,5), note('D',0,5), note('E',0,5), note('F',0,5)], parts: [
    { id: 'S', role: 'S', clef: 'treble' },
    { id: 'A', role: 'A', clef: 'treble', notes: [note('A',0,4), note('B',0,4), note('C',0,5), note('C',0,5)] },
    { id: 'A2', role: 'A2', clef: 'treble', notes: [note('A',0,4), note('G',0,4), note('C',0,5), note('A',0,4)] },
    { id: 'B', role: 'B', clef: 'bass', notes: [note('F',0,3), note('G',0,3), note('C',0,3), note('F',0,3)] } ] });
  H.setSong(H.normalizeSong(s)); H.render();
  H.combineWithBelow('A');
  let g = H.getSong();
  check('Combine with the stave below: one stave fewer, divisi where they differed', g.parts.length === 3 && g.parts[1].id === 'A' && show(g.parts[1].notes) === 'A4q B4/G4q C5q C5/A4q');
  const xml = H.buildMusicXml();
  check('MusicXML writes a divisi as a <chord/> note', (xml.match(/<note><chord\/>/g) || []).length === 2);
  const mid = H.parseMidiBytes(H.buildMidi());
  const altoTrack = mid.tracks.find(t => /Alto/.test(t.name || ''));
  check('MIDI plays both notes of the divisi', altoTrack && altoTrack.events.filter(e => e.type === 'on').length === 6);
  const lines = H.findParallels();   // must not throw with a divisi line in play
  check('the parallels check copes with a divisi stave', Array.isArray(lines));
  H.splitDivisiStave('A');
  g = H.getSong();
  check('Split divisi puts the lower notes back on a stave below', g.parts.length === 4 && g.parts[2].role === 'A2' && show(g.parts[2].notes) === 'A4q G4q C5q A4q' && !g.parts[1].notes.some(n => n.divisi));
  H.undo(); H.undo();
  check('Undo steps back through split and combine', H.getSong().parts.length === 4 && !H.getSong().parts[1].notes.some(n => n.divisi));
  // Selected panel: add a third below / above
  const n3 = note('E',0,5);
  H.addDivisiTo(n3, -2, 0);
  check('"+ 3rd below" adds a third below in the key', n3.divisi.letter === 'C' && n3.divisi.octave === 5);
})();

// v2.28: import fidelity -- MIDI meters, fermatas, dynamics, markers; section words; the report
section('Import fidelity (v2.28)');
(function(){
  function vlq(n){ const b = [n & 0x7f]; n >>= 7; while (n){ b.unshift((n & 0x7f) | 0x80); n >>= 7; } return b; }
  const PPQ = 480, ev = [];
  let last = 0;
  const raw = [];   // [tick, bytes]
  const meta = (tick, type, data) => raw.push([tick, [0xFF, type, ...vlq(data.length), ...data]]);
  const txt = s => Array.from(Buffer.from(s, 'utf8'));
  const tempo = bpm => { const u = Math.round(60000000 / bpm); return [(u >> 16) & 255, (u >> 8) & 255, u & 255]; };
  meta(0, 0x58, [4, 2, 24, 8]);          // 4/4 ...
  meta(0, 0x58, [6, 3, 24, 8]);          // ... then 6/8 at the same moment: 6/8 counts
  meta(0, 0x51, tempo(100));
  meta(0, 0x06, txt('Verse 1'));
  meta(16 * PPQ, 0x06, txt('Chorus'));
  meta(22 * PPQ, 0x51, tempo(20));       // a fermata written as a brief tempo drop
  meta(22 * PPQ + 120, 0x51, tempo(100));
  const keys = [60, 62, 64, 65, 67, 69, 71, 72];
  for (let i = 0; i < 32; i++){
    const vel = i < 16 ? [52, 54, 56][i % 3] : [90, 92, 94][i % 3];
    raw.push([i * PPQ, [0x90, keys[i % 8], vel]]);
    raw.push([i * PPQ + PPQ - 10, [0x80, keys[i % 8], 0]]);
  }
  raw.push([0, [0x90, 60, 52]]); raw.push([PPQ - 10, [0x80, 60, 0]]);   // the first note struck twice
  raw.sort((a, b) => a[0] - b[0]);
  raw.forEach(([t, b]) => { ev.push(...vlq(t - last), ...b); last = t; });
  ev.push(0, 0xFF, 0x2F, 0);
  const trk = [0x4D,0x54,0x72,0x6B, (ev.length>>24)&255, (ev.length>>16)&255, (ev.length>>8)&255, ev.length&255].concat(ev);
  const file = new Uint8Array([0x4D,0x54,0x68,0x64,0,0,0,6,0,0,0,1,(PPQ>>8)&255,PPQ&255].concat(trk));
  const sc = H.midiToScore(H.parseMidiBytes(file), 'fid.mid');
  const p0 = sc.parts[0];
  check('two time signatures at the start: the last one (6/8) is the opening meter', p0.firstMeter.beats === 6 && p0.firstMeter.unit === 8 && p0.meterChanges.length === 0);
  check('a note struck twice at once is one note, not a two-line chord', sc.parts.length === 1 && sc.srcGlobal && p0.srcTally.notes === 32);
  check('a brief deep tempo drop is not a tempo change...', p0.tempoMarks.every(m => m.bpm === 100));
  const ferm = p0.events.filter(e => e.fermata);
  check('...it is a fermata on the note sounding there', ferm.length === 1 && Math.abs(ferm[0].start - 22) < 0.01);
  const dyn = p0.events.filter(e => e.dynamic).map(e => e.start + ':' + e.dynamic).join(' ');
  check('velocities become dynamics, only where the level lasts', dyn === '0:p 16:f');
  const built = H.buildSongFromScore(sc, { melody: 0, include: [0], independent: true, divisi: true }, 'fid.mid');
  check('marker events become named rehearsal marks', built.song.rehearsalMarks.map(r => r.label).join('|') === 'Verse 1|Chorus');
  const fid = H.importFidelity(sc, { melody: 0, include: [0] }, built);
  const notesRow = fid.rows.find(r => r.label === 'Notes');
  check('the import report counts every note in and every note kept', notesRow && notesRow.src === 32 && notesRow.got === 32 && !notesRow.short);
  check('the report lists the tempo-drop fermata and the dynamics it read', fid.rows.some(r => /Fermatas/.test(r.label) && r.src === 1 && r.got === 1) && fid.rows.some(r => /velocities/.test(r.label) && /2 marks/.test(r.got)));
  check('nothing lost: the report does not pop up', fid.lossy === false);
  // one fixed velocity (a sequenced file): no dynamics at all
  const flat = [0, 1, 2, 3, 4, 5, 6, 7].map(i => ({ start: i, dur: 1 })), flatSrc = flat.map(() => ({ src: { vel: 80 } }));
  check('a line with one fixed velocity gets no dynamics', H.midiInferDynamics(flat, flatSrc) === 0 && !flat.some(e => e.dynamic));
  // section words
  check('section words are recognised', ['Verse 1', 'Chorus 4 Repeat', 'Bridge', 'Final Chorus', 'Intro', 'Refrain', 'Verse II'].every(w => H.importSectionWord(w)));
  // a rit. written as a run of small tempo steps, and a volume swell -> one rit. span and one hairpin
  {
    const raw2 = [], ev2 = []; let last2 = 0;
    raw2.push([0, [0xFF, 0x51, 3, ...tempo(100)]]);
    [96, 92, 88, 84, 80].forEach((bpm, i) => raw2.push([(12 + i * 0.5) * PPQ, [0xFF, 0x51, 3, ...tempo(bpm)]]));
    raw2.push([0, [0xB0, 7, 64]]);
    [70, 76, 82, 88, 94].forEach((v, i) => raw2.push([(4 + i * 0.5) * PPQ, [0xB0, 7, v]]));
    for (let i = 0; i < 16; i++){ raw2.push([i * PPQ, [0x90, 67, 80]]); raw2.push([i * PPQ + PPQ - 10, [0x80, 67, 0]]); }
    raw2.sort((a, b) => a[0] - b[0]);
    raw2.forEach(([t, b]) => { ev2.push(...vlq(t - last2), ...b); last2 = t; });
    ev2.push(0, 0xFF, 0x2F, 0);
    const trk2 = [0x4D,0x54,0x72,0x6B, (ev2.length>>24)&255, (ev2.length>>16)&255, (ev2.length>>8)&255, ev2.length&255].concat(ev2);
    const file2 = new Uint8Array([0x4D,0x54,0x68,0x64,0,0,0,6,0,0,0,1,(PPQ>>8)&255,PPQ&255].concat(trk2));
    const sc2 = H.midiToScore(H.parseMidiBytes(file2), 'ramp.mid');
    const b2 = H.buildSongFromScore(sc2, { melody: 0, include: [0], independent: true, divisi: true }, 'ramp.mid');
    const gt = b2.song.gradualTempos;
    check('a run of small tempo steps becomes one rit. span', gt.length === 1 && gt[0].kind === 'rit' && gt[0].beat === 12 && Math.abs(gt[0].amount - 0.8) < 0.01);
    check('...arriving at the last tempo, not a string of tempo changes', b2.song.tempoChanges.length === 1 && b2.song.tempoChanges[0].bpm === 80);
    const w = sc2.parts[0].events.filter(e => e.wedgeStart || e.wedgeStop).map(e => e.start + (e.wedgeStart ? '<' + e.wedgeStart : '>|')).join(' ');
    check('a swell in channel volume becomes a crescendo hairpin over the notes it covers', w === '3<cresc 5>|');
    const f2 = H.importFidelity(sc2, { melody: 0, include: [0] }, b2);
    check('the report counts the rit. and the hairpin', f2.rows.some(r => /Tempo/.test(r.label) && /rit/.test(r.note)) && f2.rows.some(r => /Hairpins/.test(r.label) && r.src === 1 && r.got === 1));
  }
  // a lower line holding through the upper line's moving notes keeps its tie (no re-strike)
  const up = [note('C',0,5,'q'), note('D',0,5,'e'), note('E',0,5,'e')], lo = [note('C',0,5,'h')];
  const m = H.mergeLines(up, lo);
  const desc = m.notes.map(n => n.letter + n.octave + n.duration + (n.tied ? '~' : '') + (n.divisi ? '/' + n.divisi.letter + n.divisi.octave : '')).join(' ');
  check('a held lower note stays the main head, tied, under the moving upper notes', m.ok && desc === 'C5q~ C5e~/D5 C5e/E5');
  const sp = H.splitDivisi(m.notes);
  const line = l => l.map(n => n.letter + n.octave + n.duration + (n.tied ? '~' : '')).join(' ');
  check('...and Split divisi gives each voice back its own notes and ties', line(sp.upper) === 'C5q D5e E5e' && line(sp.lower) === 'C5q~ C5e~ C5e');
  check('ordinary text is not a section', ['cresc.', 'with feeling', 'Allegro', '3', 'solo', 'Verse one of the many'].every(w => !H.importSectionWord(w)));
})();

// v2.31: partwriting fixes from the Sep 2026 guide review. A 14-chord chorale in C with every
// melody note a chord tone: no chord may lose its third (the doubling cost used to charge a
// factor's FIRST appearance), the bass stays well under the melody (Hymn used to end on four
// unison Cs), the G7 keeps its leading tone, and with the tune in the tenor nothing crosses it.
section('Partwriting fixes (v2.31)');
(function(){
  const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }, SHIFT = { treble: 0, tenor8va: -12, bass: 0 }, BEATS = { w: 4, h: 2, q: 1 };
  function at(list, clef, beat){ let t = 0; for (const n of list){ const d = BEATS[n.duration];
    if (beat >= t - 1e-6 && beat < t + d - 1e-6) return n.type === 'note' ? SEMI[n.letter] + n.accidental + 12 * (n.octave + 1) + SHIFT[clef] : null; t += d; } return null; }
  const mel = [['G4','C'],['G4','C'],['F4','Dm'],['E4','C'],['D4','G'],['E4','C'],['G4','C'],['A4','F'],['G4','C'],['G4','C'],['F4','G7'],['E4','C'],['D4','G'],['C4','C']];
  const Q = { C: 'maj', Dm: 'min', G: 'maj', G7: 'dom7', F: 'maj' };
  function run(style, melodyId){
    const s = fourPartSong({ harmonyStyle: style, melodyPartId: melodyId || 'S',
      notes: mel.map((m, i) => { const x = /([A-G])(\d)/.exec(m[0]); return note(x[1], 0, +x[2], i === mel.length - 1 ? 'w' : 'h'); }),
      chords: mel.map((m, i) => chord(m[1].replace(/m|7/, ''), Q[m[1]], i * 2)) });
    H.setSong(s); H.render(); H.generatePartsFromMelodyAndChords();
    const g = H.getSong();
    return mel.map((m, i) => g.parts.map(p => at(p.id === g.melodyPartId ? g.notes : p.notes, p.clef, i * 2)));
  }
  ['close', 'hymn', 'open'].forEach(st => {
    const V = run(st);
    const missing = V.filter((v, i) => { const c = mel[i][1], r = SEMI[c[0]], th = (r + (c === 'Dm' ? 3 : 4)) % 12; return !v.some(x => x % 12 === th); }).length;
    check(st + ': every chord keeps its third', missing === 0);
    check(st + ': the G7 keeps its leading tone (B)', V[10].some(x => x % 12 === 11));
    check(st + ': the bass stays at least an octave under the melody at the end', V[V.length - 1][0] - V[V.length - 1][3] >= 12);
    check(st + ': the final chord is not a unison', new Set(V[V.length - 1]).size >= 3);
  });
  const T = run('close', 'T');
  check('tenor lead: the soprano stays above the melody and the bass below it', T.every(v => v[0] >= v[2] && v[2] >= v[3]));
})();

console.log('\n' + count + ' checks, ' + fails + ' failure(s).');
process.exitCode = fails ? 1 : 0;
