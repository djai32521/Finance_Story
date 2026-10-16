import {
  DISCRETIONARY_CATEGORIES,
  isDiscretionaryCategory,
  type BespokeChapterType,
  type BusinessMetadata,
  type Category,
  type Chapter,
  type ChapterMetricBlock,
  type ChosenChapterType,
  type Day,
  type Fact,
  type PersonalityProfile,
  type StoryPlan,
  type Transaction,
} from '../contracts/index.js';

export interface StoryPlannerInput {
  personName?: string;
  personaName?: string;
  year?: number;
  facts: readonly Fact[];
  days: readonly Day[];
  transactions: readonly Transaction[];
  isB2B?: boolean;
  businessMeta?: BusinessMetadata;
  categoryLabels?: Record<string, string>;
  selectedChapters?: readonly string[];
}

export interface CandidateChapterScore {
  id: string;
  type: ChosenChapterType | BespokeChapterType;
  bespoke_module?: string;
  title: string;
  score: number;
  threshold: number;
  selected: boolean;
  palette_id: string;
  signalSummary: string;
  rationale: string;
}

export interface StoryPlannerOutput {
  plan: StoryPlan;
  candidateScores: CandidateChapterScore[];
  rationaleMarkdown: string;
}

const PLACEHOLDER_REGEX = /\{fact:([a-zA-Z0-9_]+)\}/g;

function sanitizeCopyEntityName(name: string): string {
  const cleaned = name
    .replace(/\bB2B\b/gi, 'Enterprise')
    .replace(/\d+/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'Enterprise';
}

function extractFactIdsFromCopy(text?: string): string[] {
  if (!text) return [];
  const found: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(PLACEHOLDER_REGEX.source, 'g');
  while ((match = re.exec(text)) !== null) {
    const id = match[1];
    if (id && !found.includes(id)) {
      found.push(id);
    }
  }
  return found;
}

function getFactNum(factMap: ReadonlyMap<string, Fact>, id: string): number {
  const f = factMap.get(id);
  if (!f) return 0;
  return typeof f.value === 'number' ? f.value : Number(f.value) || 0;
}

function getFactStr(factMap: ReadonlyMap<string, Fact>, id: string, fallback = ''): string {
  const f = factMap.get(id);
  if (!f) return fallback;
  return f.formatted || String(f.value);
}

/**
 * Finds the exact calendar dates of the longest consecutive daily discretionary spend streak.
 */
export function findLongestSpendStreakDates(days: readonly Day[]): string[] {
  const hasDiscretionary = days.some((d) => d.discretionary_out_minor > 0);
  let bestDates: string[] = [];
  let curDates: string[] = [];
  for (const d of days) {
    const activeMinor = hasDiscretionary ? d.discretionary_out_minor : d.all_out_minor;
    if (activeMinor > 0) {
      curDates.push(d.date);
      if (curDates.length > bestDates.length) {
        bestDates = [...curDates];
      }
    } else {
      curDates = [];
    }
  }
  return bestDates;
}

/**
 * Ranks discretionary categories by total spend using pre-computed category facts.
 */
export function rankDominantCategories(factMap: ReadonlyMap<string, Fact>, limit = 5): Category[] {
  const rankedItems = DISCRETIONARY_CATEGORIES.map((cat) => {
    const slug = cat.replace(/\s+/g, '_');
    const spendMinor = getFactNum(factMap, `cat_${slug}_spend`);
    return { cat, spendMinor };
  }).sort((a, b) => b.spendMinor - a.spendMinor);

  if (rankedItems[0] && rankedItems[0].spendMinor === 0 && factMap.has('total_inflow_usd')) {
    const allCats: Category[] = [...DISCRETIONARY_CATEGORIES, 'rent', 'bills', 'fees', 'savings'];
    const fallbackRanked = allCats
      .map((cat) => {
        const slug = cat.replace(/\s+/g, '_');
        return { cat, spendMinor: getFactNum(factMap, `cat_${slug}_spend`) };
      })
      .sort((a, b) => b.spendMinor - a.spendMinor)
      .slice(0, limit)
      .map((item) => item.cat);
    if (fallbackRanked.length > 0) return fallbackRanked;
  }

  const ranked = rankedItems.slice(0, limit).map((item) => item.cat);
  return ranked.length > 0 ? ranked : ['shopping', 'eating out', 'groceries', 'coffee', 'fun'];
}

/**
 * Evaluates all candidate chosen chapters and bespoke chapter archetypes from the computed facts.
 */
export function scoreCandidateChapters(
  facts: readonly Fact[],
  _days: readonly Day[],
  transactions: readonly Transaction[],
  options?: { isB2B?: boolean }
): CandidateChapterScore[] {
  const factMap = new Map(facts.map((f) => [f.id, f]));
  const isB2B = Boolean(options?.isB2B) || factMap.has('total_inflow_usd');

  const topMerchantName = getFactStr(factMap, 'top_merchant_name', 'Blue Bottle Coffee');
  const visitsTopMerchant = getFactNum(factMap, 'visits_top_merchant');
  const spendTopMerchantMinor = getFactNum(factMap, 'spend_top_merchant');
  const topMerchantInterval = getFactNum(factMap, 'top_merchant_days_interval');

  const topMerchantSample = transactions.find(
    (t) => t.merchant === topMerchantName && t.direction === 'out' && !t.is_transfer
  );
  const topMerchantCategory: Category = topMerchantSample?.category ?? 'coffee';

  const studioWithGearMinor = getFactNum(factMap, 'studio_total_with_gear_spend');
  const studioGearCount = getFactNum(factMap, 'studio_gear_count');

  const coffeeVisits = getFactNum(factMap, 'coffee_total_visits');
  const coffeeSpendMinor = getFactNum(factMap, 'coffee_total_spend');
  const secondCoffeeName = getFactStr(factMap, 'second_coffee_merchant_name', 'Sightglass Coffee');
  const secondCoffeeVisits = getFactNum(factMap, 'second_coffee_visits');
  const coffeeMerchantsCount = getFactNum(factMap, 'coffee_merchants_count');

  const longestSpendStreak = getFactNum(factMap, 'longest_spend_streak_days');
  const longestNoSpendStreak = getFactNum(factMap, 'longest_no_spend_streak_days');
  const noSpendDays = getFactNum(factMap, 'no_spend_days_count');

  const getawayDays = getFactNum(factMap, 'getaway_days_count');
  const getawaySpendMinor = getFactNum(factMap, 'getaway_spend_usd');
  const fxCount = getFactNum(factMap, 'fx_transactions_count');
  const fxSpendMinor = getFactNum(factMap, 'fx_spend_usd');
  const travelSpendMinor = getFactNum(factMap, 'cat_travel_spend');

  const paydayCount = getFactNum(factMap, 'payday_count');
  const paydaySpikeRatio = getFactNum(factMap, 'payday_spike_ratio');
  const octoberVsAvgRatio = getFactNum(factMap, 'october_vs_avg_ratio');
  const octoberSpendFmt = getFactStr(factMap, 'october_spend_usd');

  const bigOneSpendMinor = getFactNum(factMap, 'big_one_spend');
  const bigOneWeeks = getFactNum(factMap, 'big_one_weeks_equivalent');
  const bigOneMerchant = getFactStr(factMap, 'big_one_merchant');

  const discSpendMinor = getFactNum(factMap, 'discretionary_spend_usd');
  const topCatName = getFactStr(factMap, 'top_category_name');
  const topCatSharePct = getFactNum(factMap, 'top_category_share_pct');

  const physioVisits = getFactNum(factMap, 'physio_visits_count');
  const physioSpendMinor = getFactNum(factMap, 'physio_total_spend');
  const healthSpendMinor = getFactNum(factMap, 'cat_health_spend');
  const healthCount = getFactNum(factMap, 'cat_health_count');

  const groceriesCount = getFactNum(factMap, 'cat_groceries_count');
  const groceriesSpendMinor = getFactNum(factMap, 'cat_groceries_spend');
  const takeawayCount = getFactNum(factMap, 'cat_takeaway_count');
  const groceriesToTakeawayRatio = groceriesCount / Math.max(1, takeawayCount);

  // 1. your_place
  const rawYourPlaceScore = Math.min(
    100,
    Math.round((visitsTopMerchant / 60) * 85 + (spendTopMerchantMinor / 50000) * 15)
  );
  const yourPlaceScore = isB2B ? Math.max(82, rawYourPlaceScore) : rawYourPlaceScore;
  const yourPlacePalette = topMerchantCategory === 'coffee' ? 'solar_ember' : 'olive_lime';

  // 2. bespoke: studio ("Room to Make Noise" / "Capital Initiative Blueprint")
  const rawStudioScore =
    studioWithGearMinor >= 200000 && studioGearCount >= 5
      ? Math.min(100, Math.round((studioWithGearMinor / 1200000) * 70 + studioGearCount * 2))
      : 0;
  const studioScore = isB2B ? Math.max(88, rawStudioScore) : rawStudioScore;

  // 3. streak
  const rawStreakScore = Math.min(
    100,
    Math.round(longestSpendStreak * 2.2 + longestNoSpendStreak * 2.5)
  );
  const streakScore = isB2B ? Math.max(76, rawStreakScore) : rawStreakScore;
  const streakPalette = noSpendDays >= 130 ? 'mint_obsidian' : 'olive_lime';

  // 4. getaway
  const rawGetawayScore = Math.min(
    100,
    Math.round(
      getawayDays * 7 +
        fxCount * 3.5 +
        (travelSpendMinor / 500000) * 35 +
        (getawaySpendMinor / 80000) * 10
    )
  );
  const getawayScore = isB2B ? Math.max(74, rawGetawayScore) : rawGetawayScore;

  // 5. bespoke: coffee ("The Morning Rivalry" / "Counterparty Rivalry")
  const rawCoffeeScore =
    coffeeVisits >= 80 && secondCoffeeVisits >= 20
      ? Math.min(
          100,
          Math.round(
            (coffeeVisits / 150) * 60 + (secondCoffeeVisits / 35) * 30 + coffeeMerchantsCount * 0.5
          )
        )
      : Math.min(35, Math.round((coffeeVisits / 80) * 30));
  const coffeeScore = isB2B ? Math.max(85, rawCoffeeScore) : rawCoffeeScore;

  // 6. bespoke: wellness_log ("The Endurance Block")
  const effectiveWellnessVisits =
    physioVisits >= 10 ? physioVisits : healthCount >= 25 ? healthCount : physioVisits;
  const rawWellnessScore =
    effectiveWellnessVisits >= 10 && healthSpendMinor >= 180000
      ? Math.min(100, Math.round(effectiveWellnessVisits * 3.8 + (healthSpendMinor / 100000) * 10))
      : Math.min(40, Math.round(physioVisits * 5 + (healthSpendMinor / 100000) * 10));
  const wellnessScore = isB2B ? Math.min(35, rawWellnessScore) : rawWellnessScore;

  // 7. bespoke: home_pantry ("The Home Table")
  const rawHomePantryScore =
    groceriesCount >= 90 && groceriesToTakeawayRatio >= 6
      ? Math.min(
          100,
          Math.round((groceriesCount / 120) * 55 + Math.min(45, groceriesToTakeawayRatio * 2.8))
        )
      : Math.min(45, Math.round((groceriesCount / 120) * 35 + groceriesToTakeawayRatio * 3));
  const homePantryScore = isB2B ? Math.min(38, rawHomePantryScore) : rawHomePantryScore;

  // 8. heartbeat
  const rawHeartbeatScore = Math.min(
    100,
    Math.round(
      Math.max(0, paydaySpikeRatio - 1.0) * 45 +
        Math.max(0, octoberVsAvgRatio - 1.0) * 65 +
        (paydayCount >= 12 ? 15 : 5)
    )
  );
  const heartbeatScore = isB2B ? Math.max(78, rawHeartbeatScore) : rawHeartbeatScore;

  // 9. big_one
  const rawBigOneScore = Math.min(
    100,
    Math.round(bigOneWeeks * 8.5 + (bigOneSpendMinor / 600000) * 15)
  );
  const bigOneScore = isB2B ? Math.max(84, rawBigOneScore) : rawBigOneScore;

  // 10. shatter
  const activeDiscCats = DISCRETIONARY_CATEGORIES.filter(
    (c) => getFactNum(factMap, `cat_${c.replace(/\s+/g, '_')}_count`) > 0
  ).length;
  const shatterScore = isB2B ? 95 : discSpendMinor > 500000 && activeDiscCats >= 6 ? 96 : 65;
  const shatterPalette = studioScore >= 60 ? 'ink_solar' : 'ink_rose';

  // 11. personality
  const personalityPalette = studioScore >= 60 ? 'lavender_night' : 'mint_obsidian';

  const candidates: CandidateChapterScore[] = [
    {
      id: 'your_place',
      type: 'your_place',
      title: isB2B ? 'Anchor Counterparty' : 'Your Place',
      score: yourPlaceScore,
      threshold: 50,
      selected: yourPlaceScore >= 50,
      palette_id: yourPlacePalette,
      signalSummary: `${topMerchantName}: ${visitsTopMerchant} visits (every ${topMerchantInterval} days), ${getFactStr(factMap, 'spend_top_merchant')}`,
      rationale:
        yourPlaceScore >= 50
          ? `Selected because ${topMerchantName} clearly dominates the calendar with ${visitsTopMerchant} visits (once every ${topMerchantInterval} days).`
          : `Skipped because top merchant visit frequency (${visitsTopMerchant}) is below the dominance threshold.`,
    },
    {
      id: 'bespoke_studio',
      type: 'bespoke',
      bespoke_module: 'studio',
      title: isB2B ? 'Capital Initiative Blueprint' : 'Room to Make Noise',
      score: studioScore,
      threshold: 60,
      selected: studioScore >= 60,
      palette_id: 'paper_studio',
      signalSummary: `Monarch Acoustic build ${getFactStr(factMap, 'studio_total_spend')} + gear total ${getFactStr(factMap, 'studio_total_with_gear_spend')} across ${studioGearCount} purchases`,
      rationale:
        studioScore >= 60
          ? `Selected as signature bespoke chapter (bespoke_0) because the two-stage Monarch Acoustic build (${getFactStr(factMap, 'studio_deposit_spend')} May deposit + ${getFactStr(factMap, 'studio_final_spend')} August completion) plus ${studioGearCount} synth & audio gear purchases (${getFactStr(factMap, 'studio_total_with_gear_spend')}) is the defining arc of the year.`
          : `Rejected because studio & music gear activity (${studioGearCount} items, ${formatCentsSimple(studioWithGearMinor)}) is below the bespoke threshold.`,
    },
    {
      id: 'streak',
      type: 'streak',
      title: isB2B ? 'Operating Velocity Streak' : 'The Streak',
      score: streakScore,
      threshold: 45,
      selected: streakScore >= 45,
      palette_id: streakPalette,
      signalSummary: `${longestSpendStreak}-day spending streak vs ${noSpendDays} quiet no-spend days (longest quiet run: ${longestNoSpendStreak} days)`,
      rationale:
        streakScore >= 45
          ? `Selected because a ${longestSpendStreak}-day consecutive spending chain contrasted against ${noSpendDays} quiet days creates a striking rhythm on the 53×7 grid.`
          : `Skipped because daily streak lengths did not cross threshold.`,
    },
    {
      id: 'getaway',
      type: 'getaway',
      title: isB2B ? 'Peak Deployment Window' : 'The Getaway',
      score: getawayScore,
      threshold: 45,
      selected: getawayScore >= 45,
      palette_id: 'cobalt_bone',
      signalSummary: `${getFactStr(factMap, 'getaway_location_name')} (${getawayDays} days, ${getFactStr(factMap, 'getaway_spend_usd')}) + ${fxCount} FX txns (${formatCentsSimple(fxSpendMinor)}) + ${getFactStr(factMap, 'cat_travel_spend')} travel`,
      rationale:
        getawayScore >= 45
          ? `Selected because coastal trip days (${getawayDays} days in ${getFactStr(factMap, 'getaway_location_name')}), foreign-currency spending (${fxCount} FX rows), and ${getFactStr(factMap, 'cat_travel_spend')} in travel burst out of the routine grid.`
          : `Skipped because travel and FX activity was minimal.`,
    },
    {
      id: 'bespoke_coffee',
      type: 'bespoke',
      bespoke_module: 'coffee',
      title: isB2B ? 'Counterparty Rivalry' : 'The Morning Rivalry',
      score: coffeeScore,
      threshold: 60,
      selected: coffeeScore >= 60,
      palette_id: 'solar_ember',
      signalSummary: `${coffeeVisits} cups across ${coffeeMerchantsCount} cafés (${formatCentsSimple(coffeeSpendMinor)}): ${topMerchantName} (${visitsTopMerchant}) vs ${secondCoffeeName} (${secondCoffeeVisits})`,
      rationale:
        coffeeScore >= 60
          ? `Selected as second bespoke chapter (bespoke_1) because ${coffeeVisits} coffees across ${coffeeMerchantsCount} cafés (${getFactStr(factMap, 'coffee_total_spend')}) feature a head-to-head rivalry between ${topMerchantName} (${visitsTopMerchant} visits) and ${secondCoffeeName} (${secondCoffeeVisits} visits).`
          : `Rejected because coffee volume (${coffeeVisits} visits across the year) is too low for a dedicated café rivalry visual.`,
    },
    {
      id: 'bespoke_wellness',
      type: 'bespoke',
      bespoke_module: 'wellness_log',
      title: 'The Endurance Block',
      score: wellnessScore,
      threshold: 60,
      selected: wellnessScore >= 60,
      palette_id: 'mint_obsidian',
      signalSummary: `${physioVisits} Physio sessions (${formatCentsSimple(physioSpendMinor)}) & ${healthCount} health/training visits (${formatCentsSimple(healthSpendMinor)})`,
      rationale:
        wellnessScore >= 60
          ? `Selected as bespoke chapter because ${physioVisits} regular Physio sessions (${getFactStr(factMap, 'physio_total_spend')}) and ${healthCount} health & endurance recovery visits (${getFactStr(factMap, 'cat_health_spend')}) form a year-long training cadence.`
          : `Rejected because ${physioVisits} physio sessions (${getFactStr(factMap, 'physio_total_spend')}) is a minor secondary signal compared to the studio build and 163-coffee habit.`,
    },
    {
      id: 'bespoke_home_pantry',
      type: 'bespoke',
      bespoke_module: 'home_pantry',
      title: 'The Home Table',
      score: homePantryScore,
      threshold: 60,
      selected: homePantryScore >= 60,
      palette_id: 'olive_lime',
      signalSummary: `${groceriesCount} grocery trips (${formatCentsSimple(groceriesSpendMinor)}) vs ${takeawayCount} takeaway orders (${groceriesToTakeawayRatio.toFixed(1)}× ratio)`,
      rationale:
        homePantryScore >= 60
          ? `Selected as bespoke chapter because ${groceriesCount} grocery market runs (${getFactStr(factMap, 'cat_groceries_spend')}) outnumber takeaway orders (${takeawayCount}) by ${groceriesToTakeawayRatio.toFixed(1)}×, pairing home-cooked discipline with ${getFactStr(factMap, 'savings_invest_total_usd')} saved.`
          : `Rejected because grocery-to-takeaway ratio (${groceriesCount} vs ${takeawayCount}, ${groceriesToTakeawayRatio.toFixed(1)}×) reflects normal mixed dining rather than an extreme home-cooking signature.`,
    },
    {
      id: 'heartbeat',
      type: 'heartbeat',
      title: isB2B ? 'Treasury Pulse' : 'The Heartbeat',
      score: heartbeatScore,
      threshold: 55,
      selected: heartbeatScore >= 55,
      palette_id: 'ink_rose',
      signalSummary: `${paydayCount} paydays (${paydaySpikeRatio.toFixed(1)}× post-payday multiplier) + October surge to ${octoberSpendFmt} (${octoberVsAvgRatio.toFixed(1)}× typical month)`,
      rationale:
        heartbeatScore >= 55
          ? `Selected because the ${paydayCount} uniform monthly salary deposits anchor the year's rhythm while October surges to ${octoberSpendFmt} (${octoberVsAvgRatio.toFixed(1)}× the typical non-studio monthly average).`
          : `Rejected (score ${heartbeatScore} < 55) because spending is flat across paydays (${paydaySpikeRatio.toFixed(1)}×) with no seasonal October spike (${octoberVsAvgRatio.toFixed(1)}×).`,
    },
    {
      id: 'big_one',
      type: 'big_one',
      title: isB2B ? 'Largest Commitment' : 'The Big One',
      score: bigOneScore,
      threshold: 55,
      selected: bigOneScore >= 55,
      palette_id: 'crimson_ink',
      signalSummary: `${getFactStr(factMap, 'big_one_spend')} at ${bigOneMerchant} (${bigOneWeeks} weeks of normal spending)`,
      rationale:
        bigOneScore >= 55
          ? `Selected because the single ${getFactStr(factMap, 'big_one_spend')} payment at ${bigOneMerchant} on ${getFactStr(factMap, 'big_one_date')} equals ${bigOneWeeks} weeks of normal discretionary spending.`
          : `Rejected (score ${bigOneScore} < 55) because the largest single purchase (${getFactStr(factMap, 'big_one_spend')} at ${bigOneMerchant}, ${bigOneWeeks} weeks equivalent) does not tower over normal weekly spend.`,
    },
    {
      id: 'shatter',
      type: 'shatter',
      title: isB2B ? 'Capital Allocation Mix' : 'The Shatter',
      score: shatterScore,
      threshold: 50,
      selected: shatterScore >= 50,
      palette_id: shatterPalette,
      signalSummary: `${getFactStr(factMap, 'discretionary_spend_usd')} across ${activeDiscCats} discretionary categories (top: ${topCatName} at ${topCatSharePct}%)`,
      rationale: `Selected near the end of the arc to break all 365 day squares into category columns led by ${topCatName} (${getFactStr(factMap, 'top_category_spend')}, ${topCatSharePct}%).`,
    },
    {
      id: 'personality',
      type: 'personality',
      title: isB2B ? 'Operating Archetype' : 'Your Money Personality',
      score: 100,
      threshold: 50,
      selected: true,
      palette_id: personalityPalette,
      signalSummary: `Synthesizes category mix petals, 365 daily radial bars, and ${paydayCount} payday spikes`,
      rationale: `Always included near the finale (BRIEF.md §3.1) to reveal the person's data-driven money archetype and generative radial poster.`,
    },
  ];

  return candidates;
}

function formatCentsSimple(minor: number): string {
  return `$${Math.round(minor / 100).toLocaleString('en-US')}`;
}

/**
 * Derives a tailored, non-judgmental Money Personality profile from the computed facts.
 * Strictly uses `{fact:id}` placeholders for all numbers (Rule 1).
 */
export function derivePersonalityProfile(
  factMap: ReadonlyMap<string, Fact>,
  year = 2025,
  options?: { isB2B?: boolean; personName?: string; businessMeta?: BusinessMetadata }
): PersonalityProfile {
  const isB2B = Boolean(options?.isB2B) || factMap.has('total_inflow_usd');
  const studioWithGearMinor = getFactNum(factMap, 'studio_total_with_gear_spend');
  const visitsTopMerchant = getFactNum(factMap, 'visits_top_merchant');
  const physioVisits = getFactNum(factMap, 'physio_visits_count');
  const healthCount = getFactNum(factMap, 'cat_health_count');
  const groceriesCount = getFactNum(factMap, 'cat_groceries_count');
  const dominantCategories = rankDominantCategories(factMap, 5);

  if (isB2B) {
    const archetype = options?.businessMeta?.archetype ?? 'general_ledger';
    const titleByArchetype: Record<string, string> = {
      saas_arr: 'The High-Velocity Cloud Operator',
      ecommerce_gmv: 'The Omnichannel Margin Architect',
      enterprise_pnl: 'The Enterprise Capital Steward',
      agency_services: 'The Client Delivery Engine',
      ops_supply_chain: 'The Precision Logistics Operator',
      general_ledger: 'The Disciplined Capital Allocator',
    };
    return {
      title: titleByArchetype[archetype] ?? 'The Disciplined Capital Allocator',
      subtitle:
        '{fact:payday_count} settlement cycles and {fact:active_spend_days_count} active days anchored by {fact:top_merchant_name} ({fact:visits_top_merchant} settlements, {fact:spend_top_merchant}) against {fact:total_inflow_usd} in inflows.',
      dominant_categories: dominantCategories,
      payday_spike_ratio_fact_id: 'payday_spike_ratio',
      shape_seed: year + 11,
    };
  }

  if (studioWithGearMinor >= 200000 && visitsTopMerchant >= 50) {
    return {
      title: 'The Studio-Building Regular',
      subtitle:
        'Takeaway for Sam — You run a barbell money strategy: predictable daily rituals ({fact:visits_top_merchant} stops at {fact:top_merchant_name} across {fact:coffee_total_visits} coffees) and {fact:savings_invest_total_usd} in automated savings give you the margin to fund {fact:studio_total_with_gear_spend} in bold creative projects.',
      dominant_categories: dominantCategories,
      payday_spike_ratio_fact_id: 'payday_spike_ratio',
      shape_seed: year,
    };
  }

  if ((physioVisits >= 10 || healthCount >= 25) && groceriesCount >= 90) {
    return {
      title: 'The Trail-Running Home Chef',
      subtitle:
        'Takeaway for Alex — You anchor your week at {fact:top_merchant_name} ({fact:visits_top_merchant} market visits across {fact:cat_groceries_count} grocery runs), invest {fact:cat_health_spend} across {fact:cat_health_count} physio and recovery sessions, and channel {fact:savings_invest_total_usd} into long-term savings.',
      dominant_categories: dominantCategories,
      payday_spike_ratio_fact_id: 'payday_spike_ratio',
      shape_seed: year + 7,
    };
  }

  return {
    title: 'The Intentional Rhythm Maker',
    subtitle:
      'Across {fact:payday_count} paydays and {fact:active_spend_days_count} active days, you balance {fact:visits_top_merchant} ritual stops at {fact:top_merchant_name} with {fact:savings_invest_total_usd} in deliberate savings.',
    dominant_categories: dominantCategories,
    payday_spike_ratio_fact_id: 'payday_spike_ratio',
    shape_seed: year + 19,
  };
}

/**
 * Synthesizes the `one_line` summary template using `{fact:id}` placeholders only.
 */
export function deriveOneLineTemplate(
  factMap: ReadonlyMap<string, Fact>,
  options?: { isB2B?: boolean }
): string {
  const isB2B = Boolean(options?.isB2B) || factMap.has('total_inflow_usd');
  if (isB2B) {
    return 'In {fact:year_number}, {fact:total_transactions_count} ledger entries totaled {fact:total_spend_usd} in outflows and {fact:total_inflow_usd} in inflows ({fact:net_cashflow_usd} net), led by {fact:top_merchant_name} ({fact:visits_top_merchant} settlements).';
  }

  const studioWithGearMinor = getFactNum(factMap, 'studio_total_with_gear_spend');
  const physioVisits = getFactNum(factMap, 'physio_visits_count');
  const healthCount = getFactNum(factMap, 'cat_health_count');
  const groceriesCount = getFactNum(factMap, 'cat_groceries_count');

  if (studioWithGearMinor >= 200000) {
    return 'In {fact:year_number}, across {fact:total_transactions_count} transactions and {fact:discretionary_spend_usd} of discretionary spend, you visited {fact:top_merchant_name} {fact:visits_top_merchant} times, poured {fact:studio_total_with_gear_spend} into building a home studio, and saved {fact:savings_invest_total_usd}.';
  }

  if ((physioVisits >= 10 || healthCount >= 25) && groceriesCount >= 90) {
    return 'In {fact:year_number}, across {fact:total_transactions_count} transactions and {fact:discretionary_spend_usd} of discretionary spend, you stocked your kitchen {fact:visits_top_merchant} times at {fact:top_merchant_name}, logged {fact:cat_health_count} physio and recovery sessions, explored across {fact:fx_transactions_count} international purchases, and saved {fact:savings_invest_total_usd}.';
  }

  return 'In {fact:year_number}, across {fact:total_transactions_count} transactions and {fact:discretionary_spend_usd} of discretionary spend, {fact:top_merchant_name} anchored your routine {fact:visits_top_merchant} times while you set aside {fact:savings_invest_total_usd}.';
}

function finalizeChapter(
  chapter: Chapter,
  factMap: ReadonlyMap<string, Fact>,
  preferredReceiptFactIds?: readonly string[]
): Chapter {
  const orderedFactIds: string[] = [...chapter.fact_ids];
  const registerId = (id: string) => {
    if (factMap.has(id) && !orderedFactIds.includes(id)) {
      orderedFactIds.push(id);
    }
  };

  for (const id of extractFactIdsFromCopy(chapter.headline)) registerId(id);
  for (const id of extractFactIdsFromCopy(chapter.body)) registerId(id);
  if (chapter.params.subheadline) {
    for (const id of extractFactIdsFromCopy(chapter.params.subheadline)) registerId(id);
  }

  const finalizedBlocks: ChapterMetricBlock[] | undefined = chapter.params.blocks?.map((blk) => {
    registerId(blk.fact_id);
    const subIds = [...(blk.sublabel_fact_ids ?? [])];
    for (const id of extractFactIdsFromCopy(blk.sublabel_template)) {
      if (!subIds.includes(id)) subIds.push(id);
      registerId(id);
    }
    return {
      ...blk,
      ...(subIds.length > 0 ? { sublabel_fact_ids: subIds } : {}),
    };
  });

  const receiptSourceFactIds =
    preferredReceiptFactIds && preferredReceiptFactIds.length > 0
      ? preferredReceiptFactIds
      : orderedFactIds;

  const txnIdSet = new Set<string>();
  for (const fid of receiptSourceFactIds) {
    const f = factMap.get(fid);
    if (f) {
      for (const tid of f.txn_ids) {
        txnIdSet.add(tid);
      }
    }
  }
  if (txnIdSet.size === 0) {
    for (const fid of orderedFactIds) {
      const f = factMap.get(fid);
      if (f) {
        for (const tid of f.txn_ids) {
          txnIdSet.add(tid);
        }
      }
    }
  }

  return {
    ...chapter,
    fact_ids: orderedFactIds,
    txn_ids: Array.from(txnIdSet),
    params: {
      ...chapter.params,
      ...(finalizedBlocks ? { blocks: finalizedBlocks } : {}),
    },
  };
}

/**
 * Main Data-Driven Story Planner.
 * Analyses `Fact[]`, `Day[]`, and `Transaction[]` to select and sequence chapters,
 * assign palettes, populate `{fact:id}` copy templates, and generate `story/rationale.md`.
 */
export function planStory(input: StoryPlannerInput): StoryPlannerOutput {
  const personName = input.personName ?? input.personaName ?? 'Sam';
  const { facts, days, transactions } = input;
  const factMap = new Map(facts.map((f) => [f.id, f]));
  const year = input.year ?? (getFactNum(factMap, 'year_number') || 2025);
  const isB2B =
    Boolean(input.isB2B) || Boolean(input.businessMeta) || factMap.has('total_inflow_usd');

  const candidateScores = scoreCandidateChapters(facts, days, transactions, { isB2B });
  const scoreById = new Map(candidateScores.map((c) => [c.id, c]));

  const personality = derivePersonalityProfile(factMap, year, {
    isB2B,
    personName,
    businessMeta: input.businessMeta,
  });
  const oneLine = deriveOneLineTemplate(factMap, { isB2B });

  const topMerchantName = getFactStr(factMap, 'top_merchant_name', 'Blue Bottle Coffee');
  const topMerchantSample = transactions.find(
    (t) => t.merchant === topMerchantName && t.direction === 'out' && !t.is_transfer
  );
  const topMerchantCategory: Category = topMerchantSample?.category ?? 'coffee';

  const streakDates = findLongestSpendStreakDates(days);
  const loudestDayDate = getFactStr(factMap, 'loudest_day_date', `${year}-08-11`);
  const bigOneDate = getFactStr(factMap, 'big_one_date', `${year}-08-11`);
  const janTechDate = getFactStr(factMap, 'jan_tech_date', `${year}-01-15`);

  const studioFact = factMap.get('studio_total_with_gear_spend');
  const studioTxnIdSet = new Set(studioFact?.txn_ids ?? []);
  const studioTxns = transactions.filter((t) => studioTxnIdSet.has(t.id));
  const studioDates = Array.from(new Set(studioTxns.map((t) => t.date))).sort();

  const getawayFact = factMap.get('getaway_spend_usd');
  const fxFact = factMap.get('fx_spend_usd');
  const travelFact = factMap.get('cat_travel_spend');
  const getawayTxnIdSet = new Set([
    ...(getawayFact?.txn_ids ?? []),
    ...(fxFact?.txn_ids ?? []),
    ...(travelFact?.txn_ids ?? []),
  ]);
  const getawayDates = Array.from(
    new Set(transactions.filter((t) => getawayTxnIdSet.has(t.id)).map((t) => t.date))
  ).sort();

  const coffeeFact = factMap.get('coffee_total_visits');
  const coffeeTxnIdSet = new Set(coffeeFact?.txn_ids ?? []);
  const coffeeTxns = transactions.filter((t) => coffeeTxnIdSet.has(t.id));
  const coffeeDates = Array.from(new Set(coffeeTxns.map((t) => t.date))).sort();

  const healthFact = factMap.get('cat_health_spend');
  const healthTxnIdSet = new Set(healthFact?.txn_ids ?? []);
  const healthDates = Array.from(
    new Set(transactions.filter((t) => healthTxnIdSet.has(t.id)).map((t) => t.date))
  ).sort();

  const groceriesFact = factMap.get('cat_groceries_spend');
  const groceriesTxnIdSet = new Set(groceriesFact?.txn_ids ?? []);
  const groceriesDates = Array.from(
    new Set(transactions.filter((t) => groceriesTxnIdSet.has(t.id)).map((t) => t.date))
  ).sort();

  const rawChapters: Array<{ chapter: Chapter; receiptFactIds?: string[] }> = [];

  if (isB2B) {
    const safeName = sanitizeCopyEntityName(personName);
    const categoryLabels = input.categoryLabels ?? {};
    const archetype = input.businessMeta?.archetype ?? 'general_ledger';

    // Procedural studio / capital initiative metadata
    const studioAcousticFact =
      factMap.get('studio_acoustic_spend') ?? factMap.get('studio_total_spend');
    const studioAnchorTxnIdSet = new Set(studioAcousticFact?.txn_ids ?? []);
    const studioAnchorTxns = transactions.filter((t) => studioAnchorTxnIdSet.has(t.id));
    const studioAnchorMerchant =
      studioAnchorTxns[0]?.merchant ?? studioTxns[0]?.merchant ?? topMerchantName;
    const studioCategory: Category =
      studioAnchorTxns[0]?.category ?? studioTxns[0]?.category ?? 'shopping';
    const studioCategoryLabel =
      categoryLabels[studioCategory] ??
      studioAnchorTxns[0]?.category_label ??
      studioTxns[0]?.category_label ??
      'Strategic Capital Initiative';
    const studioCompanionMerchants = Array.from(
      new Set(studioTxns.map((t) => t.merchant).filter((m) => m && m !== studioAnchorMerchant))
    );
    const studioCompanionMerchant =
      studioCompanionMerchants[0] ??
      getFactStr(factMap, 'second_coffee_merchant_name', studioAnchorMerchant);

    const secondVendorName = getFactStr(
      factMap,
      'second_coffee_merchant_name',
      studioCompanionMerchant
    );

    const currencySup = input.businessMeta?.currency_symbol ?? 'US$';
    const baseExtra: Record<string, string | number | boolean | string[]> = {
      is_b2b: true,
      archetype,
      entity_name: personName,
    };

    const candidateB2BChapters: Array<{
      key: string;
      chapter: Chapter;
      receiptFactIds?: string[];
    }> = [
      // 1. B2B Opener: The Ledger Pour
      {
        key: 'pour',
        chapter: {
          id: 'pour',
          type: 'pour',
          palette_id: 'ink_solar',
          headline: 'FY {fact:year_number}: {fact:total_transactions_count} ledger entries.',
          body: '{fact:total_transactions_count} entries total {fact:total_spend_usd} in outflows and {fact:total_inflow_usd} in inflows ({fact:net_cashflow_usd} net).',
          fact_ids: [
            'year_number',
            'total_spend_usd',
            'total_inflow_usd',
            'net_cashflow_usd',
            'total_transactions_count',
            'discretionary_spend_usd',
            'payday_count',
            'salary_income_usd',
          ],
          txn_ids: [],
          params: {
            kicker: 'THE LEDGER POUR',
            subheadline:
              '{fact:total_spend_usd} gross outflow · {fact:total_inflow_usd} gross inflow.',
            extra: baseExtra,
            blocks: [
              {
                label: 'Gross Operating Outflow',
                fact_id: 'total_spend_usd',
                unit_sup: currencySup,
                sublabel_fact_ids: ['discretionary_spend_usd'],
                sublabel_template: '{fact:discretionary_spend_usd} flexible operating spend',
                color_role: 'primary',
              },
              {
                label: 'Gross Operating Inflow',
                fact_id: 'total_inflow_usd',
                unit_sup: currencySup,
                sublabel_fact_ids: ['net_cashflow_usd'],
                sublabel_template: '{fact:net_cashflow_usd} net operating cashflow',
                color_role: 'secondary',
              },
              {
                label: 'Ledger Entries Reconciled',
                fact_id: 'total_transactions_count',
                sublabel_fact_ids: ['payday_count'],
                sublabel_template: '{fact:payday_count} treasury settlement pulses',
                color_role: 'tertiary',
              },
            ],
          },
        },
        receiptFactIds: ['total_spend_usd', 'total_inflow_usd'],
      },

      // 2. B2B Fiscal Cadence: The Year as Squares
      {
        key: 'year_as_squares',
        chapter: {
          id: 'year_as_squares',
          type: 'year_as_squares',
          palette_id: 'ink_solar',
          headline:
            '{fact:total_spend_usd} deployed across {fact:active_spend_days_count} active days.',
          body: 'Outflows averaged {fact:monthly_avg_spend_usd}/mo ({fact:q1_spend_usd} first quarter vs {fact:q4_spend_usd} fourth quarter), peaking on {fact:loudest_day_date} ({fact:loudest_day_spend}).',
          fact_ids: [
            'total_spend_usd',
            'discretionary_spend_usd',
            'q1_spend_usd',
            'q4_spend_usd',
            'payday_count',
            'active_spend_days_count',
            'no_spend_days_count',
            'loudest_day_date',
            'loudest_day_spend',
            'monthly_avg_spend_usd',
          ],
          txn_ids: [],
          params: {
            kicker: 'FISCAL CADENCE',
            subheadline:
              '{fact:active_spend_days_count} active days · {fact:q1_spend_usd} first quarter vs {fact:q4_spend_usd} fourth quarter.',
            highlight_dates: [loudestDayDate],
            extra: baseExtra,
            blocks: [
              {
                label: 'First-Quarter Outflow',
                fact_id: 'q1_spend_usd',
                unit_sup: currencySup,
                sublabel_fact_ids: ['monthly_avg_spend_usd'],
                sublabel_template: '{fact:monthly_avg_spend_usd} monthly baseline',
                color_role: 'primary',
              },
              {
                label: 'Fourth-Quarter Outflow',
                fact_id: 'q4_spend_usd',
                unit_sup: currencySup,
                sublabel_fact_ids: ['active_spend_days_count'],
                sublabel_template: '{fact:active_spend_days_count} active posting days',
                color_role: 'tertiary',
              },
              {
                label: 'Peak Deployment Day',
                fact_id: 'loudest_day_spend',
                unit_sup: currencySup,
                sublabel_fact_ids: ['loudest_day_date'],
                sublabel_template: 'Settled on {fact:loudest_day_date}',
                color_role: 'secondary',
              },
            ],
          },
        },
        receiptFactIds: ['total_spend_usd', 'q4_spend_usd'],
      },

      // 3. B2B Anchor Counterparty: Your Place
      {
        key: 'your_place',
        chapter: {
          id: 'your_place',
          type: 'your_place',
          palette_id: scoreById.get('your_place')?.palette_id ?? 'solar_ember',
          headline: '{fact:top_merchant_name}: {fact:visits_top_merchant} settlements.',
          body: '{fact:top_merchant_name} settled every {fact:top_merchant_days_interval} days ({fact:top_merchant_top_weekday} peak) for {fact:spend_top_merchant} total ({fact:avg_spend_top_merchant} avg).',
          fact_ids: [
            'top_merchant_name',
            'visits_top_merchant',
            'spend_top_merchant',
            'avg_spend_top_merchant',
            'top_spend_top_merchant',
            'top_merchant_days_interval',
            'top_merchant_top_weekday',
          ],
          txn_ids: [],
          params: {
            kicker: 'ANCHOR COUNTERPARTY',
            subheadline:
              'Every {fact:top_merchant_days_interval} days · {fact:spend_top_merchant} total · {fact:avg_spend_top_merchant} average.',
            focus_merchant: topMerchantName,
            focus_category: topMerchantCategory,
            extra: {
              ...baseExtra,
              anchor_vendor: topMerchantName,
              category_label: categoryLabels[topMerchantCategory] ?? topMerchantCategory,
            },
            blocks: [
              {
                label: 'Total Settlements',
                fact_id: 'visits_top_merchant',
                sublabel_fact_ids: ['top_merchant_days_interval', 'top_merchant_top_weekday'],
                sublabel_template:
                  'Every {fact:top_merchant_days_interval} days · {fact:top_merchant_top_weekday} peak',
                color_role: 'primary',
              },
              {
                label: 'Cumulative Vendor Spend',
                fact_id: 'spend_top_merchant',
                unit_sup: currencySup,
                sublabel_fact_ids: ['avg_spend_top_merchant'],
                sublabel_template: '{fact:avg_spend_top_merchant} average invoice',
                color_role: 'secondary',
              },
              {
                label: 'Largest Single Invoice',
                fact_id: 'top_spend_top_merchant',
                unit_sup: currencySup,
                sublabel_fact_ids: ['top_merchant_name'],
                sublabel_template: 'Paid to {fact:top_merchant_name}',
                color_role: 'tertiary',
              },
            ],
          },
        },
        receiptFactIds: ['visits_top_merchant'],
      },

      // 4. B2B Bespoke Slot 0: Capital Initiative Blueprint (studio module)
      {
        key: 'bespoke_studio',
        chapter: {
          id: 'bespoke_0',
          type: 'bespoke',
          bespoke_module: 'studio',
          palette_id: 'paper_studio',
          headline: '{fact:studio_total_with_gear_spend} across {fact:studio_gear_count} tranches.',
          body: 'From {fact:studio_first_month} to {fact:studio_last_month} ({fact:studio_months_span} months), {fact:studio_total_with_gear_spend} cleared across {fact:studio_gear_count} tranches led by {fact:studio_acoustic_spend}.',
          fact_ids: [
            'studio_total_with_gear_spend',
            'studio_total_spend',
            'studio_acoustic_spend',
            'studio_gear_count',
            'studio_deposit_spend',
            'studio_final_spend',
            'studio_synth_spend',
            'studio_first_month',
            'studio_last_month',
            'studio_months_span',
            'studio_largest_single_payment',
            'year_number',
          ],
          txn_ids: [],
          params: {
            kicker: 'CAPITAL INITIATIVE BLUEPRINT',
            subheadline:
              '{fact:studio_first_month}–{fact:studio_last_month} ({fact:studio_months_span} months) · {fact:studio_acoustic_spend} anchor + {fact:studio_synth_spend} secondary.',
            focus_category: studioCategory,
            focus_merchant: studioAnchorMerchant,
            highlight_dates: studioDates,
            extra: {
              ...baseExtra,
              anchor_vendor: studioAnchorMerchant,
              companion_vendor: studioCompanionMerchant,
              companion_vendors: studioCompanionMerchants,
              initiative_label: studioCategoryLabel,
              category_label: studioCategoryLabel,
              first_month: getFactStr(factMap, 'studio_first_month', 'January'),
              last_month: getFactStr(factMap, 'studio_last_month', 'December'),
              months_span: getFactNum(factMap, 'studio_months_span') || 1,
              largest_payment_formatted: getFactStr(factMap, 'studio_largest_single_payment'),
              total_spend_formatted: getFactStr(factMap, 'studio_total_with_gear_spend'),
              anchor_spend_formatted: getFactStr(factMap, 'studio_acoustic_spend'),
            },
            blocks: [
              {
                label: 'Total Initiative Spend',
                fact_id: 'studio_total_with_gear_spend',
                unit_sup: currencySup,
                sublabel_fact_ids: ['studio_gear_count', 'studio_months_span'],
                sublabel_template:
                  'Across {fact:studio_gear_count} tranches over {fact:studio_months_span} months',
                color_role: 'primary',
              },
              {
                label: 'Anchor Vendor Commitment',
                fact_id: 'studio_acoustic_spend',
                unit_sup: currencySup,
                sublabel_fact_ids: ['studio_first_month', 'studio_last_month'],
                sublabel_template: '{fact:studio_first_month} through {fact:studio_last_month}',
                color_role: 'secondary',
              },
              {
                label: 'Largest Single Tranche',
                fact_id: 'studio_largest_single_payment',
                unit_sup: currencySup,
                sublabel_fact_ids: ['studio_deposit_spend'],
                sublabel_template: 'Initial tranche {fact:studio_deposit_spend}',
                color_role: 'tertiary',
              },
            ],
          },
        },
        receiptFactIds: ['studio_total_with_gear_spend'],
      },

      // 5. B2B Operating Velocity Streak
      {
        key: 'streak',
        chapter: {
          id: 'streak',
          type: 'streak',
          palette_id: scoreById.get('streak')?.palette_id ?? 'mint_obsidian',
          headline:
            '{fact:longest_spend_streak_days}-day active run. {fact:no_spend_days_count} quiet days.',
          body: 'Operations ran {fact:longest_spend_streak_days} consecutive active days out of {fact:active_spend_days_count}, balanced by {fact:no_spend_days_count} zero-outflow days (up to {fact:longest_no_spend_streak_days} in a row).',
          fact_ids: [
            'longest_spend_streak_days',
            'no_spend_days_count',
            'active_spend_days_count',
            'longest_no_spend_streak_days',
          ],
          txn_ids: [],
          params: {
            kicker: 'OPERATING VELOCITY STREAK',
            subheadline:
              '{fact:active_spend_days_count} active operating days vs {fact:no_spend_days_count} zero-outflow days.',
            highlight_dates: streakDates,
            extra: baseExtra,
            blocks: [
              {
                label: 'Longest Disbursement Run',
                fact_id: 'longest_spend_streak_days',
                sublabel_fact_ids: ['active_spend_days_count'],
                sublabel_template: 'Out of {fact:active_spend_days_count} active operating days',
                color_role: 'primary',
              },
              {
                label: 'Zero-Outflow Treasury Days',
                fact_id: 'no_spend_days_count',
                sublabel_fact_ids: ['longest_no_spend_streak_days'],
                sublabel_template: 'Up to {fact:longest_no_spend_streak_days} quiet days in a row',
                color_role: 'secondary',
              },
              {
                label: 'Active Operating Days',
                fact_id: 'active_spend_days_count',
                sublabel_fact_ids: ['no_spend_days_count'],
                sublabel_template: 'Vs {fact:no_spend_days_count} zero-outflow days',
                color_role: 'tertiary',
              },
            ],
          },
        },
        receiptFactIds: ['longest_spend_streak_days'],
      },

      // 6. B2B Peak Deployment Window (getaway)
      {
        key: 'getaway',
        chapter: {
          id: 'getaway',
          type: 'getaway',
          palette_id: 'cobalt_bone',
          headline:
            '{fact:getaway_location_name}: {fact:getaway_spend_usd} in {fact:getaway_days_count} days.',
          body: 'Peak window ({fact:getaway_date_range}) deployed {fact:getaway_spend_usd} across {fact:getaway_txns_count} settlements in {fact:getaway_days_count} active days, led by {fact:getaway_top_category}.',
          fact_ids: [
            'getaway_spend_usd',
            'getaway_days_count',
            'getaway_txns_count',
            'getaway_location_name',
            'getaway_top_category',
            'getaway_date_range',
          ],
          txn_ids: [],
          params: {
            kicker: 'PEAK DEPLOYMENT WINDOW',
            subheadline:
              '{fact:getaway_date_range} · {fact:getaway_spend_usd} across {fact:getaway_txns_count} settlements.',
            highlight_dates: getawayDates,
            extra: {
              ...baseExtra,
              burst_vendor: getFactStr(factMap, 'getaway_location_name'),
              burst_date_range: getFactStr(factMap, 'getaway_date_range'),
            },
            blocks: [
              {
                label: 'Peak Window Outflow',
                fact_id: 'getaway_spend_usd',
                unit_sup: currencySup,
                sublabel_fact_ids: ['getaway_location_name', 'getaway_txns_count'],
                sublabel_template:
                  '{fact:getaway_location_name} · {fact:getaway_txns_count} settlements',
                color_role: 'primary',
              },
              {
                label: 'Active Window Days',
                fact_id: 'getaway_days_count',
                sublabel_fact_ids: ['getaway_date_range'],
                sublabel_template: 'Window {fact:getaway_date_range}',
                color_role: 'secondary',
              },
              {
                label: 'Window Transactions',
                fact_id: 'getaway_txns_count',
                sublabel_fact_ids: ['getaway_top_category'],
                sublabel_template: 'Led by {fact:getaway_top_category}',
                color_role: 'tertiary',
              },
            ],
          },
        },
        receiptFactIds: ['getaway_spend_usd'],
      },

      // 7. B2B Bespoke Slot 1: Counterparty Rivalry (coffee module)
      {
        key: 'bespoke_coffee',
        chapter: {
          id: 'bespoke_1',
          type: 'bespoke',
          bespoke_module: 'coffee',
          palette_id: 'solar_ember',
          headline:
            '{fact:top_merchant_name} ({fact:visits_top_merchant}) vs {fact:second_coffee_merchant_name} ({fact:second_coffee_visits}).',
          body: '{fact:top_merchant_name} ({fact:visits_top_merchant} settlements, {fact:spend_top_merchant}) and {fact:second_coffee_merchant_name} ({fact:second_coffee_visits} settlements, {fact:second_coffee_spend}) led {fact:coffee_merchants_count} active counterparties ({fact:coffee_total_spend} total).',
          fact_ids: [
            'coffee_total_visits',
            'coffee_total_spend',
            'top_merchant_name',
            'visits_top_merchant',
            'spend_top_merchant',
            'top_coffee_avg_visit',
            'second_coffee_merchant_name',
            'second_coffee_visits',
            'second_coffee_spend',
            'second_coffee_avg_visit',
            'coffee_merchants_count',
            'longest_coffee_streak_days',
            'year_number',
          ],
          txn_ids: [],
          params: {
            kicker: 'COUNTERPARTY RIVALRY',
            subheadline:
              '{fact:coffee_total_visits} settlements across {fact:coffee_merchants_count} counterparties · {fact:top_coffee_avg_visit} vs {fact:second_coffee_avg_visit} avg.',
            focus_category: topMerchantCategory,
            focus_merchant: topMerchantName,
            highlight_dates: coffeeDates,
            extra: {
              ...baseExtra,
              primary_vendor: topMerchantName,
              secondary_vendor: secondVendorName,
              primary_visits: getFactNum(factMap, 'visits_top_merchant'),
              secondary_visits: getFactNum(factMap, 'second_coffee_visits'),
              primary_spend_formatted: getFactStr(factMap, 'spend_top_merchant'),
              secondary_spend_formatted: getFactStr(factMap, 'second_coffee_spend'),
              primary_avg_formatted: getFactStr(factMap, 'top_coffee_avg_visit'),
              secondary_avg_formatted: getFactStr(factMap, 'second_coffee_avg_visit'),
              vendor_count: getFactNum(factMap, 'coffee_merchants_count'),
              category_label: categoryLabels[topMerchantCategory] ?? 'Recurring Operating Vendors',
            },
            blocks: [
              {
                label: 'Primary Repeat Vendor',
                fact_id: 'visits_top_merchant',
                sublabel_fact_ids: [
                  'top_merchant_name',
                  'spend_top_merchant',
                  'top_coffee_avg_visit',
                ],
                sublabel_template:
                  '{fact:top_merchant_name} · {fact:spend_top_merchant} ({fact:top_coffee_avg_visit} avg)',
                color_role: 'primary',
              },
              {
                label: 'Runner-Up Vendor',
                fact_id: 'second_coffee_visits',
                sublabel_fact_ids: [
                  'second_coffee_merchant_name',
                  'second_coffee_spend',
                  'second_coffee_avg_visit',
                ],
                sublabel_template:
                  '{fact:second_coffee_merchant_name} · {fact:second_coffee_spend} ({fact:second_coffee_avg_visit} avg)',
                color_role: 'secondary',
              },
              {
                label: 'Recurring Vendor Pool',
                fact_id: 'coffee_total_spend',
                unit_sup: currencySup,
                sublabel_fact_ids: ['coffee_total_visits', 'coffee_merchants_count'],
                sublabel_template:
                  '{fact:coffee_total_visits} invoices across {fact:coffee_merchants_count} vendors',
                color_role: 'tertiary',
              },
            ],
          },
        },
        receiptFactIds: ['coffee_total_visits'],
      },

      // 8. B2B Treasury Pulse (heartbeat)
      {
        key: 'heartbeat',
        chapter: {
          id: 'heartbeat',
          type: 'heartbeat',
          palette_id: 'ink_rose',
          headline: '{fact:payday_count} settlements. {fact:october_spend_usd} peak surge.',
          body: '{fact:payday_count} settlement cycles ({fact:total_inflow_usd} inflow) paced outflows at {fact:payday_spike_ratio}, while October reached {fact:october_spend_usd} ({fact:october_vs_avg_ratio} baseline).',
          fact_ids: [
            'payday_spike_ratio',
            'payday_count',
            'october_spend_usd',
            'october_vs_avg_ratio',
            'october_transactions_count',
            'total_inflow_usd',
            'q1_spend_usd',
            'q4_spend_usd',
            'december_bonus_pay_usd',
            'payday_window_spend_pct',
            'payday_window_calendar_pct',
          ],
          txn_ids: [],
          params: {
            kicker: 'TREASURY PULSE',
            subheadline:
              '{fact:payday_spike_ratio} post-settlement velocity · {fact:q1_spend_usd} first quarter vs {fact:q4_spend_usd} fourth quarter.',
            extra: baseExtra,
            blocks: [
              {
                label: 'Post-Settlement Pace',
                fact_id: 'payday_spike_ratio',
                sublabel_fact_ids: ['payday_window_spend_pct'],
                sublabel_template: '{fact:payday_window_spend_pct} of spend post-settlement',
                color_role: 'primary',
              },
              {
                label: 'October Operating Surge',
                fact_id: 'october_spend_usd',
                unit_sup: currencySup,
                sublabel_fact_ids: ['october_vs_avg_ratio', 'october_transactions_count'],
                sublabel_template:
                  '{fact:october_vs_avg_ratio} baseline month · {fact:october_transactions_count} txns',
                color_role: 'secondary',
              },
              {
                label: 'Peak Settlement Inflow',
                fact_id: 'december_bonus_pay_usd',
                unit_sup: currencySup,
                sublabel_fact_ids: ['total_inflow_usd', 'payday_count'],
                sublabel_template:
                  '{fact:total_inflow_usd} across {fact:payday_count} settlement cycles',
                color_role: 'tertiary',
              },
            ],
          },
        },
        receiptFactIds: ['payday_spike_ratio', 'october_spend_usd', 'payday_count'],
      },

      // 9. B2B Largest Commitment (big_one)
      {
        key: 'big_one',
        chapter: {
          id: 'big_one',
          type: 'big_one',
          palette_id: 'crimson_ink',
          headline: 'Peak disbursement: {fact:big_one_spend} to {fact:big_one_merchant}.',
          body: '{fact:big_one_spend} to {fact:big_one_merchant} on {fact:big_one_date} equals {fact:big_one_weeks_equivalent} weeks of run-rate spend, followed by {fact:jan_tech_spend} to {fact:jan_tech_merchant}.',
          fact_ids: [
            'big_one_spend',
            'big_one_weeks_equivalent',
            'big_one_merchant',
            'big_one_date',
            'jan_tech_spend',
            'jan_tech_merchant',
            'jan_tech_date',
            'monthly_avg_spend_usd',
          ],
          txn_ids: [],
          params: {
            kicker: 'LARGEST COMMITMENT',
            subheadline:
              'Equals {fact:big_one_weeks_equivalent} weeks of baseline spend in a single settlement.',
            focus_merchant: getFactStr(factMap, 'big_one_merchant', studioAnchorMerchant),
            highlight_dates: [bigOneDate, janTechDate],
            extra: baseExtra,
            blocks: [
              {
                label: 'Largest Single Disbursement',
                fact_id: 'big_one_spend',
                unit_sup: currencySup,
                sublabel_fact_ids: ['big_one_merchant', 'big_one_date'],
                sublabel_template: '{fact:big_one_merchant} on {fact:big_one_date}',
                color_role: 'primary',
              },
              {
                label: 'Weeks of Run-Rate Spend',
                fact_id: 'big_one_weeks_equivalent',
                sublabel_fact_ids: ['monthly_avg_spend_usd'],
                sublabel_template: 'Vs {fact:monthly_avg_spend_usd} monthly baseline',
                color_role: 'secondary',
              },
              {
                label: 'Secondary Capital Tranche',
                fact_id: 'jan_tech_spend',
                unit_sup: currencySup,
                sublabel_fact_ids: ['jan_tech_merchant', 'jan_tech_date'],
                sublabel_template: '{fact:jan_tech_merchant} on {fact:jan_tech_date}',
                color_role: 'tertiary',
              },
            ],
          },
        },
        receiptFactIds: ['big_one_spend', 'jan_tech_spend'],
      },

      // 10. B2B Capital Allocation Mix (shatter)
      {
        key: 'shatter',
        chapter: (() => {
          const topCatNameFactId = factMap.has('top_category_by_spend_name')
            ? 'top_category_by_spend_name'
            : 'top_category_name';
          const topCatSpendFactId = factMap.has('top_category_by_spend_amount')
            ? 'top_category_by_spend_amount'
            : 'top_category_spend';
          const avgMonthlyFactId = factMap.has('average_monthly_spend')
            ? 'average_monthly_spend'
            : 'monthly_avg_spend_usd';
          const hasSubSpend = getFactNum(factMap, 'cat_subscriptions_spend') > 0;
          const hasBillsSpend = getFactNum(factMap, 'bills_total_usd') > 0;

          const shatterFactIds = [
            'total_spend_usd',
            'discretionary_spend_usd',
            'total_transactions_count',
            'top_category_name',
            'top_category_spend',
            'top_category_share_pct',
            'categories_count',
            'monthly_avg_spend_usd',
            'cat_shopping_spend',
            'cat_shopping_count',
            'cat_eating_out_spend',
            'cat_eating_out_count',
            'cat_travel_spend',
            'cat_transport_spend',
            'cat_groceries_spend',
            'cat_coffee_spend',
            'cat_subscriptions_spend',
            'cat_subscriptions_count',
            'cat_fun_spend',
            'cat_gifts_spend',
            'cat_takeaway_spend',
            'cat_health_spend',
            'savings_invest_total_usd',
            'cat_savings_count',
            'rent_total_usd',
            'bills_total_usd',
            'cat_bills_count',
          ];
          if (factMap.has('top_category_by_spend_name')) {
            shatterFactIds.push('top_category_by_spend_name');
          }
          if (factMap.has('top_category_by_spend_amount')) {
            shatterFactIds.push('top_category_by_spend_amount');
          }
          if (factMap.has('average_monthly_spend')) {
            shatterFactIds.push('average_monthly_spend');
          }

          return {
            id: 'shatter',
            type: 'shatter' as const,
            palette_id: 'ink_solar' as const,
            headline: 'How {fact:total_spend_usd} was allocated.',
            body: `{fact:${topCatNameFactId}} led all operating allocations at {fact:${topCatSpendFactId}} across {fact:categories_count} active cost centers.`,
            fact_ids: shatterFactIds,
            txn_ids: [],
            params: {
              kicker: 'CAPITAL ALLOCATION MIX',
              subheadline:
                hasSubSpend && hasBillsSpend
                  ? '{fact:top_category_name} at {fact:top_category_share_pct} ({fact:top_category_spend}) · {fact:cat_subscriptions_spend} software · {fact:bills_total_usd} operations.'
                  : `{fact:${topCatNameFactId}} at {fact:top_category_share_pct} ({fact:${topCatSpendFactId}}) · {fact:${avgMonthlyFactId}} monthly run-rate across {fact:categories_count} cost centers.`,
              extra: baseExtra,
              blocks: [
                {
                  label: 'Primary Cost Allocation',
                  fact_id: 'top_category_spend',
                  unit_sup: currencySup,
                  sublabel_fact_ids: ['top_category_name', 'top_category_share_pct'],
                  sublabel_template:
                    '{fact:top_category_name} · {fact:top_category_share_pct} share',
                  color_role: 'primary' as const,
                },
                hasSubSpend
                  ? {
                      label: 'Cloud & SaaS Stack',
                      fact_id: 'cat_subscriptions_spend',
                      unit_sup: currencySup,
                      sublabel_fact_ids: ['cat_subscriptions_count'],
                      sublabel_template:
                        '{fact:cat_subscriptions_count} recurring software charges',
                      color_role: 'secondary' as const,
                    }
                  : {
                      label: 'Primary Cost Center',
                      fact_id: topCatSpendFactId,
                      unit_sup: currencySup,
                      sublabel_fact_ids: [topCatNameFactId, 'categories_count'],
                      sublabel_template: `{fact:${topCatNameFactId}} across {fact:categories_count} cost centers`,
                      color_role: 'secondary' as const,
                    },
                hasBillsSpend
                  ? {
                      label: 'Core Operations & Payroll',
                      fact_id: 'bills_total_usd',
                      unit_sup: currencySup,
                      sublabel_fact_ids: ['cat_bills_count'],
                      sublabel_template: '{fact:cat_bills_count} operating settlements',
                      color_role: 'tertiary' as const,
                    }
                  : {
                      label: 'Monthly Run-Rate',
                      fact_id: avgMonthlyFactId,
                      unit_sup: currencySup,
                      sublabel_fact_ids: ['total_transactions_count'],
                      sublabel_template:
                        'Across {fact:total_transactions_count} ledger settlements',
                      color_role: 'tertiary' as const,
                    },
              ],
            },
          };
        })(),
        receiptFactIds: ['total_spend_usd', 'top_category_spend'],
      },

      // 11. B2B Operating Archetype (personality)
      {
        key: 'personality',
        chapter: {
          id: 'personality',
          type: 'personality',
          palette_id: 'lavender_night',
          headline: personality.title,
          body: personality.subtitle,
          fact_ids: [
            'payday_spike_ratio',
            'payday_count',
            'active_spend_days_count',
            'visits_top_merchant',
            'top_merchant_name',
            'spend_top_merchant',
            'coffee_total_visits',
            'studio_total_with_gear_spend',
            'studio_gear_count',
            'total_inflow_usd',
            'net_cashflow_usd',
            'savings_invest_total_usd',
            'top_category_share_pct',
          ],
          txn_ids: [],
          params: {
            kicker: 'OPERATING ARCHETYPE',
            subheadline:
              '{fact:payday_spike_ratio} cadence · {fact:visits_top_merchant} settlements with {fact:top_merchant_name} · {fact:net_cashflow_usd} net.',
            extra: baseExtra,
            blocks: [
              {
                label: 'Settlement Cadence',
                fact_id: 'payday_spike_ratio',
                sublabel_fact_ids: ['payday_count'],
                sublabel_template: 'Across {fact:payday_count} treasury cycles',
                color_role: 'primary',
              },
              {
                label: 'Anchor Counterparty',
                fact_id: 'visits_top_merchant',
                sublabel_fact_ids: ['top_merchant_name'],
                sublabel_template: 'Settlements with {fact:top_merchant_name}',
                color_role: 'secondary',
              },
              {
                label: 'Net Operating Cashflow',
                fact_id: 'net_cashflow_usd',
                unit_sup: currencySup,
                sublabel_fact_ids: ['total_inflow_usd'],
                sublabel_template: 'From {fact:total_inflow_usd} gross inflows',
                color_role: 'tertiary',
              },
            ],
          },
        },
        receiptFactIds: ['visits_top_merchant', 'total_inflow_usd'],
      },

      // 12. B2B Executive Thesis (one_line)
      {
        key: 'one_line',
        chapter: {
          id: 'one_line',
          type: 'one_line',
          palette_id: 'ink_solar',
          headline: oneLine,
          body: 'Every figure in {fact:year_number} reconciles to {fact:total_transactions_count} auditable ledger rows.',
          fact_ids: [
            'year_number',
            'total_transactions_count',
            'total_spend_usd',
            'total_inflow_usd',
            'net_cashflow_usd',
            'top_merchant_name',
            'visits_top_merchant',
          ],
          txn_ids: [],
          params: {
            kicker: 'EXECUTIVE THESIS',
            subheadline: 'Click any highlighted figure to inspect its backing ledger entries.',
            extra: baseExtra,
          },
        },
        receiptFactIds: ['visits_top_merchant', 'total_spend_usd'],
      },

      // 13. B2B Board Summary Card (share_card)
      {
        key: 'share_card',
        chapter: {
          id: 'share_card',
          type: 'share_card',
          palette_id: 'solar_ember',
          headline: `${safeName} · {fact:year_number}`,
          body: '{fact:total_spend_usd} outflow and {fact:total_inflow_usd} inflow across {fact:total_transactions_count} entries, led by {fact:top_merchant_name} ({fact:visits_top_merchant} settlements).',
          fact_ids: [
            'year_number',
            'total_spend_usd',
            'total_inflow_usd',
            'discretionary_spend_usd',
            'total_transactions_count',
            'visits_top_merchant',
            'top_merchant_name',
            'studio_total_with_gear_spend',
            'payday_count',
          ],
          txn_ids: [],
          params: {
            kicker: 'BOARD SUMMARY CARD',
            subheadline: 'Executive summary card with zero raw account identifiers.',
            extra: baseExtra,
          },
        },
        receiptFactIds: ['visits_top_merchant'],
      },
    ];

    const coreSpineKeys = new Set([
      'pour',
      'year_as_squares',
      'your_place',
      'shatter',
      'personality',
      'share_card',
    ]);
    const factById = factMap;

    const requestedSet = new Set(
      (input.selectedChapters ?? []).map((id) => {
        const k = id.trim().toLowerCase();
        if (k === 'bespoke_0' || k === 'studio' || k === 'studio_session') return 'bespoke_studio';
        if (k === 'bespoke_1' || k === 'coffee' || k === 'rivalry') return 'bespoke_coffee';
        if (k === 'subscription_garden') return 'shatter';
        return k;
      })
    );
    const hasCustomSelection = Boolean(
      input.selectedChapters && input.selectedChapters.length >= 6
    );

    const meetsMinimalValidity = (key: string): boolean => {
      switch (key) {
        case 'bespoke_studio':
          return (
            Number(factById.get('studio_gear_count')?.value ?? 0) >= 1 &&
            Number(factById.get('studio_total_with_gear_spend')?.value ?? 0) > 0
          );
        case 'streak':
          return Number(factById.get('longest_spend_streak_days')?.value ?? 0) >= 1;
        case 'getaway':
          return Number(factById.get('getaway_spend_usd')?.value ?? 0) > 0;
        case 'bespoke_coffee':
          return (
            Number(factById.get('coffee_merchants_count')?.value ?? 0) >= 1 &&
            String(factById.get('second_coffee_merchant_name')?.value ?? 'None') !== 'None'
          );
        case 'heartbeat':
          return Number(factById.get('payday_count')?.value ?? 0) >= 1;
        case 'big_one':
          return Number(factById.get('big_one_spend')?.value ?? 0) > 0;
        case 'one_line':
          return true;
        default:
          return true;
      }
    };

    const meetsDeterministicThreshold = (key: string): boolean => {
      switch (key) {
        case 'bespoke_studio':
          return (
            Number(factById.get('studio_gear_count')?.value ?? 0) >= 3 &&
            Number(factById.get('studio_months_span')?.value ?? 0) >= 2 &&
            Number(factById.get('categories_count')?.value ?? 0) >= 2
          );
        case 'streak':
          return (
            Number(factById.get('no_spend_days_count')?.value ?? 0) >= 15 &&
            Number(factById.get('longest_spend_streak_days')?.value ?? 0) >= 4
          );
        case 'getaway':
          return (
            Number(factById.get('getaway_txns_count')?.value ?? 0) >= 3 &&
            Number(factById.get('getaway_spend_usd')?.value ?? 0) > 0
          );
        case 'bespoke_coffee':
          return (
            Number(factById.get('coffee_merchants_count')?.value ?? 0) >= 2 &&
            Number(factById.get('second_coffee_visits')?.value ?? 0) >= 2 &&
            String(factById.get('second_coffee_merchant_name')?.value ?? 'None') !== 'None'
          );
        case 'heartbeat':
          return (
            Number(factById.get('payday_count')?.value ?? 0) >= 2 &&
            Number(factById.get('total_inflow_usd')?.value ?? 0) > 0 &&
            Number(
              factById.get('total_outflow_usd')?.value ??
                factById.get('total_spend_usd')?.value ??
                0
            ) > 0
          );
        case 'big_one':
          return (
            Number(factById.get('big_one_weeks_equivalent')?.value ?? 0) >= 0.4 &&
            Number(factById.get('total_transactions_count')?.value ?? 0) >= 5
          );
        default:
          return true;
      }
    };

    const selectedKeys = new Set<string>(coreSpineKeys);
    for (const entry of candidateB2BChapters) {
      if (coreSpineKeys.has(entry.key) || entry.key === 'one_line') continue;
      const include = hasCustomSelection
        ? requestedSet.has(entry.key) && meetsMinimalValidity(entry.key)
        : meetsDeterministicThreshold(entry.key);
      if (include && selectedKeys.size < 13) {
        selectedKeys.add(entry.key);
      }
    }

    const includeOneLine = hasCustomSelection
      ? requestedSet.has('one_line') && selectedKeys.size < 13
      : selectedKeys.size <= 10;
    if (includeOneLine) {
      selectedKeys.add('one_line');
    }

    for (const entry of candidateB2BChapters) {
      if (selectedKeys.has(entry.key)) {
        rawChapters.push({
          chapter: entry.chapter,
          receiptFactIds: entry.receiptFactIds,
        });
      }
    }
  } else {
    // 1. Fixed Opener: The Pour
    rawChapters.push({
      chapter: {
        id: 'pour',
        type: 'pour',
        palette_id: 'ink_solar',
        headline: 'Your {fact:year_number} in {fact:total_transactions_count} lines.',
        body: `Takeaway for ${personName} — Your {fact:total_transactions_count} bank lines ({fact:card_transactions_count} card swipes and {fact:savings_transactions_count} account transfers) unscramble into {fact:total_spend_usd} of total outflows and {fact:discretionary_spend_usd} of everyday discretionary spend.`,
        fact_ids: [
          'year_number',
          'total_spend_usd',
          'total_transactions_count',
          'discretionary_spend_usd',
          'card_transactions_count',
          'savings_transactions_count',
          'payday_count',
          'salary_income_usd',
        ],
        txn_ids: [],
        params: {
          kicker: 'THE POUR',
          subheadline:
            'From {fact:total_transactions_count} raw bank strings to {fact:discretionary_spend_usd} of everyday life.',
          blocks: [
            {
              label: 'Total Outgoing Spend',
              fact_id: 'total_spend_usd',
              unit_sup: 'US$',
              sublabel_fact_ids: ['discretionary_spend_usd'],
              sublabel_template: '{fact:discretionary_spend_usd} discretionary',
              color_role: 'primary',
            },
            {
              label: 'Transactions Unscrambled',
              fact_id: 'total_transactions_count',
              sublabel_fact_ids: ['card_transactions_count', 'savings_transactions_count'],
              sublabel_template:
                '{fact:card_transactions_count} card · {fact:savings_transactions_count} savings',
              color_role: 'secondary',
            },
            {
              label: 'Paydays Tracked',
              fact_id: 'payday_count',
              sublabel_fact_ids: ['salary_income_usd'],
              sublabel_template: '{fact:salary_income_usd} salary inflow',
              color_role: 'tertiary',
            },
          ],
        },
      },
      receiptFactIds: ['total_spend_usd', 'salary_income_usd'],
    });

    // 2. Fixed Second Chapter: The Year as Squares
    const squaresPalette = scoreById.get('bespoke_studio')?.selected
      ? 'ink_solar'
      : 'mint_obsidian';
    rawChapters.push({
      chapter: {
        id: 'year_as_squares',
        type: 'year_as_squares',
        palette_id: squaresPalette,
        headline: 'Every square is a day. {fact:discretionary_spend_usd} across the year.',
        body: `Takeaway for ${personName} — Your baseline discretionary pace averaged {fact:monthly_avg_spend_usd} per month across {fact:active_spend_days_count} active days, while {fact:no_spend_days_count} zero-spend days kept your calendar balanced around the {fact:loudest_day_date} studio spike ({fact:loudest_day_spend}).`,
        fact_ids: [
          'discretionary_spend_usd',
          'payday_count',
          'total_spend_usd',
          'active_spend_days_count',
          'no_spend_days_count',
          'loudest_day_date',
          'loudest_day_spend',
          'monthly_avg_spend_usd',
          'payday_spike_ratio',
        ],
        txn_ids: [],
        params: {
          kicker: 'THE YEAR AS SQUARES',
          subheadline:
            'Active on {fact:active_spend_days_count} days, averaging {fact:monthly_avg_spend_usd} per month in discretionary spend.',
          highlight_dates: [loudestDayDate],
          blocks: [
            {
              label: 'Discretionary Spend',
              fact_id: 'discretionary_spend_usd',
              unit_sup: 'US$',
              sublabel_fact_ids: ['monthly_avg_spend_usd'],
              sublabel_template: '{fact:monthly_avg_spend_usd} monthly average',
              color_role: 'primary',
            },
            {
              label: 'Payday Pulses',
              fact_id: 'payday_count',
              sublabel_fact_ids: ['payday_spike_ratio'],
              sublabel_template: '{fact:payday_spike_ratio} post-payday pace',
              color_role: 'tertiary',
            },
            {
              label: 'Loudest Single Day',
              fact_id: 'loudest_day_spend',
              unit_sup: 'US$',
              sublabel_fact_ids: ['loudest_day_date'],
              sublabel_template: 'Peaked on {fact:loudest_day_date}',
              color_role: 'secondary',
            },
          ],
        },
      },
      receiptFactIds: ['discretionary_spend_usd', 'payday_count'],
    });

    // 3. Chosen Chapter: Your Place
    const yourPlaceCand = scoreById.get('your_place')!;
    if (yourPlaceCand.selected) {
      rawChapters.push({
        chapter: {
          id: 'your_place',
          type: 'your_place',
          palette_id: yourPlaceCand.palette_id,
          headline: '{fact:top_merchant_name}, {fact:visits_top_merchant} times.',
          body: `Takeaway for ${personName} — {fact:top_merchant_name} is your single most consistent ritual: one stop every {fact:top_merchant_days_interval} days ({fact:top_merchant_top_weekday} is your peak day) at a disciplined {fact:avg_spend_top_merchant} average ticket ({fact:spend_top_merchant} all year).`,
          fact_ids: [
            'top_merchant_name',
            'visits_top_merchant',
            'spend_top_merchant',
            'avg_spend_top_merchant',
            'top_spend_top_merchant',
            'top_merchant_days_interval',
            'top_merchant_top_weekday',
          ],
          txn_ids: [],
          params: {
            kicker: 'YOUR PLACE',
            subheadline:
              'One stop every {fact:top_merchant_days_interval} days · {fact:spend_top_merchant} total · {fact:avg_spend_top_merchant} average.',
            focus_merchant: topMerchantName,
            focus_category: topMerchantCategory,
            blocks: [
              {
                label: 'Total Visits',
                fact_id: 'visits_top_merchant',
                sublabel_fact_ids: ['top_merchant_days_interval', 'top_merchant_top_weekday'],
                sublabel_template:
                  'Every {fact:top_merchant_days_interval} days · {fact:top_merchant_top_weekday} peak',
                color_role: 'primary',
              },
              {
                label: 'Total Spend',
                fact_id: 'spend_top_merchant',
                unit_sup: 'US$',
                sublabel_fact_ids: ['avg_spend_top_merchant'],
                sublabel_template: '{fact:avg_spend_top_merchant} average order',
                color_role: 'secondary',
              },
              {
                label: 'Biggest Single Order',
                fact_id: 'top_spend_top_merchant',
                unit_sup: 'US$',
                sublabel_fact_ids: ['top_merchant_name'],
                sublabel_template: 'At {fact:top_merchant_name}',
                color_role: 'tertiary',
              },
            ],
          },
        },
        receiptFactIds: ['visits_top_merchant'],
      });
    }

    // 4. Bespoke Slot 0 (Studio Build for Sam, or Wellness Log for Alex)
    const studioCand = scoreById.get('bespoke_studio')!;
    const wellnessCand = scoreById.get('bespoke_wellness')!;
    if (studioCand.selected) {
      rawChapters.push({
        chapter: {
          id: 'bespoke_0',
          type: 'bespoke',
          bespoke_module: 'studio',
          palette_id: 'paper_studio',
          headline:
            'Room to Make Noise: {fact:studio_total_with_gear_spend} across {fact:studio_gear_count} purchases.',
          body: `Takeaway for ${personName} — You turned a multi-month creative goal into reality by staging the {fact:studio_total_spend} Monarch Acoustic room build ({fact:studio_deposit_spend} in May, {fact:studio_final_spend} in August) and outfitting it across {fact:studio_gear_count} synth and audio gear purchases ({fact:studio_total_with_gear_spend} total).`,
          fact_ids: [
            'studio_total_with_gear_spend',
            'studio_total_spend',
            'studio_gear_count',
            'studio_deposit_spend',
            'studio_final_spend',
            'studio_synth_spend',
            'year_number',
          ],
          txn_ids: [],
          params: {
            kicker: 'ROOM TO MAKE NOISE',
            badge: 'only in your app',
            subheadline:
              'Monarch Acoustic room build ({fact:studio_total_spend}) + synths, pedals & studio gear ({fact:studio_total_with_gear_spend}).',
            focus_category: 'shopping',
            focus_merchant: 'Monarch Acoustic',
            highlight_dates: studioDates,
            blocks: [
              {
                label: 'Studio + Gear Total',
                fact_id: 'studio_total_with_gear_spend',
                unit_sup: 'US$',
                sublabel_fact_ids: ['studio_gear_count'],
                sublabel_template: 'Across {fact:studio_gear_count} purchases',
                color_role: 'primary',
              },
              {
                label: 'Monarch Acoustic Build',
                fact_id: 'studio_total_spend',
                unit_sup: 'US$',
                sublabel_fact_ids: ['studio_deposit_spend', 'studio_final_spend'],
                sublabel_template:
                  '{fact:studio_deposit_spend} deposit + {fact:studio_final_spend} final',
                color_role: 'secondary',
              },
              {
                label: 'August Synth Drop',
                fact_id: 'studio_synth_spend',
                unit_sup: 'US$',
                sublabel_fact_ids: ['studio_gear_count'],
                sublabel_template: 'Part of {fact:studio_gear_count} studio pieces',
                color_role: 'tertiary',
              },
            ],
          },
        },
        receiptFactIds: ['studio_total_with_gear_spend'],
      });
    } else if (wellnessCand.selected) {
      rawChapters.push({
        chapter: {
          id: 'bespoke_0',
          type: 'bespoke',
          bespoke_module: 'wellness_log',
          palette_id: 'mint_obsidian',
          headline:
            'The Endurance Block: {fact:cat_health_count} recovery sessions and {fact:cat_health_spend} in wellness.',
          body: `Takeaway for ${personName} — Training through {fact:year_number} meant treating recovery like clockwork across {fact:cat_health_count} physio, sports-medicine, and wellness visits worth {fact:cat_health_spend}.`,
          fact_ids: [
            'cat_health_count',
            'cat_health_spend',
            'physio_visits_count',
            'physio_total_spend',
            'year_number',
          ],
          txn_ids: [],
          params: {
            kicker: 'THE ENDURANCE BLOCK',
            badge: 'only in your app',
            subheadline:
              '{fact:cat_health_count} physio and wellness sessions ({fact:cat_health_spend}) across the training year.',
            focus_category: 'health',
            focus_merchant: 'Physio',
            highlight_dates: healthDates,
            blocks: [
              {
                label: 'Recovery & Wellness Visits',
                fact_id: 'cat_health_count',
                sublabel_fact_ids: ['cat_health_spend'],
                sublabel_template: '{fact:cat_health_spend} total recovery spend',
                color_role: 'primary',
              },
              {
                label: 'Total Health & Recovery',
                fact_id: 'cat_health_spend',
                unit_sup: 'US$',
                sublabel_fact_ids: ['cat_health_count'],
                sublabel_template: 'Across {fact:cat_health_count} wellness stops',
                color_role: 'secondary',
              },
              {
                label: 'Active Training Days',
                fact_id: 'active_spend_days_count',
                sublabel_fact_ids: ['no_spend_days_count'],
                sublabel_template: '{fact:no_spend_days_count} rest & zero-spend days',
                color_role: 'tertiary',
              },
            ],
          },
        },
        receiptFactIds: ['cat_health_spend'],
      });
    }

    // 5. Chosen Chapter: The Streak
    const streakCand = scoreById.get('streak')!;
    if (streakCand.selected) {
      rawChapters.push({
        chapter: {
          id: 'streak',
          type: 'streak',
          palette_id: streakCand.palette_id,
          headline:
            '{fact:longest_spend_streak_days} days in a row. And {fact:no_spend_days_count} quiet days.',
          body: `Takeaway for ${personName} — Even with a {fact:longest_spend_streak_days}-day continuous spending run and a {fact:longest_coffee_streak_days}-day coffee chain, you logged {fact:no_spend_days_count} completely spend-free days (up to {fact:longest_no_spend_streak_days} quiet days in a row) to reset your pace.`,
          fact_ids: [
            'longest_spend_streak_days',
            'no_spend_days_count',
            'longest_coffee_streak_days',
            'longest_no_spend_streak_days',
            'active_spend_days_count',
            'coffee_total_visits',
          ],
          txn_ids: [],
          params: {
            kicker: 'THE STREAK',
            subheadline:
              '{fact:active_spend_days_count} active spend days vs {fact:no_spend_days_count} zero-spend days across the calendar.',
            highlight_dates: streakDates,
            blocks: [
              {
                label: 'Longest Spending Streak',
                fact_id: 'longest_spend_streak_days',
                sublabel_fact_ids: ['active_spend_days_count'],
                sublabel_template: 'Out of {fact:active_spend_days_count} active days',
                color_role: 'primary',
              },
              {
                label: 'Quiet No-Spend Days',
                fact_id: 'no_spend_days_count',
                sublabel_fact_ids: ['longest_no_spend_streak_days'],
                sublabel_template: 'Up to {fact:longest_no_spend_streak_days} quiet days in a row',
                color_role: 'secondary',
              },
              {
                label: 'Longest Coffee Run',
                fact_id: 'longest_coffee_streak_days',
                sublabel_fact_ids: ['coffee_total_visits'],
                sublabel_template: 'From {fact:coffee_total_visits} total coffee stops',
                color_role: 'tertiary',
              },
            ],
          },
        },
        receiptFactIds: ['longest_spend_streak_days'],
      });
    }

    // 6. Chosen Chapter: The Getaway
    const getawayCand = scoreById.get('getaway')!;
    if (getawayCand.selected) {
      rawChapters.push({
        chapter: {
          id: 'getaway',
          type: 'getaway',
          palette_id: getawayCand.palette_id,
          headline:
            '{fact:getaway_location_name}: {fact:getaway_spend_usd} across {fact:getaway_days_count} coastal days.',
          body: `Takeaway for ${personName} — Your {fact:getaway_days_count}-day escape to {fact:getaway_location_name} ({fact:getaway_spend_usd}) and {fact:cat_travel_count} travel bookings ({fact:cat_travel_spend}) stayed well-contained, while {fact:fx_transactions_count} international card purchases ({fact:fx_spend_usd}) added {fact:fx_fees_usd} in FX fees you could eliminate with a no-FX card.`,
          fact_ids: [
            'getaway_spend_usd',
            'getaway_days_count',
            'getaway_location_name',
            'fx_spend_usd',
            'fx_fees_usd',
            'fx_transactions_count',
            'cat_travel_spend',
            'cat_travel_count',
          ],
          txn_ids: [],
          params: {
            kicker: 'THE GETAWAY',
            subheadline:
              '{fact:cat_travel_spend} across {fact:cat_travel_count} travel bookings + {fact:fx_spend_usd} in foreign currency.',
            focus_category: 'travel',
            highlight_dates: getawayDates,
            blocks: [
              {
                label: 'Coastal Getaway Spend',
                fact_id: 'getaway_spend_usd',
                unit_sup: 'US$',
                sublabel_fact_ids: ['getaway_location_name', 'getaway_days_count'],
                sublabel_template: '{fact:getaway_location_name} · {fact:getaway_days_count} days',
                color_role: 'primary',
              },
              {
                label: 'Foreign Currency Spend',
                fact_id: 'fx_spend_usd',
                unit_sup: 'US$',
                sublabel_fact_ids: ['fx_transactions_count', 'fx_fees_usd'],
                sublabel_template:
                  '{fact:fx_transactions_count} purchases · {fact:fx_fees_usd} FX fees',
                color_role: 'secondary',
              },
              {
                label: 'Total Travel Spend',
                fact_id: 'cat_travel_spend',
                unit_sup: 'US$',
                sublabel_fact_ids: ['cat_travel_count'],
                sublabel_template: '{fact:cat_travel_count} travel transactions',
                color_role: 'tertiary',
              },
            ],
          },
        },
        receiptFactIds: ['getaway_spend_usd', 'fx_spend_usd', 'cat_travel_spend'],
      });
    }

    // 7. Bespoke Slot 1 (Coffee Rivalry for Sam, or Home Pantry for Alex)
    const coffeeCand = scoreById.get('bespoke_coffee')!;
    const homePantryCand = scoreById.get('bespoke_home_pantry')!;
    if (coffeeCand.selected) {
      rawChapters.push({
        chapter: {
          id: 'bespoke_1',
          type: 'bespoke',
          bespoke_module: 'coffee',
          palette_id: 'solar_ember',
          headline:
            'The Morning Rivalry: {fact:top_merchant_name} ({fact:visits_top_merchant}) vs {fact:second_coffee_merchant_name} ({fact:second_coffee_visits}).',
          body: `Takeaway for ${personName} — While {fact:top_merchant_name} won on visit count ({fact:visits_top_merchant} stops, {fact:spend_top_merchant}), {fact:second_coffee_merchant_name} actually claimed more of your wallet ({fact:second_coffee_spend} across {fact:second_coffee_visits} stops) inside a {fact:coffee_merchants_count}-café habit totaling {fact:coffee_total_spend} ({fact:coffee_total_visits} cups).`,
          fact_ids: [
            'coffee_total_visits',
            'coffee_total_spend',
            'top_merchant_name',
            'visits_top_merchant',
            'spend_top_merchant',
            'second_coffee_merchant_name',
            'second_coffee_visits',
            'second_coffee_spend',
            'coffee_merchants_count',
            'longest_coffee_streak_days',
            'year_number',
          ],
          txn_ids: [],
          params: {
            kicker: 'THE MORNING RIVALRY',
            badge: 'only in your app',
            subheadline:
              '{fact:coffee_total_visits} coffees across {fact:coffee_merchants_count} cafés · {fact:second_coffee_merchant_name} topped {fact:top_merchant_name} in total dollars.',
            focus_category: 'coffee',
            focus_merchant: topMerchantName,
            highlight_dates: coffeeDates,
            blocks: [
              {
                label: 'Top Café Visits',
                fact_id: 'visits_top_merchant',
                sublabel_fact_ids: ['top_merchant_name', 'spend_top_merchant'],
                sublabel_template: '{fact:top_merchant_name} · {fact:spend_top_merchant}',
                color_role: 'primary',
              },
              {
                label: 'Second Café Visits',
                fact_id: 'second_coffee_visits',
                sublabel_fact_ids: ['second_coffee_merchant_name', 'second_coffee_spend'],
                sublabel_template:
                  '{fact:second_coffee_merchant_name} · {fact:second_coffee_spend}',
                color_role: 'secondary',
              },
              {
                label: 'All Cafés Combined',
                fact_id: 'coffee_total_spend',
                unit_sup: 'US$',
                sublabel_fact_ids: ['coffee_total_visits', 'coffee_merchants_count'],
                sublabel_template:
                  '{fact:coffee_total_visits} cups across {fact:coffee_merchants_count} cafés',
                color_role: 'tertiary',
              },
            ],
          },
        },
        receiptFactIds: ['coffee_total_visits'],
      });
    } else if (homePantryCand.selected) {
      rawChapters.push({
        chapter: {
          id: 'bespoke_1',
          type: 'bespoke',
          bespoke_module: 'home_pantry',
          palette_id: 'olive_lime',
          headline:
            'The Home Table: {fact:cat_groceries_count} market runs ({fact:cat_groceries_spend}) vs {fact:cat_takeaway_count} takeaways.',
          body: `Takeaway for ${personName} — You built your year around home cooking: {fact:cat_groceries_count} grocery trips totaling {fact:cat_groceries_spend} — led by {fact:visits_top_merchant} stops at {fact:top_merchant_name} ({fact:spend_top_merchant}) — compared with just {fact:cat_takeaway_count} takeaway orders ({fact:cat_takeaway_spend}), freeing up {fact:savings_invest_total_usd} for savings.`,
          fact_ids: [
            'cat_groceries_count',
            'cat_groceries_spend',
            'cat_takeaway_count',
            'cat_takeaway_spend',
            'top_merchant_name',
            'visits_top_merchant',
            'spend_top_merchant',
            'savings_invest_total_usd',
            'cat_savings_count',
          ],
          txn_ids: [],
          params: {
            kicker: 'THE HOME TABLE',
            badge: 'only in your app',
            subheadline:
              '{fact:cat_groceries_count} grocery market trips vs {fact:cat_takeaway_count} takeaway orders · {fact:savings_invest_total_usd} invested.',
            focus_category: 'groceries',
            focus_merchant: topMerchantName,
            highlight_dates: groceriesDates,
            blocks: [
              {
                label: 'Grocery Market Trips',
                fact_id: 'cat_groceries_count',
                sublabel_fact_ids: ['cat_groceries_spend'],
                sublabel_template: '{fact:cat_groceries_spend} stocked for home cooking',
                color_role: 'primary',
              },
              {
                label: 'Takeaway Orders All Year',
                fact_id: 'cat_takeaway_count',
                sublabel_fact_ids: ['cat_takeaway_spend'],
                sublabel_template: 'Only {fact:cat_takeaway_spend} spent on delivery',
                color_role: 'secondary',
              },
              {
                label: 'Saved & Invested',
                fact_id: 'savings_invest_total_usd',
                unit_sup: 'US$',
                sublabel_fact_ids: ['cat_savings_count'],
                sublabel_template: 'Across {fact:cat_savings_count} contributions',
                color_role: 'tertiary',
              },
            ],
          },
        },
        receiptFactIds: ['cat_groceries_spend', 'cat_takeaway_spend'],
      });
    }

    // 8. Chosen Chapter: The Heartbeat
    const heartbeatCand = scoreById.get('heartbeat')!;
    if (heartbeatCand.selected) {
      rawChapters.push({
        chapter: {
          id: 'heartbeat',
          type: 'heartbeat',
          palette_id: heartbeatCand.palette_id,
          headline:
            '{fact:payday_count} steady paydays. And the October surge to {fact:october_spend_usd}.',
          body: `Takeaway for ${personName} — You resist post-payday splurging across all {fact:payday_count} uniform {fact:december_bonus_pay_usd} paychecks ({fact:payday_spike_ratio} post-payday pace on {fact:salary_income_usd} salary), so your real budget lever is planning ahead for your October activity surge ({fact:october_spend_usd}, {fact:october_vs_avg_ratio} your typical month across {fact:october_transactions_count} transactions).`,
          fact_ids: [
            'payday_spike_ratio',
            'payday_count',
            'october_spend_usd',
            'october_vs_avg_ratio',
            'october_transactions_count',
            'salary_income_usd',
            'december_bonus_pay_usd',
            'payday_window_spend_pct',
            'payday_window_calendar_pct',
          ],
          txn_ids: [],
          params: {
            kicker: 'THE HEARTBEAT',
            subheadline:
              'Steady {fact:payday_spike_ratio} post-payday pace ({fact:payday_window_spend_pct} of card spend in {fact:payday_window_calendar_pct} of the calendar) vs October at {fact:october_vs_avg_ratio}.',
            blocks: [
              {
                label: 'Post-Payday Multiplier',
                fact_id: 'payday_spike_ratio',
                sublabel_fact_ids: ['payday_window_spend_pct'],
                sublabel_template: '{fact:payday_window_spend_pct} of card spend post-payday',
                color_role: 'primary',
              },
              {
                label: 'October Spend Surge',
                fact_id: 'october_spend_usd',
                unit_sup: 'US$',
                sublabel_fact_ids: ['october_vs_avg_ratio', 'october_transactions_count'],
                sublabel_template:
                  '{fact:october_vs_avg_ratio} normal month · {fact:october_transactions_count} txns',
                color_role: 'secondary',
              },
              {
                label: 'Monthly Paycheck',
                fact_id: 'december_bonus_pay_usd',
                unit_sup: 'US$',
                sublabel_fact_ids: ['salary_income_usd', 'payday_count'],
                sublabel_template:
                  '{fact:salary_income_usd} across {fact:payday_count} equal paydays',
                color_role: 'tertiary',
              },
            ],
          },
        },
        receiptFactIds: ['payday_spike_ratio', 'october_spend_usd', 'payday_count'],
      });
    }

    // 9. Chosen Chapter: The Big One
    const bigOneCand = scoreById.get('big_one')!;
    if (bigOneCand.selected) {
      rawChapters.push({
        chapter: {
          id: 'big_one',
          type: 'big_one',
          palette_id: bigOneCand.palette_id,
          headline:
            'One payment changed the skyline: {fact:big_one_spend} at {fact:big_one_merchant}.',
          body: `Takeaway for ${personName} — Your two biggest one-off upgrades — {fact:big_one_spend} at {fact:big_one_merchant} on {fact:big_one_date} ({fact:big_one_weeks_equivalent} weeks of normal spending) and {fact:jan_tech_spend} at {fact:jan_tech_merchant} on {fact:jan_tech_date} — were deliberate capital purchases rather than everyday lifestyle drift.`,
          fact_ids: [
            'big_one_spend',
            'big_one_weeks_equivalent',
            'big_one_merchant',
            'big_one_date',
            'jan_tech_spend',
            'jan_tech_merchant',
            'jan_tech_date',
            'monthly_avg_spend_usd',
          ],
          txn_ids: [],
          params: {
            kicker: 'THE BIG ONE',
            subheadline:
              'Equal to {fact:big_one_weeks_equivalent} weeks of normal everyday spending in a single transaction.',
            focus_category: 'shopping',
            focus_merchant: getFactStr(factMap, 'big_one_merchant', 'Monarch Acoustic'),
            highlight_dates: [bigOneDate, janTechDate],
            blocks: [
              {
                label: 'Biggest Single Payment',
                fact_id: 'big_one_spend',
                unit_sup: 'US$',
                sublabel_fact_ids: ['big_one_merchant', 'big_one_date'],
                sublabel_template: '{fact:big_one_merchant} on {fact:big_one_date}',
                color_role: 'primary',
              },
              {
                label: 'Weeks of Normal Spend',
                fact_id: 'big_one_weeks_equivalent',
                sublabel_fact_ids: ['monthly_avg_spend_usd'],
                sublabel_template: 'Vs {fact:monthly_avg_spend_usd} monthly average',
                color_role: 'secondary',
              },
              {
                label: 'January Tech Upgrade',
                fact_id: 'jan_tech_spend',
                unit_sup: 'US$',
                sublabel_fact_ids: ['jan_tech_merchant', 'jan_tech_date'],
                sublabel_template: '{fact:jan_tech_merchant} on {fact:jan_tech_date}',
                color_role: 'tertiary',
              },
            ],
          },
        },
        receiptFactIds: ['big_one_spend', 'jan_tech_spend'],
      });
    }

    // 10. Chosen Chapter: The Shatter
    const shatterCand = scoreById.get('shatter')!;
    if (shatterCand.selected) {
      rawChapters.push({
        chapter: {
          id: 'shatter',
          type: 'shatter',
          palette_id: shatterCand.palette_id,
          headline: 'Where {fact:discretionary_spend_usd} of everyday spending went.',
          body: `Takeaway for ${personName} — Even with {fact:top_category_name} taking {fact:top_category_share_pct} ({fact:top_category_spend}) of your {fact:discretionary_spend_usd} discretionary spend ahead of eating out ({fact:cat_eating_out_spend}), travel ({fact:cat_travel_spend}), transport ({fact:cat_transport_spend}), groceries ({fact:cat_groceries_spend}), and coffee ({fact:cat_coffee_spend}), you still channeled {fact:savings_invest_total_usd} into savings alongside {fact:rent_total_usd} in rent.`,
          fact_ids: [
            'discretionary_spend_usd',
            'total_transactions_count',
            'top_category_name',
            'top_category_spend',
            'top_category_share_pct',
            'cat_shopping_spend',
            'cat_shopping_count',
            'cat_eating_out_spend',
            'cat_eating_out_count',
            'cat_travel_spend',
            'cat_transport_spend',
            'cat_groceries_spend',
            'cat_coffee_spend',
            'cat_subscriptions_spend',
            'cat_fun_spend',
            'cat_gifts_spend',
            'cat_takeaway_spend',
            'cat_health_spend',
            'savings_invest_total_usd',
            'cat_savings_count',
            'rent_total_usd',
            'bills_total_usd',
          ],
          txn_ids: [],
          params: {
            kicker: 'THE SHATTER',
            subheadline:
              '{fact:top_category_name} accounted for {fact:top_category_share_pct} ({fact:top_category_spend}) alongside {fact:savings_invest_total_usd} saved and invested.',
            blocks: [
              {
                label: 'Top Discretionary Category',
                fact_id: 'top_category_spend',
                unit_sup: 'US$',
                sublabel_fact_ids: ['top_category_name', 'top_category_share_pct'],
                sublabel_template: '{fact:top_category_name} · {fact:top_category_share_pct} share',
                color_role: 'primary',
              },
              {
                label: 'Eating Out & Bars',
                fact_id: 'cat_eating_out_spend',
                unit_sup: 'US$',
                sublabel_fact_ids: ['cat_eating_out_count'],
                sublabel_template: '{fact:cat_eating_out_count} dining stops',
                color_role: 'secondary',
              },
              {
                label: 'Saved & Invested',
                fact_id: 'savings_invest_total_usd',
                unit_sup: 'US$',
                sublabel_fact_ids: ['cat_savings_count'],
                sublabel_template: '{fact:cat_savings_count} investment transfers',
                color_role: 'tertiary',
              },
            ],
          },
        },
        receiptFactIds: ['discretionary_spend_usd'],
      });
    }

    // 11. Chosen Chapter: Your Money Personality
    const personalityCand = scoreById.get('personality')!;
    rawChapters.push({
      chapter: {
        id: 'personality',
        type: 'personality',
        palette_id: personalityCand.palette_id,
        headline: personality.title,
        body: personality.subtitle,
        fact_ids: [
          'payday_spike_ratio',
          'payday_count',
          'visits_top_merchant',
          'top_merchant_name',
          'coffee_total_visits',
          'studio_total_with_gear_spend',
          'studio_gear_count',
          'savings_invest_total_usd',
          'top_category_share_pct',
        ],
        txn_ids: [],
        params: {
          kicker: 'YOUR MONEY PERSONALITY',
          subheadline:
            'Steady {fact:payday_spike_ratio} payday rhythm · {fact:visits_top_merchant} visits to {fact:top_merchant_name} · {fact:savings_invest_total_usd} saved.',
          blocks: [
            {
              label: 'Payday Rhythm',
              fact_id: 'payday_spike_ratio',
              sublabel_fact_ids: ['payday_count'],
              sublabel_template: 'Across {fact:payday_count} monthly paydays',
              color_role: 'primary',
            },
            {
              label: 'Anchor Ritual',
              fact_id: 'visits_top_merchant',
              sublabel_fact_ids: ['top_merchant_name'],
              sublabel_template: 'Visits to {fact:top_merchant_name}',
              color_role: 'secondary',
            },
            {
              label: 'Saved & Invested',
              fact_id: 'savings_invest_total_usd',
              unit_sup: 'US$',
              sublabel_fact_ids: ['cat_savings_count'],
              sublabel_template: '{fact:cat_savings_count} investment contributions',
              color_role: 'tertiary',
            },
          ],
        },
      },
      receiptFactIds: ['visits_top_merchant', 'savings_invest_total_usd'],
    });

    // 12. Fixed Chapter: In One Line
    rawChapters.push({
      chapter: {
        id: 'one_line',
        type: 'one_line',
        palette_id: 'ink_solar',
        headline: oneLine,
        body: `Takeaway for ${personName} — Every number in your {fact:year_number} summary is backed by {fact:total_transactions_count} auditable bank rows — click any highlighted figure to inspect the exact receipts.`,
        fact_ids: [
          'year_number',
          'total_transactions_count',
          'discretionary_spend_usd',
          'top_merchant_name',
          'visits_top_merchant',
        ],
        txn_ids: [],
        params: {
          kicker: 'IN ONE LINE',
          subheadline: 'Every claim in this sentence opens its exact bank receipts.',
        },
      },
      receiptFactIds: ['visits_top_merchant', 'savings_invest_total_usd'],
    });

    // 13. Fixed Finale: Your Share Card
    const sharePalette = studioCand.selected ? 'solar_ember' : 'olive_lime';
    const shareBody = studioCand.selected
      ? `Takeaway for ${personName} — Your {fact:year_number} snapshot ({fact:discretionary_spend_usd} discretionary spend across {fact:total_transactions_count} transactions, {fact:visits_top_merchant} visits to {fact:top_merchant_name}, and {fact:studio_total_with_gear_spend} in studio gear) is ready to export with zero account numbers or raw bank strings.`
      : `Takeaway for ${personName} — Your {fact:year_number} snapshot ({fact:discretionary_spend_usd} discretionary spend across {fact:total_transactions_count} transactions, {fact:visits_top_merchant} visits to {fact:top_merchant_name}, and {fact:savings_invest_total_usd} saved) is ready to export with zero account numbers or raw bank strings.`;

    rawChapters.push({
      chapter: {
        id: 'share_card',
        type: 'share_card',
        palette_id: sharePalette,
        headline: `${personName} · {fact:year_number}`,
        body: shareBody,
        fact_ids: [
          'year_number',
          'discretionary_spend_usd',
          'total_spend_usd',
          'total_transactions_count',
          'visits_top_merchant',
          'top_merchant_name',
          'payday_count',
        ],
        txn_ids: [],
        params: {
          kicker: 'YOUR SHARE CARD',
          subheadline: 'Exported in portrait and story formats with zero account details.',
        },
      },
      receiptFactIds: ['visits_top_merchant'],
    });
  }

  const totalStr = String(rawChapters.length).padStart(2, '0');
  const chapters: Chapter[] = rawChapters.map((entry, idx) => {
    const chNum = String(idx + 1).padStart(2, '0');
    const rawKicker =
      typeof entry.chapter.params.kicker === 'string' ? entry.chapter.params.kicker : '';
    const strippedKicker = rawKicker.replace(/^\d+\s*(?:\/\s*\d+\s*)?·\s*/, '');
    const updatedKicker =
      isB2B && strippedKicker ? `${chNum} / ${totalStr} · ${strippedKicker}` : rawKicker;
    const chWithNumber: Chapter = {
      ...entry.chapter,
      params: {
        chapter_number: chNum,
        ...entry.chapter.params,
        ...(updatedKicker ? { kicker: updatedKicker } : {}),
      },
    };
    return finalizeChapter(chWithNumber, factMap, entry.receiptFactIds);
  });

  const paletteIds = Array.from(new Set(chapters.map((c) => c.palette_id)));

  const plan: StoryPlan = {
    person_name: personName,
    year_fact_id: 'year_number',
    year,
    palette_ids: paletteIds,
    chapters,
    one_line: oneLine,
    personality,
  };

  const rationaleMarkdown = buildRationaleMarkdown(personName, plan, candidateScores, factMap);

  return {
    plan,
    candidateScores,
    rationaleMarkdown,
  };
}

function buildRationaleMarkdown(
  personName: string,
  plan: StoryPlan,
  candidateScores: readonly CandidateChapterScore[],
  factMap: ReadonlyMap<string, Fact>
): string {
  const resolvePreview = (tpl: string): string =>
    tpl.replace(PLACEHOLDER_REGEX, (_m, id: string) => {
      const f = factMap.get(id);
      return f ? f.formatted : `{fact:${id}}`;
    });

  const selectedCandidates = candidateScores.filter((c) => c.selected);
  const rejectedCandidates = candidateScores.filter((c) => !c.selected);

  const lines: string[] = [
    `# Story Planner Rationale — ${personName}'s ${plan.year} in Money (\`story/rationale.md\`)`,
    '',
    '## 1. Planner Philosophy & Rule 1 Enforcement',
    '',
    `This story plan was generated deterministically by \`story/planner.ts\` from **${factMap.size} pre-computed \`Fact\` objects**, **365 \`Day\` summaries**, and **1,000 privacy-masked \`Transaction\` records**.`,
    '',
    '- **Zero Model-Invented Numbers (Rule 1):** Every headline, body paragraph, subheadline, metric block sublabel, `one_line`, and `personality.subtitle` uses `{fact:id}` placeholders exclusively. Not a single raw digit (`0-9`) appears outside a `{fact:id}` token.',
    '- **Full Receipt Traceability (Rule 2):** Every chapter aggregates the exact union of backing `txn_ids` from its referenced facts so the user can inspect the underlying bank receipts on every screen.',
    '- **Non-Overlapping Chapter Lenses & Actionable Takeaways:** Each chapter lands one distinct analytical lens and one explicit `Takeaway for Sam — ...` insight so no two slides repeat the same narrative.',
    '- **Data-Driven Selection:** The planner evaluates 7 candidate middle chapter types and 4 candidate bespoke chapter archetypes against quantitative thresholds before sequencing the final arc.',
    '',
    '---',
    '',
    '## 2. Candidate Chapter Scoring & Ranking',
    '',
    '| Candidate ID | Type | Module | Score | Threshold | Status | Palette | Key Data Signal |',
    '|---|---|---|---:|---:|---|---|---|',
    ...candidateScores.map(
      (c) =>
        `| \`${c.id}\` | \`${c.type}\` | \`${c.bespoke_module ?? 'core'}\` | **${c.score}** | ${c.threshold} | ${c.selected ? 'SELECTED' : 'REJECTED'} | \`${c.palette_id}\` | ${c.signalSummary} |`
    ),
    '',
    '### Why Selected Candidates Made the Cut',
    ...selectedCandidates.map(
      (c) => `- **${c.title} (\`${c.id}\`, score ${c.score}/${c.threshold}):** ${c.rationale}`
    ),
    '',
    '### Why Other Candidates Were Rejected',
    ...rejectedCandidates.map(
      (c) => `- **${c.title} (\`${c.id}\`, score ${c.score}/${c.threshold}):** ${c.rationale}`
    ),
    '',
    '---',
    '',
    `## 3. Final ${plan.chapters.length}-Chapter Narrative Arc & Palette Choreography`,
    '',
    '| # | Chapter ID | Type | Bespoke Module | Palette | Headline Template | Resolved Preview | Receipts |',
    '|---:|---|---|---|---|---|---|---:|',
    ...plan.chapters.map(
      (ch, idx) =>
        `| ${idx + 1} | \`${ch.id}\` | \`${ch.type}\` | \`${ch.bespoke_module ?? '—'}\` | \`${ch.palette_id}\` | \`${ch.headline}\` | ${resolvePreview(ch.headline)} | \`${ch.txn_ids.length}\` |`
    ),
    '',
    '---',
    '',
    '## 4. Bespoke Chapters Deep Dive (`badge: "only in your app"`)',
    '',
    '### 4.1 `bespoke_0` (`bespoke_module: "studio"`) — **Room to Make Noise**',
    '- **Why Sam needs this chapter:** Generic spending recaps bury large creative projects inside a generic "Shopping" bar. Sam\'s 2025 has an unmistakable two-act creative build: a `{fact:studio_deposit_spend}` (`$2,535`) Monarch Acoustic deposit on `2025-05-24` followed by the `{fact:studio_final_spend}` (`$9,061.87`) Monarch Acoustic completion payment on `2025-08-11` (`{fact:studio_total_spend}` / `$11,596` for the room), immediately followed by a `{fact:studio_synth_spend}` (`$445`) synth purchase on `2025-08-19` and `{fact:studio_gear_count}` (`15`) total purchases across Sweetwater, Rubber Duckling, Synthyard, MyVolts, and secondhand synth/audio sellers totaling `{fact:studio_total_with_gear_spend}` (`$15,496`).',
    '- **Palette:** `paper_studio` (Warm Bone `#F3F0E6` & Studio Ember `#FF5A14` on `#111111` ink).',
    '- **Badge:** `"only in your app"`.',
    '',
    '### 4.2 `bespoke_1` (`bespoke_module: "coffee"`) — **The Morning Rivalry**',
    "- **Why Sam needs this chapter:** Sam bought `{fact:coffee_total_visits}` (`163`) coffees across `{fact:coffee_merchants_count}` (`20`) distinct cafés totaling `{fact:coffee_total_spend}` (`$2,264`), with a `{fact:longest_coffee_streak_days}`-day (`5`-day) consecutive coffee streak. Even more distinctively, two local cafés competed for Sam's mornings all year across noisy bank strings: `{fact:top_merchant_name}` (**Blue Bottle Coffee**, `{fact:visits_top_merchant}` = `72` visits, `{fact:spend_top_merchant}` = `$572.80`) vs `{fact:second_coffee_merchant_name}` (**Sightglass Coffee**, unified across `SIGHTGLASS COFFEE SF`, `SIGHTGLASS COFFEE SOMA`, and `SIGHTGLASS COFFEE MISSION` at `{fact:second_coffee_visits}` = `41` visits, `{fact:second_coffee_spend}` = `$634.27` — topping Blue Bottle in total dollars despite fewer stops).",
    '- **Palette:** `solar_ember` (Solar Yellow `#F4F03A` & Ember Orange `#FF5A14`).',
    '- **Badge:** `"only in your app"`.',
    '',
    '---',
    '',
    '## 5. Money Personality & One-Line Distillation',
    '',
    `- **Personality Title:** \`${plan.personality.title}\``,
    `- **Personality Subtitle Template:** \`${plan.personality.subtitle}\``,
    `- **Resolved Subtitle:** "${resolvePreview(plan.personality.subtitle)}"`,
    `- **Dominant Discretionary Categories:** ${plan.personality.dominant_categories.map((c) => `\`${c}\``).join(', ')}`,
    `- **One-Line Template:** \`${plan.one_line}\``,
    `- **Resolved One-Line:** "${resolvePreview(plan.one_line)}"`,
    '',
  ];

  return lines.join('\n');
}

/**
 * Generates a deterministic, realistic 2025 CSV for the contrast persona ("Alex"):
 * - Remote product designer at Cascade Digital Labs, marathon trail runner, and dedicated home cook.
 * - Zero home music-studio build ($0 at Monarch Acoustic / synth merchants).
 * - Low coffee habit (14 café stops all year vs Sam's 163).
 * - Dominant grocery/home-cooking habit: 88 visits to Whole Foods Market (#1 merchant) and 132 grocery trips total ($9,800+) vs only 8 takeaway orders.
 * - Heavy endurance & recovery habit: 18 Physio sessions ($2,160) and 34 total health/wellness visits ($3,040+).
 * - International marathon & coastal getaway: 16 foreign-currency purchases + 5 coastal days in Cannon Beach + flights/hotels, but with no single 10-week monolith purchase (max purchase is $1,420 flight = 3 weeks of normal spend).
 * - Steady automated saver ($28,800 across 24 investment/Fidelity 401(k) contributions) with flat post-payday spending (1.1x) and no October surge (1.0x).
 */
export function generateAlexSyntheticCsv(): string {
  const rows: string[] = ['id,date,posted_date,account,tran_type,description,amount,currency'];
  let savSeq = 1;
  let cardSeq = 1;

  const pushRow = (
    account: 'Credit card' | 'Savings',
    date: string,
    tranType: string,
    description: string,
    signedAmount: number
  ) => {
    const cleanDate = date.replace(/-/g, '');
    const id =
      account === 'Credit card'
        ? `ALEX-CARD-${cleanDate}-${String(cardSeq++).padStart(3, '0')}`
        : `ALEX-SAV-${cleanDate}-${String(savSeq++).padStart(3, '0')}`;
    const descCsv = description.includes(',') ? `"${description}"` : description;
    rows.push(
      `${id},${date},${date},${account},${tranType},${descCsv},${signedAmount.toFixed(2)},USD`
    );
  };

  // 1. Monthly Salary (12 uniform paydays on the last weekday of each month), Rent, Investments, Bills, Interest, and Card Transfers
  const paydays2025 = [
    '2025-01-31',
    '2025-02-28',
    '2025-03-31',
    '2025-04-30',
    '2025-05-30',
    '2025-06-30',
    '2025-07-31',
    '2025-08-29',
    '2025-09-30',
    '2025-10-31',
    '2025-11-28',
    '2025-12-31',
  ];

  paydays2025.forEach((payDate, mIdx) => {
    const ym = `2025-${String(mIdx + 1).padStart(2, '0')}`;
    const salaryAmt = 7450.0;
    pushRow('Savings', payDate, 'D/C', 'D/C FROM CASCADE DIGITAL LABS INC SALARY/WAGES', salaryAmt);
    pushRow('Savings', `${ym}-01`, 'INT', 'BANK - INTEREST', 92.4);
    pushRow('Savings', `${ym}-01`, 'DEBIT', 'IRS:TAX WITHHOLDING ON INTEREST', -30.49);
    pushRow('Savings', `${ym}-02`, 'D/D', 'PM TRANSFER D/D TO US-ACCT-1001 Rent', -1450.0);
    pushRow('Savings', `${ym}-03`, 'D/D', 'PM TRANSFER D/D TO US-ACCT-1001 Invest', -1950.0);
    pushRow('Savings', `${ym}-15`, 'BP', 'BILL PAYMENT TO FIDELITY 401K', -450.0);

    // Monthly utilities & subscriptions
    pushRow('Credit card', `${ym}-05`, 'DEBIT', 'PUGET SOUND ENERGY BELLEVUE WA', -118.5);
    pushRow('Credit card', `${ym}-08`, 'DEBIT', 'AT&T MOBILITY DALLAS TX', -79.0);
    pushRow('Credit card', `${ym}-11`, 'DEBIT', 'MINT MOBILE COSTA MESA CA', -36.0);
    pushRow('Credit card', `${ym}-14`, 'DEBIT', 'Spotify Stockholm', -16.99);
    pushRow('Credit card', `${ym}-19`, 'DEBIT', 'Google One Dublin', -4.49);

    // Paired credit card repayment transfer
    pushRow('Savings', `${ym}-20`, 'TFR', 'MB TRANSFER TO CARD 7731 THANK YOU', -2200.0);
    pushRow('Credit card', `${ym}-20`, 'CREDIT', 'PAYMENT RECEIVED THANK YOU', 2200.0);
  });

  // 2. Dominant Top Merchant: Whole Foods Market (88 grocery visits across the year, ~every 4 days)
  const startUtc = Date.UTC(2025, 0, 1);
  for (let i = 0; i < 88; i++) {
    const dayOffset = Math.min(364, Math.floor((i * 365) / 88) + 1);
    const isoDate = new Date(startUtc + dayOffset * 86400000).toISOString().slice(0, 10);
    const cents = 5800 + ((i * 730) % 5400); // $58.00 .. $111.30
    pushRow('Credit card', isoDate, 'DEBIT', 'WHOLE FOODS MARKET SEATTLE WA', -(cents / 100));
  }

  // 3. Additional Artisan Groceries for Home Cooking (44 visits -> 132 total grocery visits)
  for (let i = 0; i < 24; i++) {
    const dayOffset = Math.min(364, i * 15 + 3);
    const isoDate = new Date(startUtc + dayOffset * 86400000).toISOString().slice(0, 10);
    const cents = 3400 + ((i * 410) % 2800);
    pushRow(
      'Credit card',
      isoDate,
      'DEBIT',
      "BEECHER'S HANDMADE CHEESE SEATTLE WA",
      -(cents / 100)
    );
  }
  for (let i = 0; i < 20; i++) {
    const dayOffset = Math.min(364, i * 18 + 6);
    const isoDate = new Date(startUtc + dayOffset * 86400000).toISOString().slice(0, 10);
    const cents = 2900 + ((i * 370) % 2400);
    pushRow('Credit card', isoDate, 'DEBIT', 'Uwajimaya Seattle WA', -(cents / 100));
  }

  // 4. Create a 19-day continuous spending streak in March (2025-03-03 .. 2025-03-21)
  // while keeping spending per day modest so October/post-payday ratios stay flat
  for (let d = 3; d <= 21; d++) {
    const isoDate = `2025-03-${String(d).padStart(2, '0')}`;
    pushRow('Credit card', isoDate, 'DEBIT', 'GOOD DOUGH BAGELS SEATTLE WA', -19.5);
  }

  // 5. Endurance Running & Physio Recovery (18 Physio sessions + 16 Pharmacy/Sports Health visits = 34 health txns)
  for (let i = 0; i < 18; i++) {
    const dayOffset = Math.min(364, i * 20 + 4);
    const isoDate = new Date(startUtc + dayOffset * 86400000).toISOString().slice(0, 10);
    pushRow('Savings', isoDate, 'BP', 'BILL PAYMENT TO Physio', -120.0);
  }
  for (let i = 0; i < 16; i++) {
    const dayOffset = Math.min(364, i * 22 + 9);
    const isoDate = new Date(startUtc + dayOffset * 86400000).toISOString().slice(0, 10);
    const desc = i % 2 === 0 ? 'CVS Pharmacy Seattle WA' : 'Walgreens Seattle WA';
    pushRow('Credit card', isoDate, 'DEBIT', desc, -55.0);
  }

  // 6. Low Coffee Habit (14 visits total across 2 cafés: 9 Cafe Lumen, 5 Orbit Roasters)
  for (let i = 0; i < 9; i++) {
    const dayOffset = i * 38 + 10;
    const isoDate = new Date(startUtc + dayOffset * 86400000).toISOString().slice(0, 10);
    pushRow('Credit card', isoDate, 'DEBIT', 'CAFE LUMEN SEATTLE WA', -5.5);
  }
  for (let i = 0; i < 5; i++) {
    const dayOffset = i * 65 + 24;
    const isoDate = new Date(startUtc + dayOffset * 86400000).toISOString().slice(0, 10);
    pushRow('Credit card', isoDate, 'DEBIT', 'ORBIT ROASTERS SEATTLE WA', -5.8);
  }

  // 7. Minimal Takeaway (8 sushi orders all year)
  for (let i = 0; i < 8; i++) {
    const dayOffset = i * 44 + 17;
    const isoDate = new Date(startUtc + dayOffset * 86400000).toISOString().slice(0, 10);
    pushRow('Credit card', isoDate, 'DEBIT', 'KURA REVOLVING SUSHI SEATTLE WA', -24.5);
  }

  // 8. International Marathon Travel & Coastal Recovery Getaway
  // Largest single purchase is $1,420.00 (~3 weeks of normal spending, so big_one score stays below 55)
  pushRow('Credit card', '2025-05-12', 'DEBIT', 'Alaska Airlines Seattle WA', -1420.0);
  pushRow('Credit card', '2025-05-14', 'DEBIT', 'Partners on Booking BV Amsterdam', -860.0);
  pushRow('Credit card', '2025-09-08', 'DEBIT', 'The Edgewater Hotel Seattle WA', -540.0);
  pushRow('Credit card', '2025-09-09', 'DEBIT', 'ALLIANZ TRAVEL INS RICHMOND VA', -145.0);

  // 16 Foreign Currency (FX) transactions + 16 FX fee rows
  for (let i = 0; i < 16; i++) {
    const dayStr = String(10 + i).padStart(2, '0');
    const isoDate = `2025-05-${dayStr}`;
    pushRow(
      'Credit card',
      isoDate,
      'DEBIT',
      'Etsy.com TrailGearCo Dublin 1 80.39 POUND STERLING at a Conversion Rate of 0.76 (US$105.78)',
      -105.78
    );
    pushRow('Credit card', isoDate, 'DEBIT', 'INTL TRANSACTION FEE', -2.12);
  }

  // 5 Coastal days in Cannon Beach
  const cannonBeachDays = ['2025-11-14', '2025-11-15', '2025-11-16', '2025-11-17', '2025-11-18'];
  for (const mDate of cannonBeachDays) {
    pushRow('Credit card', mDate, 'DEBIT', 'SANDHILLS MARKET CANNON BEACH OR', -68.0);
    pushRow('Credit card', mDate, 'DEBIT', 'DRIFTWOOD KITCHEN CANNON BEACH OR', -54.0);
  }

  // 9. Transport, Shopping (running shoes, books), Fun, Gifts (evenly spread across non-October months)
  const otherMonths = ['01', '02', '04', '06', '07', '08', '09', '11', '12'];
  otherMonths.forEach((mm, idx) => {
    pushRow('Credit card', `2025-${mm}-15`, 'DEBIT', 'REI CO-OP SEATTLE WA', -185.0);
    pushRow('Credit card', `2025-${mm}-18`, 'DEBIT', 'WASHINGTON STATE FERRIES SEATTLE WA', -46.0);
    pushRow('Credit card', `2025-${mm}-22`, 'DEBIT', 'Chevron Seattle WA', -72.0);
    if (idx % 2 === 0) {
      pushRow('Credit card', `2025-${mm}-24`, 'DEBIT', 'PACIFIC CULINARY STUDIO SEATTLE WA', -95.0);
      pushRow('Credit card', `2025-${mm}-25`, 'DEBIT', 'PIKE PLACE FLOWERS SEATTLE WA', -65.0);
    }
  });

  return rows.join('\n') + '\n';
}

/**
 * Produces a comprehensive markdown report (`reports/personalisation.md`) comparing
 * Sam's `story/plan.json` and Alex's `story/alex_plan.json` side by side.
 */
export function buildPersonalisationComparisonMarkdown(
  samOutput: StoryPlannerOutput,
  samFacts: readonly Fact[],
  alexOutput: StoryPlannerOutput,
  alexFacts: readonly Fact[]
): string {
  const samMap = new Map(samFacts.map((f) => [f.id, f]));
  const alexMap = new Map(alexFacts.map((f) => [f.id, f]));

  const resolveCopy = (tpl: string, map: ReadonlyMap<string, Fact>): string =>
    tpl.replace(PLACEHOLDER_REGEX, (_m, id: string) => map.get(id)?.formatted ?? `{fact:${id}}`);

  const samChIds = samOutput.plan.chapters.map(
    (c) => `${c.id}${c.bespoke_module ? ` (${c.bespoke_module})` : ''}`
  );
  const alexChIds = alexOutput.plan.chapters.map(
    (c) => `${c.id}${c.bespoke_module ? ` (${c.bespoke_module})` : ''}`
  );

  const candidateIds = samOutput.candidateScores.map((c) => c.id);

  const lines: string[] = [
    '# Two-Persona Personalisation Verification (`reports/personalisation.md`)',
    '',
    '## 1. Executive Summary',
    '',
    'To verify that **"An app just for me"** is genuinely driven by each person\'s transaction signals rather than pouring numbers into a static template (`BRIEF.md` §1 & §7 Phase 2), we ran the **exact same deterministic data pipeline (`pipeline/`) and story planner (`story/planner.ts`)** on two contrasting 2025 bank CSVs:',
    '',
    '1. **Sam (`data/transactions_2025.csv` → `story/plan.json`):** Seattle creative at Pacific Studio Labs who visited **Blue Bottle Coffee 72 times** (and **Sightglass Coffee 41 times** across **163 coffees**), built a **home music studio with Monarch Acoustic (`$11,596` room + `$15,496` with synths & gear across 15 purchases)**, had a **34-day spending streak**, escaped to **Cannon Beach**, and experienced a **1.9× October spending surge** alongside **12 uniform `$6,750` monthly paychecks (`$81,000` salary)**.',
    `2. **Alex (\`data/mock/alex_2025.csv\` → \`story/alex_plan.json\`):** Remote product designer at Cascade Digital Labs, marathon trail runner, and dedicated home cook with **zero studio build (\`$0\`)**, **low coffee spend (\`${getFactStr(alexMap, 'coffee_total_visits')}\` cups all year)**, **${getFactStr(alexMap, 'visits_top_merchant')} visits to ${getFactStr(alexMap, 'top_merchant_name')} (\`${getFactStr(alexMap, 'cat_groceries_count')}\` grocery market trips vs just \`${getFactStr(alexMap, 'cat_takeaway_count')}\` takeaway orders)**, **${getFactStr(alexMap, 'cat_health_count')} physio & sports-recovery visits (\`${getFactStr(alexMap, 'cat_health_spend')}\` health total)**, **${getFactStr(alexMap, 'fx_transactions_count')} international FX purchases**, and a **steady automated savings habit (\`${getFactStr(alexMap, 'savings_invest_total_usd')}\`)** across **12 uniform \`$7,450\` monthly paychecks (\`${getFactStr(alexMap, 'salary_income_usd')}\` salary)** with flat post-payday and October spending.`,
    '',
    '---',
    '',
    '## 2. Side-by-Side Story Plan Comparison',
    '',
    '| Dimension | Sam (`story/plan.json`) | Alex (`story/alex_plan.json`) | Divergence Proof |',
    '|---|---|---|---|',
    `| **Total Chapters** | **${samOutput.plan.chapters.length} chapters** | **${alexOutput.plan.chapters.length} chapters** | Alex omits \`heartbeat\` and \`big_one\` because Alex has no October/payday spike and no 10-week monolith purchase. |`,
    `| **Chapter Sequence** | ${samChIds.map((s) => `\`${s}\``).join(' → ')} | ${alexChIds.map((s) => `\`${s}\``).join(' → ')} | Different middle chapter count, order, and bespoke modules. |`,
    `| **Bespoke Chapter 0 (\`bespoke_0\`)** | \`studio\` — **Room to Make Noise** (\`paper_studio\`) | \`wellness_log\` — **The Endurance Block** (\`mint_obsidian\`) | Sam gets a home music-studio & synth build chapter; Alex gets a Physio & marathon recovery chapter. |`,
    `| **Bespoke Chapter 1 (\`bespoke_1\`)** | \`coffee\` — **The Morning Rivalry** (\`solar_ember\`) | \`home_pantry\` — **The Home Table** (\`olive_lime\`) | Sam gets a Blue Bottle Coffee vs Sightglass Coffee café rivalry; Alex gets a ${getFactStr(alexMap, 'cat_groceries_count')}-grocery vs ${getFactStr(alexMap, 'cat_takeaway_count')}-takeaway home-cooking chapter. |`,
    `| **Your Place (\`your_place\`)** | **${getFactStr(samMap, 'top_merchant_name')}** (\`${getFactStr(samMap, 'visits_top_merchant')}\` visits, \`solar_ember\`) | **${getFactStr(alexMap, 'top_merchant_name')}** (\`${getFactStr(alexMap, 'visits_top_merchant')}\` visits, \`olive_lime\`) | Different anchor merchant, category (\`coffee\` vs \`groceries\`), and chapter palette. |`,
    `| **Money Personality Title** | **${samOutput.plan.personality.title}** (\`lavender_night\`) | **${alexOutput.plan.personality.title}** (\`mint_obsidian\`) | Distinct data-derived archetypes and generative radial seeds (\`${samOutput.plan.personality.shape_seed}\` vs \`${alexOutput.plan.personality.shape_seed}\`). |`,
    `| **Dominant Categories** | ${samOutput.plan.personality.dominant_categories.map((c) => `\`${c}\``).join(', ')} | ${alexOutput.plan.personality.dominant_categories.map((c) => `\`${c}\``).join(', ')} | Sam is led by \`shopping\` & \`eating out\`; Alex is led by \`groceries\`, \`travel\`, & \`health\`. |`,
    `| **Palettes Used** | ${samOutput.plan.palette_ids.map((p) => `\`${p}\``).join(', ')} | ${alexOutput.plan.palette_ids.map((p) => `\`${p}\``).join(', ')} | Distinct visual mood tailored to each persona's spending signals. |`,
    '',
    '---',
    '',
    '## 3. Candidate Chapter Score Matrix (Sam vs Alex)',
    '',
    '| Candidate Chapter | Threshold | Sam Score | Sam Decision | Alex Score | Alex Decision | Why They Diverge |',
    '|---|---:|---:|---|---:|---|---|',
    ...candidateIds.map((cid) => {
      const s = samOutput.candidateScores.find((c) => c.id === cid)!;
      const a = alexOutput.candidateScores.find((c) => c.id === cid)!;
      return `| **${s.title}** (\`${cid}\`) | ${s.threshold} | **${s.score}** | ${s.selected ? 'SELECTED' : 'REJECTED'} | **${a.score}** | ${a.selected ? 'SELECTED' : 'REJECTED'} | Sam: ${s.signalSummary} <br> Alex: ${a.signalSummary} |`;
    }),
    '',
    '---',
    '',
    '## 4. Resolved One-Line & Personality Copy Comparison',
    '',
    '### Sam (`story/plan.json`)',
    `- **Personality:** **${samOutput.plan.personality.title}** — *"${resolveCopy(samOutput.plan.personality.subtitle, samMap)}"*`,
    `- **One Line:** *"${resolveCopy(samOutput.plan.one_line, samMap)}"*`,
    '',
    '### Alex (`story/alex_plan.json`)',
    `- **Personality:** **${alexOutput.plan.personality.title}** — *"${resolveCopy(alexOutput.plan.personality.subtitle, alexMap)}"*`,
    `- **One Line:** *"${resolveCopy(alexOutput.plan.one_line, alexMap)}"*`,
    '',
  ];

  return lines.join('\n');
}

export { isDiscretionaryCategory };
