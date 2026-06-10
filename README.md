# Fermata

*In music, a fermata instructs the performer to hold a note for as long as the conductor decides. Time does not resume until they say so.*

Fermata is a Chrome extension that gives you the same authority over a live web page. Drop the rate to a crawl. Pause mid-interaction. Step forward in exact increments. Decide when time resumes.

The mechanism: Fermata takes ownership of the page's clock — `performance.now`, `Date.now`, rAF timestamps, timer delays — so every kind of motion on the page, JS-driven or declarative, runs at your rate. Not a recording. Not a replay. The page is live; its sense of time is yours.

---

## Install

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this folder
3. Reload the tab once — the clock engine injects at `document_start` and must arrive before the page's own scripts
4. Click the Fermata toolbar icon to open the HUD

---

## The instrument

**Clock rate** — log-scale from 0.02× to 2×. Presets at .05, .1, .25, .5 cover most dissection work. At 0.05× a 200 ms hover transition takes four seconds. That is enough time to see what is actually happening.

**Transport** — pause freezes both JS motion and CSS/WAAPI animations simultaneously. `+16 ms` and `+100 ms` advance the forged clock in exact steps while paused. Step through a keyframe. See the frame your eye keeps missing.

**Scope** — pick any element; the governor and scrub strip narrow to animations within that subtree. Everything else continues at its own rate.

**Scrub** — scan the scoped animations into a single strip, then drag forward or back. Works on CSS animations, transitions, and WAAPI. Slow the clock before scanning so transitions are still alive when you reach for them.

**Record** — stop-motion capture. Chrome caps screenshots at roughly two per second, which is far too slow for real-time motion. Fermata pauses virtual time, advances it in fixed steps, and captures each settled frame at leisure. Frame count and span are yours to set. Two modes:
- *clock* — steps the forged clock through the next N virtual milliseconds from wherever you are; start mid-interaction
- *timeline* — distributes frames evenly across the scanned animation strip end-to-end

A storyboard tab opens automatically. Download the contact sheet or individual frames.

---

## What Fermata does not govern

JS-driven motion can be slowed, paused, and stepped forward. It cannot be reverse-scrubbed in live page time — reversing would mean un-executing arbitrary code. For JS motion, reverse exists after recording, in the storyboard.

Timers already scheduled when you change the rate keep their original fuse. Only timers created after the rate change are dilated.

Pages that capture `performance.now` into a local variable before Fermata's patch runs — possible with certain bundler patterns — escape the forged clock. Their CSS/WAAPI output is still governed.

Scroll-linked animations driven by scroll position rather than time are not retimed. Video and audio elements are not retimed. Compositor scroll physics are not retimed.

Fermata operates on the top frame only by design. To extend into iframes, set `all_frames: true` in the manifest; the HUD stays in the top frame regardless.
