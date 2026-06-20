# Fermata

*In music, a fermata instructs the performer to hold a note for as long as the conductor decides. Time does not resume until they say so.*

Fermata is a Chrome extension that gives you the same authority over a live web page. Freeze its clock and the page itself tilts back into 3D — a slab of frozen glass, still alive, orbiting gently under your cursor. Step time in exact increments. Drag the frozen world through its motion. Fan an animation into echoes — its past receding behind it, its future standing ahead — inside the page's own space. Then record the moment into a frame-perfect storyboard.

The mechanism: Fermata takes ownership of the page's clock — `performance.now`, `Date.now`, `new Date()`, rAF timestamps, and the entire timer queue — so every kind of motion, JS-driven or declarative, runs at your rate. Not a recording. Not a replay. The page is live; its sense of time is yours.

---

## Install

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this folder
3. Reload the tab once — the clock engine injects at `document_start` and must arrive before the page's own scripts
4. Press `⌥⇧F` (or click the toolbar icon)

---

## How it reads

Everything is one key, named in plain words. A quiet capsule at the bottom of the page shows the core moves — freeze, speed, record, leave — and keeps the studies (echo, score, trail, link) one `···` away; every hint is also a button, and each explains itself on hover. Rest the cursor on something that moves and the studies introduce themselves in a quiet word beside it. Entering is a sequence, not a popup: a crest of golden light enters above the page and travels down it like a sea swell — the light is the protagonist; the page only breathes a few pixels as it passes — then the word *fermata* lands center stage, then the capsule rises at the foot. Leaving runs the swell bottom-to-top, shorter and quieter, an exhale. (Honored: `prefers-reduced-motion` disables all of it. First visit ever, if four seconds pass without a key, one line appears: *press space*.)

**`space` — freeze.** The page's clock stops dead: rAF loops, timers, CSS, WAAPI, all of it. The live DOM tilts into perspective over a dark golden room and orbits as you move your mouse. This is not a screenshot — hover it, click it, inspect it. It's your page, mid-instant.

**`↑ ↓` — speed.** Tempo moves through the musical presets — *grave* (1/20×), *largo* (1/10×), *adagio* (¼×), *andante* (½×), *a tempo*, *presto* (2×) — each announced in serif with its plain meaning. At *grave*, a 200 ms hover transition takes four seconds. That is enough time to see what is actually happening.

**`← →` — step.** While frozen, `→` advances the forged clock 16.67 ms at a time (`shift` for 100 ms). Timers that come due inside a step actually fire — stepping executes the page's own scheduled work in order. `←` rewinds the seekable (CSS/WAAPI) motion; JS cannot be un-executed, and Fermata never pretends otherwise.

**drag — scrub.** While frozen, pull the page horizontally and its seekable motion follows, forward and back. The ribbon above the capsule is the strip itself: start and end ticks, a glowing playhead with a live timecode, the total length at the right edge — and underneath, a quiet amber seismograph of the window's activity, drawn from how much was moving and changing at each instant, so the moments are visible before you scrub to them. The strip's edges are detents: a scrub settles onto the start, and especially onto *now*, instead of stranding a pixel short. The strip is captured the moment you freeze and held for the whole session — animations that finish don't fall out of it — and anything born mid-freeze (a hover transition, a late entrance) folds in automatically. Animations that had already finished *before* the freeze are left in peace: scrubbing never rewinds a settled modal or menu entrance out from under you, and stale entrances never pollute the strip's length. The ribbon is also draggable directly. When nothing is seekable it says so, plainly.

**`[` `]` `L` — loop.** Press `[` to mark the start of the moment you care about, `]` to mark the end, and `L` to replay that region on a cycle at the chosen tempo — the way you'd loop two bars of music. The marked region shows on the ribbon. `L` alone loops the whole strip; press `L` again to stop exactly where you are; `shift L` clears the marks.

**The reel — nothing to catch, ever.** From the moment you enter, Fermata remembers every animation the page performs — it holds the live `Animation` objects, which stay seekable even after they finish. Use the page normally: open the menu, hover the card, flip the tab. Then freeze, and the ribbon spans from when you entered (or the last 30 s) to *now*, playhead at the right edge — the present. Drag left and time runs backward through everything that just happened: the dropdown you opened five seconds ago replays its entrance under your finger. No arming, no reflexes, no timing skill. The honest limit stands: this replays the declarative record (CSS/WAAPI); JS-drawn state from the past is not re-executed. Motion born *while* frozen (a hover you trigger mid-study, a timer fired by stepping) is held at its own first frame and joins the reel.

The reel covers more than animations. **Video and audio** run on the media clock, which is natively seekable both ways — tempo changes scale their playback rate, freezing pauses them, stepping advances them frame-true, and rewinding scrubs them backward through the window (within what the server makes seekable). **SVG SMIL** documents pause and seek through their own root the same way. **Canvas and WebGL** are pixels, not a record — so while the reel runs, every visible canvas is sampled into small frames a few times a second, and rewinding lays the right frame back over the canvas in the page's own space: the film. Forward stepping stays live (the draw loop re-renders under the forged clock); the film is how the past gets pixels.

**`S` — score.** Point at anything that moves and press `S`: Fermata transcribes the motion as sheet music, drawn in the page's own space — each animation a staff, its easing the melody line, duration, delay (a *rest*), and repeats noted beneath. `shift S` copies the whole thing as runnable WAAPI code. `S` again dismisses.

**`T` — trail.** Point at something that travels and press `T`: its actual trajectory through the strip is drawn in the page, with beads at equal *time* intervals — bunched beads are slow, spread beads are fast, kinks are easing inflections. Velocity, made visible. `T` again dismisses.

**`K` — link.** Copies a link to this held moment — URL, scroll, tempo, frozen strip position, loop marks. A teammate with Fermata who opens it stands where you stand. (The page loads fresh on their side, so JS-driven state is approximate; seekable motion lands exactly.)

**`E` — echo.** Point at anything that moves and press `E`. Fermata clones it into a fan of real DOM ghosts staggered through time and stacked into depth — sepia past behind, brighter future ahead. The animation's timeline, physically occupying the page. Scrub, and the whole fan slides through time. Press `E` again to dismiss.

**`R` — record.** Stop-motion capture: Chrome caps screenshots at ~2/sec, far too slow for real motion, so Fermata freezes virtual time, advances it in fixed steps, and captures each settled frame at leisure. If a loop region is marked, the frames cover exactly that region; otherwise they distribute across the whole strip, or step the clock through the next 800 virtual ms when nothing is seekable. The frame count follows the material — one frame per ~80 virtual ms, between 8 and 24 (each capture costs ~0.65 s of real time under the quota, so denser frames would mean waiting, not detail). `shift R` forces the full 24. The page flattens for capture — frames are always clean.

**`esc` — leave.** Everything restores: tilt, echoes, clock, the site's own styles.

The storyboard opens in its own tab: play the frames as a flipbook (2–24 fps), step with arrows, ghost the previous frame with onion skin (`O`), ghost the *previous take* in sepia, time-matched, for before/after comparison (`X`), or paint **motion heat** — exactly what changed between consecutive frames, as warmth (`H`). Exports: a contact sheet, the raw frames, a `.webm`, or the **motion report** — a single self-contained HTML file with the flipbook, timecodes, metadata, and heat overlays baked in, droppable into a PR or a ticket as evidence.

The toolbar badge always tells the truth about a tab's clock: `HELD`, the current rate, or nothing at 1×.

---

## What Fermata does not govern

JS-driven motion can be slowed, frozen, and stepped forward — code cannot be un-executed. But within the held window, rewinding replays what JS *did*: the ledger records the style and DOM changes code made, so its motion runs backward visually from its own history. Replays are the record, not a re-execution — stepping forward at the present edge is still the only way to run code.

All function-callback timers run through Fermata's virtual queue — including `requestIdleCallback` loops: changing the rate retimes pending timers, freezing stops them, stepping fires the ones it crosses. The legacy string form — `setTimeout("code", ms)` — falls through to the real clock.

The ledger also records styles written through the CSSOM (`insertRule` / `deleteRule`) — the channel CSS-in-JS libraries use, which `MutationObserver` cannot see — so a styled-components hover rewinds like any other change. (`adoptedStyleSheets` replacement is not yet recorded.)

Pages that capture `performance.now` into a local variable before Fermata's patch runs — possible with certain bundler patterns — escape the forged clock. Their CSS/WAAPI output is still governed.

Scroll-driven animations follow the scroll, not the clock — Fermata leaves them entirely alone, by design: their time axis is the scrollbar, and the freeze would only break their contract. Compositor scroll physics are likewise not retimed. SMIL has no rate control, so at slowed tempo SVG documents honestly keep real speed until frozen. To make WebGL readable at all, Fermata forces `preserveDrawingBuffer` at context creation — a small GPU cost on heavy WebGL pages, the same trade rrweb makes. Canvases with cross-origin content are tainted and excluded from the film.

While the page is tilted, CSS makes a transformed body the containing block for `position: fixed` — which would fling fixed headers, modals, and backdrops off-screen on any scrolled page. Fermata re-anchors them by hand for the duration of the tilt and restores their exact inline styles on release. Top-layer surfaces (modal `<dialog>`, open popovers) render above any ancestor transform, so Fermata tilts them individually about the same axis as the page. Limits: pages past ~7,000 elements skip the re-anchoring pass rather than stall, and fixed elements created *while already frozen* are not re-anchored until the next freeze.

Echoes replay an element's animations onto deep clones; effects that depend on JS per-frame mutation (rather than CSS/WAAPI keyframes) will hold their cloned-at state.

Fermata operates on the top frame only by design. To extend into iframes, set `all_frames: true` in the manifest; the capsule stays in the top frame regardless.
