# Story Planner Rationale — Sam's 2025 in Money (`story/rationale.md`)

## 1. Planner Philosophy & Rule 1 Enforcement

This story plan was generated deterministically by `story/planner.ts` from **96 pre-computed `Fact` objects**, **365 `Day` summaries**, and **1,000 privacy-masked `Transaction` records**.

- **Zero Model-Invented Numbers (Rule 1):** Every headline, body paragraph, subheadline, metric block sublabel, `one_line`, and `personality.subtitle` uses `{fact:id}` placeholders exclusively. Not a single raw digit (`0-9`) appears outside a `{fact:id}` token.
- **Full Receipt Traceability (Rule 2):** Every chapter aggregates the exact union of backing `txn_ids` from its referenced facts so the user can inspect the underlying bank receipts on every screen.
- **Non-Overlapping Chapter Lenses & Actionable Takeaways:** Each chapter lands one distinct analytical lens and one explicit `Takeaway for Sam — ...` insight so no two slides repeat the same narrative.
- **Data-Driven Selection:** The planner evaluates 7 candidate middle chapter types and 4 candidate bespoke chapter archetypes against quantitative thresholds before sequencing the final arc.

---

## 2. Candidate Chapter Scoring & Ranking

| Candidate ID | Type | Module | Score | Threshold | Status | Palette | Key Data Signal |
|---|---|---|---:|---:|---|---|---|
| `your_place` | `your_place` | `core` | **100** | 50 | SELECTED | `solar_ember` | Blue Bottle Coffee: 72 visits (every 5 days), $572.80 |
| `bespoke_studio` | `bespoke` | `studio` | **100** | 60 | SELECTED | `paper_studio` | Monarch Acoustic build $11,596 + gear total $15,496 across 15 purchases |
| `streak` | `streak` | `core` | **95** | 45 | SELECTED | `olive_lime` | 34-day spending streak vs 97 quiet no-spend days (longest quiet run: 8 days) |
| `getaway` | `getaway` | `core` | **100** | 45 | SELECTED | `cobalt_bone` | Cannon Beach (7 days, $977) + 8 FX txns ($634) + $5,749 travel |
| `bespoke_coffee` | `bespoke` | `coffee` | **100** | 60 | SELECTED | `solar_ember` | 163 cups across 20 cafés ($2,265): Blue Bottle Coffee (72) vs Sightglass Coffee (41) |
| `bespoke_wellness` | `bespoke` | `wellness_log` | **26** | 60 | REJECTED | `mint_obsidian` | 3 Physio sessions ($535) & 12 health/training visits ($1,091) |
| `bespoke_home_pantry` | `bespoke` | `home_pantry` | **24** | 60 | REJECTED | `olive_lime` | 64 grocery trips ($2,416) vs 38 takeaway orders (1.7× ratio) |
| `heartbeat` | `heartbeat` | `core` | **78** | 55 | SELECTED | `ink_rose` | 12 paydays (1.1× post-payday multiplier) + October surge to $7,013 (1.9× typical month) |
| `big_one` | `big_one` | `core` | **100** | 55 | SELECTED | `crimson_ink` | $9,061.87 at Monarch Acoustic (10 weeks of normal spending) |
| `shatter` | `shatter` | `core` | **96** | 50 | SELECTED | `ink_solar` | $56,945 across 11 discretionary categories (top: shopping at 49%) |
| `personality` | `personality` | `core` | **100** | 50 | SELECTED | `lavender_night` | Synthesizes category mix petals, 365 daily radial bars, and 12 payday spikes |

### Why Selected Candidates Made the Cut
- **Your Place (`your_place`, score 100/50):** Selected because Blue Bottle Coffee clearly dominates the calendar with 72 visits (once every 5 days).
- **Room to Make Noise (`bespoke_studio`, score 100/60):** Selected as signature bespoke chapter (bespoke_0) because the two-stage Monarch Acoustic build ($2,535 May deposit + $9,061.87 August completion) plus 15 synth & audio gear purchases ($15,496) is the defining arc of the year.
- **The Streak (`streak`, score 95/45):** Selected because a 34-day consecutive spending chain contrasted against 97 quiet days creates a striking rhythm on the 53×7 grid.
- **The Getaway (`getaway`, score 100/45):** Selected because coastal trip days (7 days in Cannon Beach), foreign-currency spending (8 FX rows), and $5,749 in travel burst out of the routine grid.
- **The Morning Rivalry (`bespoke_coffee`, score 100/60):** Selected as second bespoke chapter (bespoke_1) because 163 coffees across 20 cafés ($2,264) feature a head-to-head rivalry between Blue Bottle Coffee (72 visits) and Sightglass Coffee (41 visits).
- **The Heartbeat (`heartbeat`, score 78/55):** Selected because the 12 uniform monthly salary deposits anchor the year's rhythm while October surges to $7,013 (1.9× the typical non-studio monthly average).
- **The Big One (`big_one`, score 100/55):** Selected because the single $9,061.87 payment at Monarch Acoustic on 2025-08-11 equals 10 weeks of normal discretionary spending.
- **The Shatter (`shatter`, score 96/50):** Selected near the end of the arc to break all 365 day squares into category columns led by shopping ($28,144, 49%).
- **Your Money Personality (`personality`, score 100/50):** Always included near the finale (BRIEF.md §3.1) to reveal the person's data-driven money archetype and generative radial poster.

### Why Other Candidates Were Rejected
- **The Endurance Block (`bespoke_wellness`, score 26/60):** Rejected because 3 physio sessions ($535) is a minor secondary signal compared to the studio build and 163-coffee habit.
- **The Home Table (`bespoke_home_pantry`, score 24/60):** Rejected because grocery-to-takeaway ratio (64 vs 38, 1.7×) reflects normal mixed dining rather than an extreme home-cooking signature.

---

## 3. Final 13-Chapter Narrative Arc & Palette Choreography

| # | Chapter ID | Type | Bespoke Module | Palette | Headline Template | Resolved Preview | Receipts |
|---:|---|---|---|---|---|---|---:|
| 1 | `pour` | `pour` | `—` | `ink_solar` | `Your {fact:year_number} in {fact:total_transactions_count} lines.` | Your 2025 in 1,000 lines. | `835` |
| 2 | `year_as_squares` | `year_as_squares` | `—` | `ink_solar` | `Every square is a day. {fact:discretionary_spend_usd} across the year.` | Every square is a day. $56,945 across the year. | `737` |
| 3 | `your_place` | `your_place` | `—` | `solar_ember` | `{fact:top_merchant_name}, {fact:visits_top_merchant} times.` | Blue Bottle Coffee, 72 times. | `72` |
| 4 | `bespoke_0` | `bespoke` | `studio` | `paper_studio` | `Room to Make Noise: {fact:studio_total_with_gear_spend} across {fact:studio_gear_count} purchases.` | Room to Make Noise: $15,496 across 15 purchases. | `15` |
| 5 | `streak` | `streak` | `—` | `olive_lime` | `{fact:longest_spend_streak_days} days in a row. And {fact:no_spend_days_count} quiet days.` | 34 days in a row. And 97 quiet days. | `148` |
| 6 | `getaway` | `getaway` | `—` | `cobalt_bone` | `{fact:getaway_location_name}: {fact:getaway_spend_usd} across {fact:getaway_days_count} coastal days.` | Cannon Beach: $977 across 7 coastal days. | `39` |
| 7 | `bespoke_1` | `bespoke` | `coffee` | `solar_ember` | `The Morning Rivalry: {fact:top_merchant_name} ({fact:visits_top_merchant}) vs {fact:second_coffee_merchant_name} ({fact:second_coffee_visits}).` | The Morning Rivalry: Blue Bottle Coffee (72) vs Sightglass Coffee (41). | `163` |
| 8 | `heartbeat` | `heartbeat` | `—` | `ink_rose` | `{fact:payday_count} steady paydays. And the October surge to {fact:october_spend_usd}.` | 12 steady paydays. And the October surge to $7,013. | `214` |
| 9 | `big_one` | `big_one` | `—` | `crimson_ink` | `One payment changed the skyline: {fact:big_one_spend} at {fact:big_one_merchant}.` | One payment changed the skyline: $9,061.87 at Monarch Acoustic. | `2` |
| 10 | `shatter` | `shatter` | `—` | `ink_solar` | `Where {fact:discretionary_spend_usd} of everyday spending went.` | Where $56,945 of everyday spending went. | `725` |
| 11 | `personality` | `personality` | `—` | `lavender_night` | `The Studio-Building Regular` | The Studio-Building Regular | `90` |
| 12 | `one_line` | `one_line` | `—` | `ink_solar` | `In {fact:year_number}, across {fact:total_transactions_count} transactions and {fact:discretionary_spend_usd} of discretionary spend, you visited {fact:top_merchant_name} {fact:visits_top_merchant} times, poured {fact:studio_total_with_gear_spend} into building a home studio, and saved {fact:savings_invest_total_usd}.` | In 2025, across 1,000 transactions and $56,945 of discretionary spend, you visited Blue Bottle Coffee 72 times, poured $15,496 into building a home studio, and saved $17,215. | `90` |
| 13 | `share_card` | `share_card` | `—` | `solar_ember` | `Sam · {fact:year_number}` | Sam · 2025 | `72` |

---

## 4. Bespoke Chapters Deep Dive (`badge: "only in your app"`)

### 4.1 `bespoke_0` (`bespoke_module: "studio"`) — **Room to Make Noise**
- **Why Sam needs this chapter:** Generic spending recaps bury large creative projects inside a generic "Shopping" bar. Sam's 2025 has an unmistakable two-act creative build: a `{fact:studio_deposit_spend}` (`$2,535`) Monarch Acoustic deposit on `2025-05-24` followed by the `{fact:studio_final_spend}` (`$9,061.87`) Monarch Acoustic completion payment on `2025-08-11` (`{fact:studio_total_spend}` / `$11,596` for the room), immediately followed by a `{fact:studio_synth_spend}` (`$445`) synth purchase on `2025-08-19` and `{fact:studio_gear_count}` (`15`) total purchases across Sweetwater, Rubber Duckling, Synthyard, MyVolts, and secondhand synth/audio sellers totaling `{fact:studio_total_with_gear_spend}` (`$15,496`).
- **Palette:** `paper_studio` (Warm Bone `#F3F0E6` & Studio Ember `#FF5A14` on `#111111` ink).
- **Badge:** `"only in your app"`.

### 4.2 `bespoke_1` (`bespoke_module: "coffee"`) — **The Morning Rivalry**
- **Why Sam needs this chapter:** Sam bought `{fact:coffee_total_visits}` (`163`) coffees across `{fact:coffee_merchants_count}` (`20`) distinct cafés totaling `{fact:coffee_total_spend}` (`$2,264`), with a `{fact:longest_coffee_streak_days}`-day (`5`-day) consecutive coffee streak. Even more distinctively, two local cafés competed for Sam's mornings all year across noisy bank strings: `{fact:top_merchant_name}` (**Blue Bottle Coffee**, `{fact:visits_top_merchant}` = `72` visits, `{fact:spend_top_merchant}` = `$572.80`) vs `{fact:second_coffee_merchant_name}` (**Sightglass Coffee**, unified across `SIGHTGLASS COFFEE SF`, `SIGHTGLASS COFFEE SOMA`, and `SIGHTGLASS COFFEE MISSION` at `{fact:second_coffee_visits}` = `41` visits, `{fact:second_coffee_spend}` = `$634.27` — topping Blue Bottle in total dollars despite fewer stops).
- **Palette:** `solar_ember` (Solar Yellow `#F4F03A` & Ember Orange `#FF5A14`).
- **Badge:** `"only in your app"`.

---

## 5. Money Personality & One-Line Distillation

- **Personality Title:** `The Studio-Building Regular`
- **Personality Subtitle Template:** `Takeaway for Sam — You run a barbell money strategy: predictable daily rituals ({fact:visits_top_merchant} stops at {fact:top_merchant_name} across {fact:coffee_total_visits} coffees) and {fact:savings_invest_total_usd} in automated savings give you the margin to fund {fact:studio_total_with_gear_spend} in bold creative projects.`
- **Resolved Subtitle:** "Takeaway for Sam — You run a barbell money strategy: predictable daily rituals (72 stops at Blue Bottle Coffee across 163 coffees) and $17,215 in automated savings give you the margin to fund $15,496 in bold creative projects."
- **Dominant Discretionary Categories:** `shopping`, `eating out`, `travel`, `transport`, `groceries`
- **One-Line Template:** `In {fact:year_number}, across {fact:total_transactions_count} transactions and {fact:discretionary_spend_usd} of discretionary spend, you visited {fact:top_merchant_name} {fact:visits_top_merchant} times, poured {fact:studio_total_with_gear_spend} into building a home studio, and saved {fact:savings_invest_total_usd}.`
- **Resolved One-Line:** "In 2025, across 1,000 transactions and $56,945 of discretionary spend, you visited Blue Bottle Coffee 72 times, poured $15,496 into building a home studio, and saved $17,215."
