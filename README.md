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

Everything is one key, named in plain words. A quiet capsule at the bottom of the page shows exactly what's available; every hint in it is also a button.

**`space` — freeze.** The page's clock stops dead: rAF loops, timers, CSS, WAAPI, all of it. The live DOM tilts into perspective over a dark golden room and orbits as you move your mouse. This is not a screenshot — hover it, click it, inspect it. It's your page, mid-instant.

**`↑ ↓` — speed.** Tempo moves through the musical presets — *grave* (1/20×), *largo* (1/10×), *adagio* (¼×), *andante* (½×), *a tempo*, *presto* (2×) — each announced in serif with its plain meaning. At *grave*, a 200 ms hover transition takes four seconds. That is enough time to see what is actually happening.

**`← →` — step.** While frozen, `→` advances the forged clock 16.67 ms at a time (`shift` for 100 ms). Timers that come due inside a step actually fire — stepping executes the page's own scheduled work in order. `←` rewinds the seekable (CSS/WAAPI) motion; JS cannot be un-executed, and Fermata never pretends otherwise.

**drag — scrub.** While frozen, pull the page horizontally and its seekable motion follows, forward and back. The ribbon above the capsule shows where you are in the strip.

**`E` — echo.** Point at anything that moves and press `E`. Fermata clones it into a fan of real DOM ghosts staggered through time and stacked into depth — sepia past behind, brighter future ahead. The animation's timeline, physically occupying the page. Scrub, and the whole fan slides through time. Press `E` again to dismiss.

**`R` — record.** Stop-motion capture: Chrome caps screenshots at ~2/sec, far too slow for real motion, so Fermata freezes virtual time, advances it in fixed steps, and captures each settled frame at leisure. If a motion strip was scanned, frames distribute across it end-to-end; otherwise the clock steps through the next 800 virtual ms. `shift R` records 24 frames instead of 12. The page flattens for capture — frames are always clean.

**`esc` — leave.** Everything restores: tilt, echoes, clock, the site's own styles.

The storyboard opens in its own tab: play the frames as a flipbook (2–24 fps), step with arrows, ghost the previous frame with onion skin, then export a contact sheet, the raw frames, or the motion itself as a `.webm`.

The toolbar badge always tells the truth about a tab's clock: `HELD`, the current rate, or nothing at 1×.

---

## What Fermata does not govern

JS-driven motion can be slowed, frozen, and stepped forward. It cannot be reverse-scrubbed in live page time — reversing would mean un-executing arbitrary code. For JS motion, reverse exists after recording, in the storyboard.

All function-callback timers run through Fermata's virtual queue: changing the rate retimes pending timers, freezing stops them, stepping fires the ones it crosses. The legacy string form — `setTimeout("code", ms)` — falls through to the real clock.

Pages that capture `performance.now` into a local variable before Fermata's patch runs — possible with certain bundler patterns — escape the forged clock. Their CSS/WAAPI output is still governed.

Scroll-linked animations driven by scroll position rather than time are not retimed. Video and audio elements are not retimed. Compositor scroll physics are not retimed.

While the page is tilted, elements with `position: fixed` anchor to the page rather than the viewport — a property of CSS transforms, restored the moment you release.

Echoes replay an element's animations onto deep clones; effects that depend on JS per-frame mutation (rather than CSS/WAAPI keyframes) will hold their cloned-at state.

Fermata operates on the top frame only by design. To extend into iframes, set `all_frames: true` in the manifest; the capsule stays in the top frame regardless.
