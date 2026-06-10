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

Fermata is a **video player for live web pages** — a Chrome extension that
lets you slow, pause, scrub, and step motion on any site, then record an
interaction into a frame-perfect storyboard.

The wedge is not "record the screen faster." It is **own the page's clock** so
motion becomes inspectable and capturable with stop-motion precision, even when
Chrome's screenshot API is capped at ~2/sec.

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
| `page.js` | MAIN (`document_start`) | Virtual clock + declarative animation governor |
| `content.js` | ISOLATED (`document_idle`) | HUD, picker, scrub UI, stop-motion recorder |
| `background.js` | Service worker | Toggle HUD, `captureVisibleTab`, open storyboard |
| `storyboard.html` / `storyboard.js` | Extension page | Render frames from `chrome.storage.local` |

Cross-world bus: `postMessage` with namespace `fermata` (`fermata-hud` ↔
`fermata-engine`).

Two time domains (keep them in lockstep when stepping):

1. **Imperative clock** — patched `performance.now`, `Date.now`, rAF
   timestamps, and dilated timer delays for JS-driven motion.
2. **Declarative domain** — `playbackRate` on live `Animation` objects; scrubbing
   seeks `currentTime` on scoped animations.

Scope: picked element gets `data-fermata-scope`; governor and scrub filter to
animations whose effect target is inside that subtree.

## UX principles

1. **HUD stays out of the way** — fixed panel, draggable, dismissible; hidden
   during capture so it never appears in frames.
2. **Transport reads like a deck** — rate, pause, step, scrub, record. Labels
   are short; helper text explains non-obvious limits once.
3. **Slow first, then scrub** — transitions finish quickly at 1×; users need
   presets (.05, .1, .25) and copy that nudges them to slow the clock before
   scanning.
4. **Status is visible** — timecode, rate, animation count, recording progress
   bar. Silent failure is unacceptable; surface capture quota errors.
5. **Storyboard opens automatically** after a successful record. Download paths
   (contact sheet, all frames) must stay obvious.

## Visual and aesthetic source of truth

The HUD is a **broadcast monitor / timecode deck** — not SaaS minimalism, not
skeuomorphic toy chrome.

Current language:

- Dark warm charcoal panel (`#10100d` family) with subtle border (`#3a352c`)
- **Amber** (`#ffb000`) for active state, timecode, accents, scope highlight
- Muted warm grays for labels (`#6e675a`, `#9a937f`)
- Monospace throughout: `ui-monospace`, SF Mono, Cascadia Mono, Menlo
- Small caps section headers with letter-spacing (`.h`)
- Tabular nums for timecode and rate
- Compact 308px panel; 10–12px type; tight vertical rhythm

Material rules:

1. HUD lives in **Shadow DOM** so page CSS cannot leak in or out.
2. Accent color means *live / active / time* — do not sprinkle amber on
   everything.
3. Buttons are flat bordered chips; `.on` = filled amber for primary transport
   state (pause engaged, record armed).
4. Scope picker uses amber outline + faint fill on the target element.
5. Storyboard page should feel like the same instrument: dark, monospace,
   amber metadata, grid of frames with time offsets.

Avoid:

- Inter, system-ui-only stacks, or rounded SaaS cards
- Purple gradients, glassmorphism dashboards, or generic shadcn styling
- Large modals or multi-step wizards for core transport
- Animations that fight the user's attempt to study motion

## Interaction rules

1. Toolbar icon toggles HUD; content script may be absent on restricted URLs —
   fail silently in the service worker, do not spam errors.
2. **Reload once after install** — user must know the engine injects at
   `document_start`.
3. Rate slider is **log-scale** (0.02×–2×); presets snap to common dissect rates.
4. Stepping (`+16 ms`, `+100 ms`) only advances the virtual clock while paused;
   copy should say it includes JS motion.
5. Scrub strip disabled until scan finds seekable animations in scope.
6. Record modes:
   - **clock** — step forged clock through `span` ms from current position
   - **timeline** — distribute frames across scanned animation duration
7. Respect `captureVisibleTab` quota (~2/sec): backoff in capture loop, progress
   UI during record.

## Definition of done

A change is done when:

1. Behavior matches README claims (or README is updated if limits change).
2. HUD still works on a normal https page after reload.
3. Clock patch does not regress pass-through cost at 1× / unpaused.
4. Recording produces a storyboard tab with correct frame count and metadata.
5. No new permissions without explicit justification.
6. Visual changes still match the broadcast-deck aesthetic above.

Manual verification checklist:

1. Load unpacked extension → reload a test tab → toggle HUD
2. Set rate to 0.1×, pause, step +16 ms — timecode advances
3. Pick element, scan, scrub if animations exist
4. Record 8–12 frames in clock mode — storyboard opens, contact sheet downloads

## Guardrails

- Do not add reverse playback for imperative JS motion in the live page.
- Do not retime video/audio elements or compositor scroll physics without an
  explicit product decision.
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
