# Fermata — agent guide

This file is the source of truth for product context, product intent, UX rules,
and styling aesthetics for **Fermata**.

When Plane is set up for this project, Plane becomes the source of truth for
roadmap phases, milestones, work items, dependencies, and execution status.
Until then, [README.md](./README.md) describes capabilities and honest limits.

## Canonical sources

- Product and design context: this file
- Capability reference and limits: [README.md](./README.md)
- Implementation: flat Chrome extension files at repo root (no build step)

## Agent context files

Read these when the task touches naming, copy, UI labels, visual identity, or
any decision about how Fermata presents itself — not needed for pure
implementation tasks unless they intersect with brand-visible surfaces.

@.agents/fermata-brand-psychology.md — brand psychology, name rationale, visual
type treatments, tone axes, and the core distinction that makes the name work.
Read before writing any marketing copy, choosing UI label wording, designing the
icon/wordmark, or evaluating whether a proposed feature name fits the brand.

## What Fermata is

Fermata makes **frozen time a place**. Freeze a page's clock and the live DOM
itself tilts into 3D — a slab of frozen glass you can orbit, step in exact
increments, drag through its motion, and clone into depth-fanned echoes
(an animation's past behind it, its future ahead, inside the page's own
space) — then record into a frame-perfect storyboard.

The wedge is not "record the screen faster." It is **own the page's clock** so
motion becomes inspectable and capturable with stop-motion precision, even when
Chrome's screenshot API is capped at ~2/sec. The 3D presentation is not
decoration: it is the product's one emotion (authority over time) made visible
— the page you were using is suddenly an artifact in your hand.

## Product thesis

Web interactions are hard to study, explain, and hand off. Screen recordings are
too fast and too dense. Static screenshots lose sequence. Slow-motion screen
capture cannot go frame-perfect because real time keeps moving.

Fermata compresses live motion into something usable:

- **Dissect** an interaction at 0.05–0.25× before recording anything
- **Pause and step** through the critical moment in fixed virtual-ms increments
- **Scrub** seekable CSS/WAAPI motion forward and backward
- **Record** via stop-motion: freeze virtual time, advance in steps, capture each
  settled frame at leisure
- **Export** a storyboard contact sheet or individual frames for review and handoff

The storyboard is evidence of *how something moved*, not just what it looked like
at one instant.

## Product rules

1. **Clock ownership is the core primitive.** Features that bypass or weaken the
   forged virtual clock are suspect.
2. **Be honest about limits.** JS-driven motion can slow, pause, and step
   forward — not reverse-scrub in live page time. Say so in UI copy when relevant.
3. **Recording is stop-motion by design.** Never trade frame accuracy for
   real-time capture speed.
4. **Top frame only** unless the user explicitly asks to enable `all_frames`.
5. **Minimal surface area.** No bundler, no framework, no npm unless there is a
   strong reason. The extension must stay loadable as unpacked MV3.
6. **Do not break `document_start` injection.** `page.js` must run before page
   scripts so the clock patch is in place early.

## Architecture

Four files, three worlds:

| File | World | Role |
|------|-------|------|
| `page.js` | MAIN (`document_start`) | Virtual clock, timer queue, animation governor, media/SMIL governor, canvas film, reel + ledger, echoes |
| `content.js` | ISOLATED (`document_idle`) | Capsule, tilt, keyboard, drag-scrub, stop-motion recorder |
| `background.js` | Service worker | Toggle, badge, `captureVisibleTab`, open storyboard |
| `storyboard.html` / `storyboard.js` | Extension page | Flipbook viewer + exports from `chrome.storage.local` |

Cross-world bus: `postMessage` with namespace `fermata` (`fermata-hud` ↔
`fermata-engine`).

Four time domains (keep them in lockstep when stepping):

1. **Imperative clock** — patched `performance.now`, `Date.now`, `new Date()`,
   rAF timestamps, `requestIdleCallback`, and a virtual timer queue (pending
   timers retime on rate change, freeze on hold, fire when stepped across)
   for JS-driven motion.
2. **Declarative domain** — `playbackRate` on live `Animation` objects; scrubbing
   seeks `currentTime` on scoped animations. Scroll-driven animations
   (non-document timelines) are exempt everywhere — their axis is the scrollbar.
3. **Media clock** — video/audio `playbackRate` scales with the rate; freezing
   pauses; stepping and rewinding seek `currentTime` within the element's
   `seekable` range. SVG SMIL roots pause/seek via `pauseAnimations` /
   `setCurrentTime` (no rate control exists for SMIL).
4. **The film** — canvases (2D/WebGL) are sampled into small JPEG frames while
   the reel runs (`preserveDrawingBuffer` is forced at context creation to
   make WebGL readable); rewinding overlays the nearest frame in body space,
   marked `data-fermata-held` so the ledger ignores it.

Exemption rule: everything Fermata creates is exempt from its own time
authority — elements under `data-fermata-ui` and any `Animation` whose `id`
starts with `fermata`. Never animate Fermata UI without one of those marks, or
the governor will freeze Fermata itself.

Echoes: deep clones of a moving element placed inside `body` (so they tilt with
the page), each replaying the original effect's keyframes via WAAPI, parked at
staggered `currentTime`s, fanned through `translateZ`.

## UX principles

1. **The page is the interface.** Fermata adds one quiet capsule of words at
   the bottom; everything else happens to the page itself (tilt, echoes,
   scrub). No panels, no wizards, no settings.
2. **One key per move, named in plain words** — freeze, step, speed, loop,
   echo, record, leave. Every capsule hint is also a clickable button, so
   pointer users are never stranded. Never use jargon like "HUD", "transport",
   or "scope" in UI copy.
3. **Entirely keyboard-driven** — space, arrows, `[` `]` L (loop),
   S (score, `shift S` copies code), T (trail), K (link), E (echo), R (record),
   esc while Fermata is active; `⌥⇧F` to enter/leave. Keys are ignored while
   focus is in an editable field (except esc). Entering pulls keyboard focus
   back from the browser chrome so keys work without clicking the page first.
   Annotations (score, trail, echoes) live in the page's own tilted space —
   never in panels.
4. **The reel, not a trap.** While active, every finite animation the page
   performs is remembered and stays seekable after finishing; freezing opens
   a timeline from entry (or the last 30 s) to now. There is no "catch" mode —
   activate, interact, then rewind.
5. **Announce, don't explain** — tempo changes and freezes show a brief serif
   word with a plain-language subtitle ("adagio — quarter speed"), then get out
   of the way.
6. **Status is visible** — capsule shows tempo word, rate, timecode; the
   toolbar badge mirrors the tab's clock (`HELD` / rate / nothing at 1×).
   Silent failure is unacceptable.
7. **Frames are always clean** — the page flattens and all overlays hide
   before each capture; storyboard opens automatically after a record.

## Visual and aesthetic source of truth

The feeling is **golden hour in a dark concert hall** — warm, exclusive, calm
authority. Not SaaS minimalism, not dev-tool chrome, not a dashboard.

Current language:

- Warm near-black room (`#0b0906`–`#15110a` radial) behind the tilted page
- **Amber/gold** (`#ffb000`, highlights `#ffc94d`/`#ffd45e`) for time, accents,
  the glyph, and the viewport's golden hairline — never purple, ever
- Editorial **serif** for the display voice — tempo words, toasts, wordmark:
  `ui-serif, "Iowan Old Style", Palatino, Georgia` — usually italic
- Clean system **sans** for working text and key hints — **no monospace
  anywhere**
- **Motion tokens are law**: the overlay moves on four durations
  (`--d1: 120ms`, `--d2: 200ms`, `--d3: 320ms`, `--d4: 700ms`) and three
  curves (`--eo`, `--eo5`, `--eio`). Never an ad-hoc duration in overlay CSS.
- **Type scale**: serif display 18px (capsule word) / sans 13px (working) /
  11px (labels, hints) / 10px (kbd, caps, tips). No sizes between.
- The fermata glyph (arc + dot, inline SVG) is the only logo treatment
- The capsule is a dark golden glass pill; key hints render as soft `kbd` caps

Material rules:

1. All overlay UI lives in **Shadow DOM** on a `data-fermata-ui` host so page
   CSS cannot leak in or out and the governor exempts it.
2. Amber means *time / held / alive* — do not sprinkle it on everything.
3. The 3D treatment belongs to the page (body transform + perspective), never
   to floating menus. No "3D buttons".
4. Echo ghosts: past is sepia and dimmer with depth; future is brighter with a
   faint golden glow.
5. Storyboard page is the same room: dark warm ground, serif wordmark, amber
   timecodes, sans working text.

Avoid:

- Monospace type anywhere in product surfaces
- Purple, gradients-as-decoration, glassmorphism dashboards, shadcn defaults
- Panels with labeled sections, modals, or multi-step wizards
- Animations that fight the user's attempt to study motion

## Interaction rules

1. Toolbar icon / `⌥⇧F` toggles Fermata; content script may be absent on
   restricted URLs — fail silently in the service worker, do not spam errors.
2. **Reload once after install** — user must know the engine injects at
   `document_start`.
3. Tempo presets are musical words with plain subtitles; `↑↓` walks them.
4. `→` steps the forged clock (JS timers fire when crossed); `←` rewinds the
   seekable domain only — never imply JS rewinds.
5. Freezing tilts; releasing untilts; recording always flattens first and
   restores after. Body inline styles are saved and restored exactly.
6. Drag-to-scrub and click-swallowing apply only while frozen, and never to
   Fermata's own surfaces.
7. Record needs zero settings: a marked loop region when one exists, else the
   timeline span when a strip exists, else 800 ms of clock. Frame count
   follows the span — one per ~80 virtual ms, clamped 8–24 (`shift R`
   forces 24).
8. Respect `captureVisibleTab` quota (~2/sec): backoff in capture loop, show
   the recording pill between captures, never during them.

## Definition of done

A change is done when:

1. Behavior matches README claims (or README is updated if limits change).
2. Enter/freeze/leave still work on a normal https page after reload, and
   leaving restores the site exactly (transform, background, outline).
3. Clock patch does not regress pass-through cost at 1× / unpaused.
4. Recording produces a storyboard tab with correct frame count and metadata.
5. No new permissions without explicit justification.
6. Visual changes still match the broadcast-deck aesthetic above.

Manual verification checklist:

1. Load unpacked extension → reload a test tab → `⌥⇧F`
2. `↓` to *largo*, `space` to freeze — the page tilts, the clock stops
3. `→` a few times — timecode advances in exact 16.67 ms steps
4. Point at something moving, `E` — echoes fan into depth; drag to scrub
5. `R` — storyboard opens with clean frames; flipbook plays; exports download

## Guardrails

- Do not add reverse playback for imperative JS motion in the live page
  (the ledger replays its *record*; code is never re-executed).
- Video/audio retiming is a made decision: rate scales `playbackRate`, freeze
  pauses, step/rewind seek within `seekable`. Do not retime scroll-driven
  animations or compositor scroll physics — their axis is the scrollbar.
- Do not capture `performance.now` into locals before patch in new code paths
  (bundlers that inline early reads can escape the clock).
- Do not move planning into long local markdown roadmaps; use Plane when it
  exists.
- Do not introduce a build pipeline for convenience unless the user asks —
  keep "Load unpacked" as the primary dev loop.

## How agents should use Plane

When a Plane project exists for Fermata:

1. Read Plane before choosing work.
2. Prefer assigned work; else `Todo`; only then `Backlog`.
3. Move to **In Progress** before implementation; **Done** only after
   verification.
4. Capture follow-up work back in Plane, not in ad-hoc docs.

Until Plane is configured, use GitHub issues or direct user instructions for
sequencing.
