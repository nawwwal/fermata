# Tempo Lens

A video player for live web pages. Slow, pause, scrub, and step motion on any
site, then record an interaction into a frame-perfect storyboard.

## Install

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this folder
3. On any page, click the Tempo Lens toolbar icon to toggle the HUD
4. **Reload the tab once after installing** — the clock engine must inject at
   `document_start`, before the page's own scripts run

## How it works

Two time domains, two mechanisms:

- **Imperative motion** (rAF loops, GSAP-core, physics, canvas): the engine
  forges the page's clock — `performance.now`, `Date.now`, rAF timestamps,
  timer delays — so JS-driven motion runs at your chosen rate, freezes on
  pause, and advances in exact 16 ms steps.
- **Declarative motion** (CSS animations, transitions, WAAPI): a governor
  pins `playbackRate` on every live `Animation` object; these are also
  seekable, which is what the scrub strip drives — both directions.

**Recording is stop-motion.** Chrome caps screenshots at ~2/sec, far too slow
for real-time motion — but since the engine owns the clock, the recorder
pauses virtual time, advances it in fixed increments, and captures each
settled frame at leisure. Frame-perfect regardless of capture throughput,
including JS-driven motion.

## Workflow

1. **Dissect live:** drop the rate to 0.05–0.25×, trigger the interaction,
   watch it unfold. Pause and `+16 ms` step through the critical moment.
2. **Scope:** *Pick element* → click the component; everything else is ignored.
3. **Scrub:** trigger the interaction at a slow rate, *Scan animations*, then
   drag the strip forward/back. (Transitions vanish once finished — slow the
   clock first so they're alive when you scan.)
4. **Record:** *clock* mode steps through the next N virtual ms from wherever
   you are — start it mid-interaction. *timeline* mode scrubs the scanned
   animations end-to-end. Either way a storyboard tab opens; download the
   contact sheet or individual frames.

## Honest limits

- **Reverse-scrubbing applies to seekable (CSS/WAAPI) animations only.**
  JS-driven motion can be slowed, paused, and stepped *forward*, but reverse
  would mean un-executing arbitrary code. For JS motion, "reverse" exists
  after recording, as storyboard frames.
- Timers already pending when you change the rate keep their original
  real-time fuse; only newly scheduled timers are dilated.
- Pages that capture `performance.now` into a local variable before the
  engine patches it (rare, but possible with bundlers) escape the forged
  clock; their CSS/WAAPI output is still governed.
- Scroll-linked animations driven by scroll position (not time) don't slow
  down — their clock is your finger.
- Video/audio elements and compositor scroll physics are not retimed.
- Top frame only by design; flip `all_frames` in the manifest if you need
  iframes (HUD stays in the top frame).
