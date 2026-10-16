import '@fontsource/inter-tight/300.css';
import '@fontsource/inter-tight/400.css';
import '@fontsource/inter-tight/500.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import './design/styles.css';

import type { AskQueryResult, Day, Fact, StoryPlan, Transaction } from '../contracts/index.js';
import daysJson from '../data/days.json';
import factsJson from '../data/facts.json';
import transactionsJson from '../data/transactions.json';
import planJson from '../story/plan.json';
import { answerQuestionDeterministically } from './ask/index.js';
import { registerBespokeChapters } from './chapters/bespoke/index.js';
import { StoryPlayer, installCaptureBridge, type YearAppCaptureBridge } from './player/index.js';

export interface BootstrappedApp {
  player: StoryPlayer;
  bridge: YearAppCaptureBridge;
}

export function bootstrapApp(root: HTMLElement): BootstrappedApp {
  const transactions = transactionsJson as unknown as readonly Transaction[];
  const days = daysJson as unknown as readonly Day[];
  const facts = factsJson as unknown as readonly Fact[];
  const plan = planJson as unknown as StoryPlan;

  const player = new StoryPlayer(root, {
    transactions,
    days,
    facts,
    plan,
  });

  // Register Workstream E bespoke chapters ("studio", "coffee", "bespoke_0", "bespoke_1", plus fallbacks)
  registerBespokeChapters(player);

  // Wire Workstream F "Ask your year" engine (instant <1ms deterministic NL parser + live api/ask Gemini upgrade in browser)
  player.setCustomAskExecutor((question: string): Promise<AskQueryResult> | AskQueryResult => {
    const activeTransactions = player.data.transactions;
    const immediate = answerQuestionDeterministically(question, activeTransactions);
    if (
      typeof window !== 'undefined' &&
      !navigator.webdriver &&
      !window.location.search.includes('film=1')
    ) {
      void (async (): Promise<void> => {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 3500);
          const resp = await fetch('api/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question }),
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (resp.ok) {
            const data = (await resp.json()) as AskQueryResult;
            if (
              data &&
              typeof data.answerable === 'boolean' &&
              data.source === 'model' &&
              (data.formatted_answer !== immediate.formatted_answer ||
                data.interpretation !== immediate.interpretation)
            ) {
              player.renderAskResult(data, 960, 200);
            }
          }
        } catch {
          // Offline or no api/ask server running — deterministic result is already displayed
        }
      })();
    }
    return immediate;
  });

  const bridge = installCaptureBridge(player);

  root.dataset.ready = 'true';
  root.dataset.transactions = String(transactions.length);
  root.dataset.chapters = String(plan.chapters.length);
  root.dataset.person = plan.person_name;

  // Auto-start film mode if ?film=1 is in URL
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    if (params.get('film') === '1') {
      bridge.startFilm();
    } else if (params.get('chapter')) {
      bridge.goToChapter(params.get('chapter')!);
    }
  }

  return { player, bridge };
}

const rootEl = typeof document !== 'undefined' ? document.getElementById('app') : null;
if (rootEl) {
  bootstrapApp(rootEl);
}
