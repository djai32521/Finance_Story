# Execution Plan — "An app just for me" (Sam's 2025 in Money)

## Overview
End-to-end build of an interactive, kinetic-typography and WebGL/DOM hybrid year-in-money web application for **Sam (2025)** from `data/transactions_2025.csv`.

- **Output Directory:** `app/`
- **Target Frame Sizes:** Desktop `1920 × 1080` (video frame) down to `1440 × 900`; Phone `390 × 844`.
- **Beat Grid:** 120 BPM (`500 ms` per beat).

---

## Workstreams & Ownership

| Workstream | Owner | Owned Paths (inside `app/`) | Milestone Gate |
|---|---|---|---|
| **Phase 0: Foundations** | Orchestrator | `PLAN.md`, `DECISIONS.md`, `PROGRESS.md`, `contracts/`, `data/mock/`, project config (`package.json`, `tsconfig.json`, `vite.config.ts`, `eslint.config.js`) | **M0**: `npm run check` passes; contracts compile; mock dataset validates. |
| **A. Data Pipeline** | Subagent A | `pipeline/`, `data/transactions.json`, `data/days.json`, `data/facts.json`, `data/merchant_cache.json`, `reports/reconciliation.md` | **M1**: Unit tests pass; 0.00 reconciliation diff against `../data/transactions_2025.csv`; all facts recompute from `txn_ids`. |
| **B. Design System & Motion Prototype** | Subagent B | `design/`, `src/design/` (`motion.ts`, `tokens.ts`, `palette.ts`, `components/`, `canvas/`, `prototype.ts`) | **M2**: 60fps prototype of Start → Pour → "2025" title → Grid Sweep → 1 staged transition; style tiles at `1440×900` and `390×844`; `design/MOTION.md`. |
| **C. App Shell, Player, Grid & Core Chapters** | Subagent C | `src/player/`, `src/explore/`, `src/grid/`, `src/chapters/core/` | **M2/M3/M4**: Story navigation, 53×7 WebGL/Canvas + DOM grid, explore interactions (flip, drag total, lens wave, scrub 0.5×/1×/2×, receipts, share card export), reduced motion, capture hooks. |
| **F. Ask Your Year & Runtime Server** | Subagent F | `src/ask/`, `server/` | **M3**: DSL validator & deterministic executor, local Node server with Gemini (`MODEL_API_KEY`) + deterministic NL & chip-builder fallback, 20+ question test suite on real data. |
| **D. Story Planner & Personalisation** | Subagent D | `story/plan.json`, `story/rationale.md`, `story/synthetic_person2/`, `reports/personalisation.md` | **M3/M4**: Generates `story/plan.json` using `{fact:id}` placeholders only; runs pipeline + planner on a second synthetic persona to prove personalisation. |
| **E. Bespoke Chapters** | Subagent E | `src/chapters/bespoke/` | **M3/M4**: Implements 2 bespoke chapters tailored to Sam's 2025 ("Room to Make Noise" for the Monarch Acoustic + synth journey, and "The Morning Rivalry" for the 72 Blue Bottle Coffee + Sightglass Coffee habit) with `"only in your app"` badge. |
| **Phase 3: Integration** | Orchestrator | `src/main.ts`, `index.html`, `scripts/fact-lint.ts` | **M3/M4**: Full app running on real 2025 data; fact lint passes with zero un-sourced digits. |
| **Phase 4: Independent Verification** | Fresh Subagents (Data, Design, Motion, Interaction, Privacy) | `reports/verification.md`, `tests/e2e/` | **M5**: Recomputes every fact, scores against `data/answer_key/transactions_2025_labels.csv`, scores design & motion ≥ 4/5 at 60fps, verifies 1-frame input response and privacy rules 1–9. |
| **Phase 5: Capture & Final Package** | Orchestrator / Capture Subagent | `capture/`, `scripts/capture.ts`, `README.md`, `ATTRIBUTION.md` | **M6**: `capture/demo_1920x1080.mp4` (45s), `capture/demo_1080x1920.mp4`, `capture/loop.mp4` (5s), `capture/share_1080x1350.png`, `capture/share_1080x1920.png`, `capture/motion_events.json`. |

---

## Execution Order & Gates

1. **M0 Foundations (Phase 0):** Complete CSV inspection, verify toolchain, write contracts & mock data, scaffold `app/`, verify `npm run check`, tag `m0`.
2. **Phase 1 Parallel Build (M1 + M2 + F):**
   - Run Workstreams **A** (Pipeline), **B** (Design & Motion), **C** (Player/Grid/Explore), and **F** (Ask Your Year) in parallel against `contracts/`.
   - **Gate 1 (M1 & M2):** Verify `reports/reconciliation.md` has 0.00 diff; capture and review M2 motion prototype & style tiles; tag `m1` and `m2`.
3. **Phase 2 & 3 Story, Bespoke Chapters & Spine Integration (M3 & M4):**
   - Run Workstream **D** (Story Planner + Second Persona) once M1 facts are ready.
   - Run Workstream **E** (Bespoke Chapters) and **C-continued** (Core Chapters wired to `story/plan.json`).
   - Integrate full app on real data, run fact lint and 20+ Ask tests, verify personalisation check, tag `m3` and `m4`.
4. **Phase 4 Independent Verification (M5):**
   - Spawn fresh, independent checker subagents (Data Verifier, Design Critic, Motion Critic, Interaction Tester, Privacy & Rules Checker).
   - Fix any item scoring < 4 or failing checks (up to 3 rounds), write `reports/verification.md`, tag `m5`.
5. **Phase 5 Deterministic 60fps Capture (M6):**
   - Run deterministic frame-by-frame Playwright capture at 60fps following the 45-second storyboard, encode with `ffmpeg` (H.264 MP4 + silent AAC track), export share cards and `motion_events.json`, finalize `README.md` and `ATTRIBUTION.md`, tag `m6`.
