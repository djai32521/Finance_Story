# Progress Log (`PROGRESS.md`)

## M0 — Foundations (Completed)
- **CSV & Raw Data Inspected:** Verified `data/transactions_2025.csv` (1,000 rows: 809 Credit card, 191 Savings; 2025-01-01 to 2025-12-31; all USD; no time-of-day column) and `data/raw/*.csv`. Documented transfer pairs (`48` card `PAYMENT RECEIVED *` rows and `47` savings `7731` rows), internal/self transfers (`ROUNDUP SAVE`, `MB TRANSFER TO US-ACCT-1001`, `samm`/`sammercer`), refunds (`2` card credits), FX inline rows (`8` rows + `8` `INTL TRANSACTION FEE` rows), and `12` uniform `$6,750.00` monthly `Pacific Studio Labs` paydays (`$81,000.00` annual salary) in `DECISIONS.md`.
- **Toolchain Checked:** Node `v22.22.3`, `ffmpeg`, `git`, `python3`, and Playwright Headless Chromium (`131.0.6778.33` in `app/.playwright-browsers`) verified inside sandbox.
- **Contracts & Mock Dataset:** Created `contracts/data.ts`, `contracts/story.ts`, `contracts/query.ts`, `contracts/index.ts`, and generated deterministic 365-day mock dataset in `data/mock/`.
- **Check Results:** `npm run check` (`tsc --noEmit`, `eslint .`, `vitest run` [4/4 tests], and `fact-lint`) passed with 0 errors.

## M1 — Data Truth / Workstream A (Completed)
- **Pipeline Built (`app/pipeline/`):**
  - `parse.ts`: Parses both `data/transactions_2025.csv` (1,000 rows) and raw bank statements (`data/raw/card_statement_2020-2025.csv` & `savings_statement_2020-2025.csv`, 5,424 rows), handling metadata headers, inverted card signs, inline FX conversion rates, and duplicate/pending filtering while preserving same-day repeat visits (e.g., 72 visits to `Blue Bottle Coffee`).
  - `clean-merchants.ts` & `categorise.ts`: Cleans all raw merchant strings to canonical USA brands (`Blue Bottle Coffee`, `Sightglass Coffee`, `Monarch Acoustic`, `Sweetwater`, `Reverb Synth`, `B&H Photo`, `Trader Joe's`, `Whole Foods Market`, `Costco Wholesale`, `Alaska Airlines`, `Pacific Studio Labs`), enforces Rule 6 privacy masking (0 account numbers, card numbers, references, or unmasked personal names; individuals masked as `Friend A`–`Friend D`), and categorises into the 17 fixed categories using `data/merchant_cache.json` + optional live Gemini API batch support.
  - `compute-days.ts` & `compute-facts.ts`: Generates all 365 `Day` objects (`data/days.json`) and 96 traceable `Fact` objects (`data/facts.json`), each verified to recompute deterministically from its `txn_ids`.
  - `reconcile.ts`: Generates `reports/reconciliation.md` proving a `$0.00` (`0` cents) difference across all 1,000 rows (`-$24,997.15`), Credit card (`+$16,444.68`), and Savings (`-$41,441.83`).
- **Check Results:** `vitest run tests/pipeline.test.ts` (6/6 tests passed) and `eslint pipeline/ tests/pipeline.test.ts` (0 errors, 0 warnings).

## Workstream B — Design System & Motion Prototype (Completed)
- **Motion Specification & Solvers (`app/design/MOTION.md`, `app/src/design/motion.ts`):**
  - Defined `MOTION_TOKENS` on the 120 BPM beat grid (`0.5s` beat, `1.5s` 3-beat staged chapter transition: `textOut 0.18s`, `blockOut 0.26s`, `gap 0.10s`, `blockIn 0.50s`, `textIn 0.40s`, `detailIn 0.30s`), analytical 15% (`SPR`) and 5% (`SOFT`) damped spring solvers, easing curves, reduced-motion guard, and `MotionEventLogger`.
- **Visual Design System (`app/src/design/`):**
  - `tokens.ts`, `palette.ts`, `styles.css`: Self-hosted `@fontsource/inter-tight` + `@fontsource/jetbrains-mono`, 9 flat "Blocks" palettes and 17 category colours (all verified >= 4.5 WCAG AA contrast), zero gradients/glow/grain, and 53×7 grid geometry for desktop (`1920×1080`, `1440×900`) and phone (`390×844`).
  - `components/`: `odometer.ts` (digit-strip rollers), `kinetic-text.ts` (masked split-line animations), `block.ts` (one-axis scaling flat blocks with watermark numerals & receipt triggers), `chip.ts`, `receipt-list.ts` (tabular receipt rows with zero raw PII), and `shapes.ts` (weekday/monthly bars, 365-day radial clock + Nightingale rose wheel, streak chains, comparison bars).
  - `canvas/stage-canvas.ts`: Hybrid 60fps canvas engine supporting The Pour, `"2025"` particle-title assembly, 53×7 calendar sweep with time-remapping ribbon & payday heartbeat rings, and category column Shatter + snap-back.
  - `prototype.ts` & `capture-tiles.ts`: Rendered and visually verified all 15 style-tile screenshots (`pour`, `year_as_squares`, `your_place`, `shatter`, `personality` at `1920×1080`, `1440×900`, and `390×844`) in `app/design/style-tiles/`.
- **Check Results:** `vitest run tests/design.test.ts` (10/10 tests passed) and `eslint src/design/ tests/design.test.ts` (0 errors, 0 warnings).

## M2 — App Shell, Story Player, Explore & Grid / Workstream C (Completed)
- **Story Player & Timeline (`app/src/player/`):**
  - `story-player.ts`, `timeline-controller.ts`, `audio-cue.ts`, `capture-bridge.ts`: Full-bleed stage (`#bar` hidden by default with on-stage `#stage-hud-nav`), animated start screen (`#start-bg-grid` + `playStartScreenIntro()` + fullscreen `"Open your 2025"` CTA), segmented progress bar, interruptible GSAP/spring chapter timeline on the 120 BPM beat grid, keyboard/touch/reduced-motion controls, Web Audio cue slot, and `window.__YEAR_APP__` capture bridge.
- **Interactive 53×7 Grid & Explore Mode (`app/src/grid/`, `app/src/explore/`):**
  - `interactive-grid.ts`, `day-flip-card.ts`, `drag-selector.ts`, `scrub-bar.ts`: 1-frame day hover highlight + neighbour scale, 3D card flip to day receipt list, pointer drag range selector with live floating `US$` total pill, category lens wave re-colouring, and variable-speed (`0.5×`, `1×`, `2×`) scrub bar.
  - `explore-overlay.ts`, `receipts-drawer.ts`, `share-exporter.ts`: Full Explore mode overlay, slide-over Receipts drawer (`Receipts (N)`), and offscreen PNG Share Card exporter (`1080×1350` and `1080×1920`) with zero account details.
- **Core Chapters (`app/src/chapters/core/`):**
  - Implemented all 11 core chapter modules (`pour`, `year_as_squares`, `your_place`, `streak`, `getaway`, `heartbeat`, `big_one`, `shatter`, `personality`, `one_line`, `share_card`) resolving `{fact:id}` placeholders strictly from `Fact[]`, rendering `KEY TAKEAWAY FOR SAM` banners, holding `shatter` category columns permanently in interactive mode, and pixel-aligning the `1920×1080` `#ttlt-canvas` `2025` title in `pour`.
- **Check Results:** `vitest run tests/player.test.ts` (11/11 tests passed) and `eslint src/player/ src/explore/ src/grid/ src/chapters/core/ tests/player.test.ts` (0 errors, 0 warnings).

## M3 — Story Planner, Bespoke Chapters, Personalisation & Ask Engine / Workstreams D, E, F (Completed)
- **Workstream F — Ask Your Year & Runtime Server (`app/src/ask/`, `app/server/`, `app/tests/ask.test.ts`):**
  - Implemented `validator.ts`, `executor.ts`, `nl-parser.ts`, `ask-view.ts`, and `server/` (`config.ts`, `gemini.ts`, `index.ts`) with full Gemini DSL translation + deterministic offline NL parser and structured chip builder.
  - Verified 44 test cases in `tests/ask.test.ts` against `data/transactions.json` (merchant counts like `Blue Bottle Coffee` = 72, `Sightglass Coffee` = 41, category totals, weekend/monthly filters, `max`/`min`/`average`/`list`, `group_by`, 6 unanswerable time-of-day/out-of-scope queries, and `/api/ask` HTTP endpoint).
- **Workstream D — Story Planner & Personalisation (`app/story/`, `app/reports/personalisation.md`, `app/tests/story.test.ts`):**
  - Implemented `story/planner.ts` and `story/generate.ts`, generating Sam's 13-chapter `story/plan.json` and `story/rationale.md` with 100% `{fact:id}` placeholder compliance (`fact-lint` 0 errors) and a distinct `Takeaway for Sam —` insight in every narrative chapter.
  - Generated contrast persona Alex (`data/mock/alex_2025.csv` -> `story/alex_plan.json`) and documented side-by-side divergence in `reports/personalisation.md` (Sam's 13-chapter *Studio-Building Regular* arc vs Alex's 11-chapter *Trail-Running Home Chef* arc).
- **Workstream E — Bespoke Chapters (`app/src/chapters/bespoke/`, `app/tests/bespoke.test.ts`):**
  - Built `studio-chapter.ts` (*Room to Make Noise — The Studio Build*) and `coffee-chapter.ts` (*The Morning Rivalry — Two Cafés, 163 Cups*) plus `GenericBespokeChapter` with `.badge-bespoke` (`"ONLY IN YOUR APP"`), custom SVG visualisations, odometer blocks, `TAKEAWAY FOR SAM` banners, and desktop/phone support.
- **Check Results:** `npm run check` passed (`tsc --noEmit` 0 errors, `eslint .` 0 errors/warnings, `vitest run` passing across all suites, `fact-lint` 0 errors).

## M4 — Full End-to-End Integration / Phase 3 (Completed)
- **Main Application Entry (`app/src/main.ts`):**
  - Wired `data/transactions.json` (1,000 rows), `data/days.json` (365 days), `data/facts.json` (96 facts), and `story/plan.json` (13 chapters) into `StoryPlayer`.
  - Registered all bespoke chapters (`BESPOKE_CHAPTER_REGISTRY`), wired `setCustomAskExecutor` (live `/api/ask` + deterministic in-browser NL parser & executor), and installed `CaptureBridge` (`window.__YEAR_APP__`).
- **Check Results:** `npm run build` (`vite build`) and `npm run check` passed with 0 errors and 0 warnings.

## M5 — Independent Verification / Phase 4 (Completed)
- **Subagent V1 — Data & Answer-Key Verification (`app/reports/verification-data.md`, `app/tests/verify-data.test.ts`):**
  - Independently re-summed `../data/transactions_2025.csv` (`1,000` rows, `-$24,997.15` net, `$0.00` diff), verified all `12` uniform `$6,750.00` monthly paychecks (`$81,000.00` annual salary from `Pacific Studio Labs`), confirmed zero legacy non-US terms across all 9 CSV/JSON files, and compared against `../data/answer_key/transactions_2025_labels.csv`: `95.03%` dollar-weighted category agreement, `99.88%` canonical card merchant match, `100%` transfer precision, `100%` refund match, `96/96` facts recomputed with `0` mismatches, and `0` PII leaks.
- **Subagent V2 — Visual & Layout Verification (`app/reports/verification-visual.md`, `app/reports/screenshots/`, `app/tests/verify-visual.test.ts`):**
  - Captured and inspected 44 screenshots across Desktop Full HD (`1920×1080`), Laptop (`1440×900`), Mobile Phone (`390×844`), and Reduced-Motion Mode, plus `1080×1350` and `1080×1920` Share Card PNG exports.
  - Verified all 5 User Feedback items (`FB-1`..`FB-5`) and all 4 initial visual polish items (`V-1`..`V-4`) at **5.0 / 5.0** across all screens.
- **Subagent V3 — Interaction, Motion & Ask Verification (`app/reports/verification-interaction.md`, `app/tests/verify-interaction.test.ts`):**
  - Verified Start Screen gate (`#bar` hidden, `#start-bg-grid`, `#stage-hud-nav`), interruptible chapter navigation, Explore 3D day flip card (`Mon 11 Aug · $9,783.43` with `Monarch Acoustic` & `Sweetwater`), 31-day drag range (`$4,974.46`), category lens wave, Receipts drawer, Ask Your Year end-to-end (`Blue Bottle Coffee` = `72`, Dec coffee = `$389.46`, after 9pm = `"Can’t tell"` + clickable suggestion), and 45s storyboard scrub (`p95 < 5ms` vs `20ms` budget).
- **Master Verification Report:** Created `app/reports/verification.md`.
- **Check Results:** `npm run check` passed (`10/10` test suites, `105/105` tests, `0` lint/type/fact-lint errors).

## M6 — 60fps Video Capture / Phase 5 (Completed)
- **Deterministic 60fps Capture Pipeline (`app/scripts/capture.ts`, `app/src/player/capture-bridge.ts`):**
  - Attached `Odometer.roll` and `YourPlaceChapter` morph tweens directly to `PlayerTimelineController.gsapTimeline` and enabled `manualStepping` so every frame `t = f / 60` (`0.00s`..`45.00s`) renders deterministically with zero wall-clock drift.
  - Produced `capture/demo_1920x1080.mp4`: `1920 × 1080`, `60/1` fps (`2,700` frames, `45.00s`), H.264 (`yuv420p`) + synced stereo AAC audio track, with immediate CSV-to-particle pour & lens hook in the first 2 seconds for muted feed autoplay.
  - Produced `capture/loop.mp4`: `1920 × 1080`, `60/1` fps (`300` frames, `5.00s`), seamless H.264 + AAC loop of the 53×7 calendar grid shattering into category columns and snapping back.
  - Exported high-resolution Share Cards (`capture/share_1080x1350.png` and `capture/share_1080x1920.png`), frame-accurate `capture/motion_events.json` (`63` events aligned to `0..45000ms` & 120 BPM beats), and 13 lossless keyframe stills in `capture/frames/`.
- **Documentation & Attribution (`app/README.md`, `app/ATTRIBUTION.md`):**
  - Documented installation, offline (no-key) and live Gemini run modes, test suite commands, and 60fps capture in `app/README.md`.
  - Documented the exact division between model judgment/authoring and deterministic integer-cent computation in `app/ATTRIBUTION.md`.
- **Check Results:** `npm run check` (`tsc --noEmit`, `eslint .`, `vitest run` [10/10 suites, 105/105 tests], and `fact-lint`) passed with 0 errors and 0 warnings.
