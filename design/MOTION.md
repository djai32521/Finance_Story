# Motion System & Choreography Specification (`design/MOTION.md`)

Single source of truth for timing, physics, 120 BPM beat alignment, calm chapter transitions, and the continuous data-object choreography in **"An app just for me — Sam's 2025 in money"**.

All runtime values are defined once in [`src/design/motion.ts`](../src/design/motion.ts) (`MOTION_TOKENS`) and imported across Canvas and DOM modules. No inline magic durations, eases, or spring constants are permitted.

---

## 1. Core Motion Principles

1. **Every movement carries data.**
   Position, scale, fill intensity, flight speed, and spring pop amplitude encode real transaction metrics (amount in cents, day spend percentile, visit count, payday multiplier, category share). Decorative motion that carries no data is forbidden.
2. **One continuous object.**
   The 1,000 raw CSV rows unscramble into clean merchant names $\rightarrow$ collapse into colored transaction particles $\rightarrow$ assemble the `"2025"` title $\rightarrow$ dissolve into the 53×7 calendar grid $\rightarrow$ morph into hero blocks $\rightarrow$ break into category columns (`shatter`) $\rightarrow$ snap back into the 53×7 grid.
3. **Calm, staged transitions between chapters; rich showpieces within chapters.**
   Transitions between chapters follow the **5 Calm Chapter Transition Rules** below so the eye is never overwhelmed by competing motion. Once a chapter's stage is set, its signature showpiece (`pour`, `sweep`, `shatter`, `personality` wheel) commands full attention.
4. **120 BPM music-video rhythm.**
   The timeline runs on a steady **120 BPM** clock (`1 beat = 0.50s = 500ms`). Chapter entrances, payday pulses during the year sweep, and shared-element morph steps snap to beat boundaries via `snapToNextBeat()`.
5. **Tactile, interruptible interaction.**
   Every pointer or keyboard input responds within 1 frame ($\le 16.6\text{ms}$). Active GSAP and Canvas tweens can be interrupted or scrubbed mid-flight without locking the UI.

---

## 2. Canonical Motion Tokens (`MOTION_TOKENS`)

| Token Path | Value | Unit | Purpose |
|---|---|---|---|
| `MOTION_TOKENS.bpm` | `120` | BPM | Master tempo for chapter entries, payday pulses, and audio sync |
| `MOTION_TOKENS.beatSec` / `beat` | `0.50` | seconds | Duration of 1 beat at 120 BPM (`500 ms`) |
| `MOTION_TOKENS.dur.xs` | `0.12` | seconds | Micro-feedback: button press scale, tooltip hide (`120 ms`) |
| `MOTION_TOKENS.dur.s` | `0.20` | seconds | Fast state change: cursor ring morph, color highlight (`200 ms`) |
| `MOTION_TOKENS.dur.m` | `0.40` | seconds | Standard UI transition: text reveal, payday counter roll (`400 ms`) |
| `MOTION_TOKENS.dur.l` | `0.50` | seconds | 1-beat glide: 53×7 grid repositioning, block growth (`500 ms`) |
| `MOTION_TOKENS.dur.flight` | `0.56` | seconds | Nominal quadratic Bézier particle flight duration (`480–660 ms`) |
| `MOTION_TOKENS.tr.textOut` | `0.18` | seconds | Phase 1 Exit: outgoing headlines, numbers & details fade/lift out (`180 ms`) |
| `MOTION_TOKENS.tr.blockOut` | `0.26` | seconds | Phase 2 Exit: outgoing flat blocks collapse on one axis (`260 ms`, `35 ms` rev stagger) |
| `MOTION_TOKENS.tr.gap` | `0.10` | seconds | Phase 3 Beat Gap: minimum near-empty colour beat before snapping to next 0.5s beat |
| `MOTION_TOKENS.tr.blockIn` | `0.50` | seconds | Phase 4 Enter: incoming flat blocks grow on one axis with 5% soft spring (`500 ms`) |
| `MOTION_TOKENS.tr.blockStagger` | `0.07` | seconds | Stagger between consecutive incoming flat blocks (`70 ms`) |
| `MOTION_TOKENS.tr.textIn` | `0.40` | seconds | Phase 5 Enter: headlines, numbers & odometers enter once blocks settle (`400 ms`) |
| `MOTION_TOKENS.tr.textStagger` | `0.05` | seconds | Stagger between text elements & odometer strips (`50 ms`) |
| `MOTION_TOKENS.tr.detailIn` | `0.30` | seconds | Phase 6 Enter: ticks, ribbons, rule lines & receipt badges enter last (`300 ms`) |
| `MOTION_TOKENS.spring.overshoot` | `0.15` | ratio | **15% overshoot** (`SPR`, $\zeta \approx 0.517$) for letters, day pops, flip card |
| `MOTION_TOKENS.spring.settleSec` | `0.30` | seconds | Settling window for the 15% spring (`300 ms`) |
| `MOTION_TOKENS.soft.overshoot` | `0.05` | ratio | **5% overshoot** (`SOFT`, $\zeta \approx 0.690$) for flat block & bar growth |
| `MOTION_TOKENS.soft.settleSec` | `0.50` | seconds | Settling window for the 5% soft block spring (`500 ms`) |
| `MOTION_TOKENS.st.letter` | `0.022` | seconds | Per-character stagger in kinetic split headlines (`22 ms`) |
| `MOTION_TOKENS.st.col` | `0.003` | seconds | Per-column stagger (`0..52`) when the 53×7 grid glides (`3 ms/col`) |
| `MOTION_TOKENS.st.wave` | `0.0007` | sec/px | Radial wave propagation delay for category lens & Ask lighting (`0.7 ms/px`) |
| `MOTION_TOKENS.st.particle` | `0.0021` | seconds | Per-transaction stagger during particle collapse (`2.1 ms`) |
| `MOTION_TOKENS.speeds` | `[0.5, 1, 2]` | multiplier | Explore mode scrub & replay speed multipliers |

---

## 3. Analytical Damped Spring Solver & Easing Curves

Both `SPR` (`makeDampedSpring(0.15)`) and `SOFT` (`makeDampedSpring(0.05)`) are generated by the analytical under-damped harmonic oscillator in `src/design/motion.ts`:

$$\zeta = \frac{-\ln(\text{os})}{\sqrt{\pi^2 + \ln^2(\text{os})}}, \quad \phi = \arctan\!\left(\frac{\zeta}{\sqrt{1 - \zeta^2}}\right), \quad \omega_d = \frac{3\pi}{2} + \phi, \quad \omega_0 = \frac{\omega_d}{\sqrt{1 - \zeta^2}}$$

$$f(t) = 1 - \frac{e^{-\zeta \omega_0 t} \cos(\omega_d t - \phi)}{\cos(\phi)} \quad \text{for } t \in [0, 1]$$

- **Boundary conditions:** $f(0) = 0$ and $f(1) = 1$ exactly (since $\omega_d \cdot 1 - \phi = \frac{3\pi}{2}$ where $\cos(\frac{3\pi}{2}) = 0$).
- **Exact Peak Overshoot:** Derivative $f'(t) = 0$ occurs at $t_{\text{peak}} = \frac{\pi}{\omega_d}$, yielding $f(t_{\text{peak}}) = 1 + \text{os}$:
  - `SPR = makeDampedSpring(0.15)`: $\zeta = 0.5169$, $t_{\text{peak}} \approx 0.598$, peak $= 1.150$ (+15% overshoot).
  - `SOFT = makeDampedSpring(0.05)`: $\zeta = 0.6901$, $t_{\text{peak}} \approx 0.573$, peak $= 1.050$ (+5% overshoot).

| Curve Name | Formula / Solver | Primary Usage |
|---|---|---|
| `EASING.spr` (`SPR`) | `makeDampedSpring(0.15)` | Kinetic split letters, day square landing pops, 3D flip card |
| `EASING.soft` (`SOFT`) | `makeDampedSpring(0.05)` | One-axis flat block growth (`scaleY` / `scaleX`) |
| `EASING.glide` | Quartic In-Out ($8t^4$ / $1 - (-2t+2)^4/2$) | 53×7 contribution grid gliding calmly between chapter presets |
| `EASING.inOut3` | Cubic In-Out | Quadratic Bézier particle flights (`pour`, `title`, `shatter`) |
| `EASING.out3` | Cubic Out ($1 - (1-t)^3$) | Payday heartbeat rings, color transitions, hover ripples |
| `EASING.in2` | Quadratic In ($t^2$) | Particle size contraction and non-anchor square collapse |

---

## 4. The 5 Calm Chapter Transition Rules

Every chapter-to-chapter transition built with `enterChapterGroup()`, `exitChapterGroup()`, and `buildCalmTransition()` strictly enforces:

1. **Out fully, then in.**
   Outgoing text and details leave first (`0.18s`), followed by outgoing blocks collapsing in reverse order (`0.26s`). Incoming blocks never overlap outgoing blocks.
2. **One-axis scaling only.**
   Every `.blk` declares `data-ax="b" | "t" | "l" | "r"`. Bottom/top blocks animate `scaleY` (`0 → 1` on enter, `1 → 0` on exit); left/right side panels animate `scaleX` (`0 → 1` on enter, `1 → 0` on exit). No diagonal zooming or flying blocks.
3. **Staged and unhurried.**
   - **Exit (~0.45s):** Text/numbers/details fade & lift (`0.18s`) $\rightarrow$ flat blocks collapse on one axis (`0.26s`).
   - **Beat Gap (~0.10s+):** Near-empty background colour holds until the next 120 BPM beat boundary (`snapToNextBeat`).
   - **Enter (~1.15s):** Flat blocks grow in on one axis (`0.50s`, `70ms` stagger, `SOFT` 5% spring) $\rightarrow$ headlines, kinetic split characters, and odometers roll in once blocks reach 85% settle (`0.40s`) $\rightarrow$ annotations, axis rules (`.sx`), and receipt badges appear last (`0.30s`).
4. **120 BPM beat alignment.**
   Every chapter entry timestamp `at` is snapped to an integer multiple of `0.50s` (`Math.ceil((exitEnd + gap) / 0.5) * 0.5`).
5. **At most one persistent anchor.**
   At most one element persists across any chapter boundary — either the 53×7 contribution grid gliding smoothly to its new preset (`EASING.glide`, `3ms/col` stagger) OR a single highlighted day square morphing via `clip-path: inset(...)` into the incoming hero block.

---

## 5. Chapter-to-Chapter Transition Map

| Transition Pair | Outgoing Exit (`~0.44s`) | Persistent Anchor (Max 1) | Beat Gap | Incoming Entry (`~1.15s`) |
|---|---|---|---|---|
| **Start $\rightarrow$ `pour`** | Start button scales down (`0.12s`), unlocking WebAudio & starting the 120 BPM clock. | Start button position seeds initial pour origin. | Snaps to `t = 0.0s` (Beat 0) | 11 CSV columns wipe down (`clip-path` on Y axis) $\rightarrow$ yellow magnifier lens grows on `scaleX` (`data-ax="l"`) $\rightarrow$ rows unscramble $\rightarrow$ particles arc into `"2025"` $\rightarrow$ dissolve into `GRID_PRESETS.opener` $\rightarrow$ Opener blocks grow on `scaleY` (`data-ax="b"`). |
| **`pour` $\rightarrow$ `year_as_squares`** | Opener text & callout fade (`0.18s`), 3 metric blocks collapse down on `scaleY` (`0.26s`), `"2025"` ghost fades. | **53×7 Grid** glides from `GRID_PRESETS.opener` (`y:700, p:30`) to `GRID_PRESETS.sweep` (`y:520, p:32`) over `0.50s` (`3ms/col`), dimming to empty cells (`k: 0.45`). | `0.10s` $\rightarrow$ next beat | Payday & Loudest Day blocks grow up on `scaleY` $\rightarrow$ `US$` total odometer & month ghost enter $\rightarrow$ time-remapped sweep begins on the next beat with orange payday heartbeat rings. |
| **`year_as_squares` $\rightarrow$ `your_place`** | Sweep counters, playhead, and remap ribbon exit (`0.18s`); orange & pink blocks collapse on `scaleY` (`0.26s`). | **Single Blue Bottle Coffee Day Square**: all 72 Blue Bottle Coffee days flash Solar Yellow (`#F4F03A`), the other 364 squares collapse on Y (`k → 0`), and the peak Blue Bottle Coffee square morphs via `clip-path` into the `1146×1080` yellow hero block (`#pY`). | `0.10s` $\rightarrow$ next beat | Right-hand Ember (`72` visits), Rose (`US$572.80`), and Lavender (`By weekday`) blocks grow up on `scaleY` (`70ms` stagger) $\rightarrow$ `"Blue Bottle Coffee"` split type & odometers roll in $\rightarrow$ 72-day mini matrix & weekday bars appear. |
| **`your_place` $\rightarrow$ Bespoke (`studio_build` / `daily_pour`)** | Text, weekday bars, and mini matrix exit (`0.18s`); right-hand blocks collapse on `scaleY`; yellow hero block retracts into its square. | **Anchor Square / Category Swatch** transitions into the bespoke chapter's primary visual frame. | `0.10s` $\rightarrow$ next beat | Bespoke flat blocks scale in on one axis (`SOFT` 5% spring) $\rightarrow$ `"ONLY IN YOUR APP"` badge, kinetic headline, and fact odometers roll in $\rightarrow$ bespoke data visualization animates on the beat grid. |
| **Bespoke / Chosen (`streak`, `getaway`, `heartbeat`, `big_one`) $\rightarrow$ `shatter`** | Outgoing chapter text exits (`0.18s`), flat blocks collapse on `scaleY` / `scaleX` (`0.26s`). | **53×7 Grid** glides into `GRID_PRESETS.sweep` (`x:112, y:520`) and restores full-year day colors (`k: 1`). | `0.10s` $\rightarrow$ next beat | Headline `"Where US$... went"` splits in & Y-axis gridlines (`US$0`..`top`) scale on `scaleX` (`.sx`) $\rightarrow$ on the next beat, all 365 squares shatter into ~1,000 transaction particles that arc into 8 category columns sized by real dollar totals $\rightarrow$ category odometers roll in, hold, and snap back to the grid. |
| **`shatter` $\rightarrow$ `personality`** | Shatter axis lines, category odometers, and `"880"` watermark exit (`0.18s`). | **53×7 Grid** glides and condenses into the bottom-left mini sprint matrix (`GRID_PRESETS.mini`, `x:64, y:880, p:10`). | `0.10s` $\rightarrow$ next beat | Right-hand Warm Bone panel (`#pshape`, `940×1080`) grows from the right edge on `scaleX` (`data-ax="r"`) & orange `3.1×` block grows on `scaleY` $\rightarrow$ `"The Payday Sprinter"` split headline enters $\rightarrow$ 365-day radial clock, inner Nightingale category petals, and orange payday spikes draw clockwise. |
| **`personality` $\rightarrow$ `one_line` / `share_card`** | Personality text, radial wheel panel (`scaleX → 0`), and orange block (`scaleY → 0`) exit cleanly. | **53×7 Mini Grid** glides into the poster card's signature year strip. | `0.10s` $\rightarrow$ next beat | Poster blocks scale in on `scaleY` $\rightarrow$ one-line summary and verified fact odometers roll in $\rightarrow$ export triggers (`1080×1350` & `1080×1920`) appear. |
| **Any Chapter $\rightarrow$ `explore`** | Current chapter blocks and text exit via `exitChapterGroup()`. | **53×7 Grid** glides smoothly to `GRID_PRESETS.explore` (`x:160, y:330, p:30, c:26`) at full opacity. | `0.10s` $\rightarrow$ next beat | Category lens chips, scrub timeline bar (`0.5× / 1× / 2×`), and hover inspector stage in. Pointer hover immediately magnifies nearby squares; clicking flips a square in 3D (`SPR`); dragging draws the marching-ants selection total. |
| **Any Chapter $\rightarrow$ `ask`** | Current chapter blocks and text exit via `exitChapterGroup()`. | **53×7 Grid** glides to the lower anchor position `GRID_PRESETS.ask` (`x:112, y:810, p:24, c:20`). | `0.10s` $\rightarrow$ next beat | Warm Bone Ask bar (`1792×168`) scales in from the left edge on `scaleX` (`data-ax="l"`) $\rightarrow$ sample question chips enter $\rightarrow$ submitting a question sends a radial color wave (`0.7ms/px`) across matching days while the giant `280px` answer odometer and traceable receipts block (`scaleY`) slam in. |

---

## 6. Reduced Motion (`prefers-reduced-motion: reduce`)

When `isReducedMotion()` is active (via OS media query or the UI toggle):
- Particle flights (`pour`, `title` dissolve, `shatter` break/snap) are bypassed; the canvas cross-fades (`0.25s–0.30s`) directly between the settled states.
- One-axis block scaling and character-by-character spring staggers are replaced with calm opacity cross-fades (`0.28s`), and odometers snap directly to their target integer digits without multi-lap spinning.
- Radial lens waves re-color matching squares simultaneously (`waveSpeed = 0`).

---

## 7. Audio-Sync Motion Event Log (`MotionEventLogger`)

Every key choreography beat logs a structured `MotionEvent` via `motionLogger.log(type, value)`:

```json
{
  "type": "sweep.payday",
  "timestamp": 12500,
  "beat": 25,
  "chapter_id": "year_as_squares",
  "value": { "day": "Fri 31 Jan", "spend": 412.8 }
}
```

Standard event types emitted for the sound designer and `capture/motion_events.json`:
- `film.start`, `film.end`, `chapter.go`, `chapter.in`
- `pour.wall`, `pour.scramble`, `pour.collapse`, `pour.land`
- `title.assemble`, `title.handoff`, `title.dissolve`, `opener.in`
- `sweep.start`, `sweep.payday`, `sweep.end`
- `place.highlight`, `place.morph`
- `shatter.break`, `shatter.hold`, `shatter.snap`
- `personality.shape`
- `explore.hover`, `explore.flip`, `explore.unflip`, `explore.select`, `explore.lens`, `explore.replay`
- `ask.query`, `ask.answer`
