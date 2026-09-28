# Harmonizer tests

A standing regression suite, kept in the app folder so it travels with the code and survives
between Claude sessions instead of being reinvented from scratch each time. Pure Node, no
install required for the main suite.

(v2.23: the undo check no longer clicks the middle of the page to drop focus -- with the new Marks row that
spot is on a stave, and a click there adds a note. v2.21: `dom-stub.js` now picks the app's own `<script>` block -- the one holding the test hook -- since
2.20 added a small analytics `<script>` in `<head>`, which the old first-block match grabbed instead.)

## Running

```
node tests/run-all.js
```

Tests whatever `current.txt` currently points at. To check a new version *before* promoting
it (i.e. before repointing `current.txt`), pass its filename explicitly:

```
node tests/run-all.js harmonizer-2.19.html
```

You can also run the two suites separately:

```
node tests/logic.test.js [file.html]
node tests/e2e.test.js   [file.html]
```

## What's here

- **`dom-stub.js`** -- a small, dependency-free browser shim. Loads a `harmonizer-x.y.html`
  file's `<script>` block under plain Node by faking just enough of `document`/`window`/
  `localStorage` for the app to run, then reads back `globalThis.__harmonizer`, an API the
  app publishes only in test mode (see below). No npm packages, no browser download --
  this is the one to reach for first, and the one worth extending as the app grows.

- **`logic.test.js`** -- the main suite, using `dom-stub.js`. Covers the harmonization
  algorithm (chord-tone selection, the Picardy-third cadence fix), MusicXML key-mode
  guessing, Generate Parts' own-rhythm/lock/invalidation behavior, and the undo/redo history
  state machine (branching, gesture coalescing, song-switch reset). Since v2.11 it also covers
  the save-failure warning, library backup export/merge, rehearsal-track selection and mix,
  the .zip writer (verified with Python's zipfile when python3 is available), and Loop's
  measure-snapped range. Since v2.12: the three Generate parts style presets (hymn style must
  write no parallel fifths/octaves; open style must spread wider than close), key and tempo
  changes (placement, local spelling in the text view, layout marks, transposition, the tempo
  map, MusicXML export, save/reload), and MIDI export/import round trips including splitting a
  two-notes-at-once track into upper and lower lines. Since v2.13: range checks (including
  tenor-clef sounding pitch) and parallel fifths/octaves detection, with the cases that must not
  be flagged. Since v2.15: reading data/index.json and directory listings for the Examples
  menu, and what counts as an empty library. Since v2.17: where the print layout breaks lines
  (at barlines, within the width, never an empty line). Since v2.18: the two-moves-back search
  (checked against brute force), leap-recovery costs, a cadential 4-3 suspension being written
  prepared and resolved, phrase ends and cadence approaches, a secondary dominant, and a G major
  passage heard in a C major song. Since v2.23: expressive marks -- the tempo map with fermatas
  (hold + silence), breath marks and caesuras, rit. ramps, a tempo / Tempo I; the dynamics curve
  (hairpins toward the next dynamic, sfz one note only, staccato length, accents); save/reload of
  every mark; rehearsal lettering; the Marks-row actions through applyMark (one stave and All
  voices, hairpin/slur spans, Clear marks, tempo words, rit., a tempo, Remove tempo marks); the
  play window's section loop; Generate parts copying the melody's marks; and the MusicXML / MIDI
  export of all of it. Since v2.24: the performance order for repeats (with and without a start
  repeat, a play count), 1st/2nd endings (and two repeated sections in a row), D.C./D.S. al Fine
  / al Coda, no repeats after a D.C. and the last ending then; the unrolled copy (note ids, chords,
  tempo put back at the repeat, both beat maps, own-rhythm staves); Save .mid written out and
  MusicXML repeat barlines / endings / segno / Fine / D.S.; the Repeat-menu actions; and lyrics --
  syllable tokens with hyphens and "_" holds, verses 2+, reading a verse back as text, copying
  lyrics to another stave beat for beat, hyphens/extenders drawn, and MusicXML verses with <extend/>.
  Since v2.25: two staves in unison are a doubled part, not parallel octaves. Since v2.26: divisi -- mergeLines (unisons once, differences as divisi, held notes split and tied either way, rests, triplets refused), marks/words on the first piece, split giving both lines back exactly, tied divisi as one sound, save/reload, Combine / Split in Staves with Undo, MusicXML <chord/> and MIDI for divisi, + 3rd below. Since v2.28: import fidelity -- a built MIDI file with two time signatures at tick 0 (the last wins), a doubled strike (one note), a brief tempo drop (a fermata, not a tempo change), velocities stepping from p to f (two dynamics, placed where the change happens), markers (named rehearsal marks); the Import report's counts on it; a fixed velocity giving no dynamics; section words; a held lower note under a moving upper line staying tied through merge and split; a run of small tempo steps becoming one rit. span, and a channel-volume swell becoming a hairpin. Since v2.31: the partwriting fixes -- on a 14-chord all-chord-tone chorale, in every style, no chord loses its third, the G7 keeps its leading tone, the bass ends at least an octave under the melody and the final chord is not a unison; with the tune in the tenor, the soprano stays above it and the bass below (these checks fail on 2.30). Always runs, always fast (a second or two).

- **`e2e.test.js`** -- an optional real-browser smoke test via
  [Playwright](https://playwright.dev), covering what `logic.test.js` can't: the actual
  static HTML/CSS (the collapsible tool sections, the icon-rail sidebar) and real user
  interactions (clicks, `Ctrl+Z`/`Ctrl+Y`). Since v2.11 it also drives a touch-style pointer
  drag, a simulated storage-full save, Export library, a real Rehearsal tracks render (checking
  the downloaded .zip holds valid WAVs -- this needs `harmonizer-piano-samples.json` beside the
  app, as in the real folder), and Loop/Speed in the play window. Since v2.12 also: the style
  dropdown, adding a key + tempo change from the Selected panel and playing across it, Save .mid
  and reopening that file, and importing an inline MusicXML fixture with a divisi, a second
  voice, a key change, a tempo change and dynamics on the harmony part. Since v2.13 also: an
  out-of-range note tinted (and untinted when switched off), and parallel octaves clicked onto
  an own-rhythm bass getting marked. Since v2.14: Space pausing and resuming from the paused
  spot, a note clicked in the play window while paused taking over as the resume point, and Stop
  forgetting it. Since v2.15 the browser test serves the folder ABOVE the app, so the app's
  ../data/ examples are reachable: it checks the first-run welcome and the Examples menu (when a
  data/ folder sits next to the app folder, as on the real site), and the Save menu. Since
  v2.16: an example's title and composer shown above the score and in the play window, and
  the hover text on the tool-section strips. Since v2.17: printing a long piece builds several
  page-width systems, each after the first with its own clef. Since v2.21: the two-panel header (Current song / Commands groups), Rehearsal tracks living in the Save menu, and the Staves section putting each stave on its own line with aligned columns. Since v2.22: Jump to beginning/end in the play window moving the play position (after Stop with a note still selected, and while paused), and Stop clearing that mark. Since v2.23: importing an inline MusicXML fixture full of marks (hairpin, staccato, accent, breath mark, fermata, "hum", Allegro, rit. with dashes, a tempo, rehearsal A and B) and checking each is drawn; the Marks row under Note entry, its Dynamics menu opening on top of the page (not clipped by the accordion), ff / Tenuto / the F key, Text... into the Selected panel and Undo; Save .musicxml writing the marks; and the play window's Section menu cueing and looping section B while playing through the fermata and rit. Since v2.24: importing a fixture with a start/end repeat, 1st and 2nd endings, a segno, Fine and D.S. al Fine and two verses with hyphens and an extender, and checking what's drawn; the play window's Repeats switch and the playhead going back at the repeat; Repeat menu -> Coda; typing lyrics through the song ("Oh-ver there_ now" into verse 3) as one Undo step; and Save .musicxml keeping it all. Since v2.26: importing The Coolin (from ../data) with Keep divisi on one stave -- four staves, divisi noteheads -- then Split divisi / Combine in Staves, + 3rd below in Selected, and playing divisi (the v2.12 divisi-import check now unticks the option to keep testing the separate-staves path). Since v2.28: an inline MusicXML fixture (clarinet in B-flat, a trill, "Verse 1" on a rest, "Untitled score") opening the Import report by itself, the flagged status-bar button reopening it, Esc closing it, concert pitch, the file-name title and the named rehearsal mark; the Byrd's four recorder-named tracks all ticked and coming in as S A T B; The Coolin opening in 12/8 with its fermatas (every import in the run now closes the report if it opened). Needs `npm install playwright` once, which
  downloads its own Chromium build (a few hundred MB) -- skip this if you don't want that;
  `run-all.js` detects it's missing and skips it automatically rather than failing.

- **`import-audit.js`** (v2.28) -- not a pass/fail test: runs every MIDI/MusicXML file in
  `../data` and `../data-private` (or the files you name) through the importer in Chromium, with
  the dialog's default choices, and prints each Import report -- what the file held, what came
  across, what didn't -- plus the chooser's ticks and the status line. `--roundtrip` also saves
  each import as MusicXML, opens that back in, and says whether every stave came back note for
  note. `--app harmonizer-x.y.html` audits a particular version. Use it after changing the
  importer, or on a new file before arranging from it.

- **`run-all.js`** -- runs both, with a plain pass/fail summary at the end. What you'd wire
  up as a pre-release gate if you ever want one (a batch file, a git pre-commit hook,
  whatever fits your workflow -- nothing here assumes one).

## How the app exposes itself to tests

At the very end of the app's `<script>` block there's a small, normally-inert block:

```js
if (typeof globalThis !== 'undefined' && globalThis.__HARMONIZER_TEST__){
  globalThis.__harmonizer = { init, getSong, setSong, guessKeyMode, undo, redo, /* ... */ };
}
```

`__HARMONIZER_TEST__` is only ever set by `dom-stub.js`, so this is completely inert in a
real browser session -- nothing about how the app behaves for you changes. When you add a
new piece of internal logic that's worth a standing test (a new algorithm, a new state
machine like undo/redo), add it to that list so `logic.test.js` can reach it. You don't need
to touch `dom-stub.js` for that -- only for genuinely new *kinds* of browser API the app
starts depending on (a new global, a new DOM method).

## Why not test through the full UI for everything

`dom-stub.js` fakes `document`/`window` well enough to run the app's *logic* -- it does not
parse the real HTML, so it has no idea that `#toolAccordion` contains `.acc-item` elements,
for instance. Calling `init()` under the stub throws for exactly that reason (`wireUi()`
expects real static markup that only exists in the actual HTML file). `logic.test.js`
sidesteps this by calling `setSong()`/`render()` directly rather than the full `init()`
path -- keep doing that for new logic tests. Anything that genuinely needs the real page
(clicking a real button, checking real CSS) belongs in `e2e.test.js` instead, where a real
browser supplies the real DOM.

## Versioning reminder

Per the project's own convention: a Harmonizer change ships as a *new*
`harmonizer-x.y.html` file (never an edit to an existing one), with `current.txt` repointed
at it once it's ready. Test the new file directly by name before repointing `current.txt`,
so a bad release never becomes "current" even briefly:

```
node tests/run-all.js harmonizer-2.19.html   # test the candidate
echo harmonizer-2.19.html > current.txt      # promote it once it's green
```
