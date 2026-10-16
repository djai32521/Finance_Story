/**
 * Internationalization (i18n) Engine (`src/i18n.ts`)
 *
 * Supports Korean ('ko', default) and English ('en') with instant hot-switching,
 * persistent localStorage preferences, and reactive listener callbacks.
 */

export type Language = 'ko' | 'en';

const STORAGE_KEY = 'finance_story_lang';

const isTestRunner =
  typeof process !== 'undefined' &&
  (Boolean(process.env?.VITEST) ||
    process.env?.NODE_ENV === 'test' ||
    Boolean(process.env?.npm_lifecycle_event?.includes('test')));

let currentLanguage: Language = isTestRunner ? 'en' : 'ko';

// Check saved preference or default to Korean
if (!isTestRunner && typeof window !== 'undefined' && window.localStorage) {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'ko') {
      currentLanguage = saved;
    } else {
      currentLanguage = 'ko'; // Default is Korean
    }
  } catch {
    currentLanguage = 'ko';
  }
}

type Listener = (lang: Language) => void;
const listeners = new Set<Listener>();

export function getLanguage(): Language {
  return currentLanguage;
}

export function setLanguage(lang: Language): void {
  if (currentLanguage === lang) return;
  currentLanguage = lang;
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // ignore
    }
  }
  for (const fn of listeners) {
    try {
      fn(lang);
    } catch (err) {
      console.error('[i18n] listener error:', err);
    }
  }
}

export function toggleLanguage(): Language {
  const next: Language = currentLanguage === 'ko' ? 'en' : 'ko';
  setLanguage(next);
  return next;
}

export function onLanguageChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export const TRANSLATIONS = {
  ko: {
    // Top Bar & Brand
    brand_title: '금융 이야기',
    brand_sub: '인터랙티브 요약 · 장부 분석',
    brand_tag: '금융 이야기 · 인터랙티브 요약',
    nav_prev: '← 이전',
    nav_pause: '❚❚ 일시정지',
    nav_play: '▶ 재생',
    nav_next: '다음 →',
    nav_explore: '탐색 [E]',
    nav_ask: '질문 [A]',
    nav_receipts: '거래 내역',
    nav_share: '공유 PNG',
    nav_data: '데이터 업로드',
    nav_lang: '한국어 (KO)',
    reduced_motion: '모션 줄이기',

    // Start Screen
    start_top_left: '금융 이야기 · 경영진 인터랙티브 요약',
    start_top_right: '장부 정밀 분석',
    start_hero_kicker: 'EXECUTIVE INTELLIGENCE · 경영진 인텔리전스',
    start_hero_title: '금융 이야기.',
    start_hero_copy:
      '회계 장부, 엑셀(.xlsx), CSV 및 구글 드라이브 폴더를 한눈에 파악할 수 있는 인터랙티브 재무 스토리로 변환하세요.',
    start_cta_kicker: '데이터 소스 연결 및 분석 시작',
    start_stat_label: '총 운영 지출 (TOTAL OUTFLOW)',
    start_stat_txns: '건의 거래 내역',
    start_dropzone_title: 'Excel(.xlsx), CSV, JSON 또는 PDF 업로드',
    start_dropzone_sub: '파일을 여기로 드래그하거나 클릭하여 탐색하세요',
    start_drive_placeholder: '공개 Google Drive 폴더 또는 Sheets 링크 입력...',
    start_drive_import: '가져오기',
    start_disclaimer_1:
      '본 기능을 사용함으로써 업로드하는 콘텐츠에 대한 정당한 권리를 보유하고 있음을 확인합니다. 타인의 지적 재산권이나 개인정보를 침해하는 콘텐츠를 생성하지 마세요.',
    start_disclaimer_2:
      '생성형 AI 모델을 통한 장부 분석은 데이터 인사이트 및 요약 목적에 최적화되어 제공됩니다.',
    start_deep_agent: '고급: 딥 에이전트 감사 (Deep Agent Audit)',
    start_deep_agent_sub: '파이썬 샌드박스 · 복합 분개 분석',
    start_open_btn: '재무 스토리 열기',

    // HUD / Controls
    hud_hints: '← → 챕터 전환 · Space 일시정지 · E 탐색 · A 질문',
    hud_bpm: '120 BPM · 비트',
    hud_chapter: '챕터',
    hud_start: '시작',

    // Ask Overlay
    ask_title: '장부 자연어 질문 (ASK YOUR LEDGER)',
    ask_sub: '즉각적인 결정적 분석 및 Gemini AI 심층 질의',
    ask_back: '← 스토리로 돌아가기',
    ask_placeholder: '지출이나 재무 데이터에 대해 질문해 보세요...',
    ask_btn: '질문 ↵',
    ask_answer_label: '분석 결과',
    ask_receipts_title: '관련 거래 내역',
    ask_sample_1: '12월에 커피에 쓴 금액은 얼마인가요?',
    ask_sample_2: '가장 금액이 컸던 지출 내역은?',
    ask_sample_3: '식비 및 외식 총 지출액은?',
    ask_sample_4: '주말 배달 및 외식 횟수는?',
    ask_sample_5: '시간대별 지출 패턴은?',
    ask_sample_6: '가장 자주 결제한 가맹점 Top 5는?',

    // Explore Overlay
    explore_title: '인터랙티브 장부 탐색기',
    explore_sub: '날짜에 마우스를 올리거나, 클릭하여 뒤집고, 드래그하여 합산하세요.',
    explore_back: '← 스토리로 돌아가기',
    explore_all: '전체 카테고리',
    explore_hover_kicker: '선택된 일자',
    explore_hover_hint: '그리드 위를 마우스로 이동하거나 카테고리 칩을 선택하세요.',
    explore_selection_title: '선택 구간 합계',
    explore_days_selected: '일간 선택됨',

    // Receipts Drawer
    receipts_title: '거래 내역 명세 (Ledger Entries)',
    receipts_close: '닫기 [ESC]',
    receipts_search_placeholder: '가맹점, 카테고리, 날짜, ID 검색...',
    receipts_sort_amount: '금액순 ↓',
    receipts_sort_date: '날짜순 ↓',
    receipts_empty: '일치하는 거래 내역이 없습니다.',
    receipts_count_singular: '건의 거래',
    receipts_count_plural: '건의 거래',

    // Categories
    cat_coffee: '커피 및 음료',
    cat_takeaway: '배달 및 포장',
    cat_eating_out: '외식 및 식사',
    cat_groceries: '식료품 및 마트',
    cat_travel: '출장 및 여행',
    cat_transport: '교통 및 차량',
    cat_bills: '공과금 및 통신',
    cat_rent: '임대료 및 시설',
    cat_subscriptions: '구독 및 SaaS',
    cat_health: '의료 및 건강',
    cat_fun: '문화 및 여가',
    cat_gifts: '선물 및 기부',
    cat_fees: '수수료 및 금융',
    cat_savings: '저축 및 투자',
    cat_transfers: '이체 및 상환',
    cat_income: '매출 및 급여수입',
    cat_shopping: '구매 및 장비',
  },
  en: {
    // Top Bar & Brand
    brand_title: 'Finance Story',
    brand_sub: 'Interactive summary · ledger analysis',
    brand_tag: 'Finance Story · Interactive Summary',
    nav_prev: '← Prev',
    nav_pause: '❚❚ Pause',
    nav_play: '▶ Play',
    nav_next: 'Next →',
    nav_explore: 'Explore [E]',
    nav_ask: 'Ask [A]',
    nav_receipts: 'Receipts',
    nav_share: 'Share PNG',
    nav_data: 'Upload Data',
    nav_lang: 'English (EN)',
    reduced_motion: 'Reduced motion',

    // Start Screen
    start_top_left: 'FINANCE STORY · INTERACTIVE SUMMARY',
    start_top_right: 'LEDGER ANALYSIS',
    start_hero_kicker: 'EXECUTIVE INTELLIGENCE',
    start_hero_title: 'Finance Story.',
    start_hero_copy:
      'Turn financial ledgers, Excel workbooks, or Google Drive folders into an interactive financial summary.',
    start_cta_kicker: 'CONNECT DATA SOURCE',
    start_stat_label: 'TOTAL OPERATING OUTFLOW',
    start_stat_txns: 'TRANSACTIONS',
    start_dropzone_title: 'Upload Excel (.xlsx), CSV, JSON, or PDF',
    start_dropzone_sub: 'Drag & drop files here or click to browse',
    start_drive_placeholder: 'Public Google Drive folder or Sheets link…',
    start_drive_import: 'Import',
    start_disclaimer_1:
      'By using this feature, you confirm that you have the necessary rights to any content that you upload. Do not generate content that infringes on others’ intellectual property or privacy rights. Your use of this generative AI service is subject to our <a href="https://policies.google.com/terms/generative-ai/use-policy" target="_blank" rel="noopener noreferrer" style="color:var(--ink);text-decoration:underline;font-weight:600;">Prohibited Use Policy</a>.',
    start_disclaimer_2:
      'Please note that uploads from Google Workspace may be used to develop and improve Google products and services in accordance with our <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noopener noreferrer" style="color:var(--ink);text-decoration:underline;font-weight:600;">terms</a>.',
    start_deep_agent: 'Advanced: Deep Agent Audit',
    start_deep_agent_sub: 'PYTHON SANDBOX · UP TO 10 MIN',
    start_open_btn: 'Open Finance Story',

    // HUD / Controls
    hud_hints: '← → chapters · space pause · E explore · A ask',
    hud_bpm: '120 BPM · BEAT',
    hud_chapter: 'CHAPTER',
    hud_start: 'START',

    // Ask Overlay
    ask_title: 'ASK YOUR YEAR · DETERMINISTIC QUERY EXECUTOR',
    ask_sub: 'Instant deterministic query executor & live Gemini fallback',
    ask_back: '← Back to story',
    ask_placeholder: 'Ask your year anything…',
    ask_btn: 'ASK ↵',
    ask_answer_label: 'ANSWER',
    ask_receipts_title: 'MATCHING RECEIPTS',
    ask_sample_1: 'How much did I spend on coffee in December?',
    ask_sample_2: 'Biggest purchase?',
    ask_sample_3: 'Total eating out and groceries?',
    ask_sample_4: 'Eating out on weekends?',
    ask_sample_5: 'Spending by time of day',
    ask_sample_6: 'Top merchants by visits?',

    // Explore Overlay
    explore_title: 'EXPLORE YOUR YEAR',
    explore_sub: 'Hover a day · click to flip · drag to add up · tap a lens · scrub to replay',
    explore_back: '← Back to story',
    explore_all: 'All',
    explore_hover_kicker: 'HOVERED DAY',
    explore_hover_hint: 'Move over the grid or tap a category chip',
    explore_selection_title: 'SELECTION',
    explore_days_selected: 'days selected',

    // Receipts Drawer
    receipts_title: 'Ledger entries · click any row',
    receipts_close: 'CLOSE [ESC]',
    receipts_search_placeholder: 'Filter merchant, category, date, ID…',
    receipts_sort_amount: 'Amount ↓',
    receipts_sort_date: 'Date ↓',
    receipts_empty: 'No matching transactions.',
    receipts_count_singular: 'TRANSACTION',
    receipts_count_plural: 'TRANSACTIONS',

    // Categories
    cat_coffee: 'Coffee & Drinks',
    cat_takeaway: 'Takeaway & Delivery',
    cat_eating_out: 'Eating Out & Dining',
    cat_groceries: 'Groceries & Pantry',
    cat_travel: 'Travel & Flights',
    cat_transport: 'Transport & Logistics',
    cat_bills: 'Bills & Utilities',
    cat_rent: 'Rent & Facilities',
    cat_subscriptions: 'Subscriptions & SaaS',
    cat_health: 'Health & Wellness',
    cat_fun: 'Fun & Entertainment',
    cat_gifts: 'Gifts & Donations',
    cat_fees: 'Fees & Finance',
    cat_savings: 'Savings & Treasury',
    cat_transfers: 'Transfers & Repayments',
    cat_income: 'Revenue & Payroll',
    cat_shopping: 'Shopping & Equipment',
  },
} as const;

export type TranslationKey = keyof typeof TRANSLATIONS.ko;

export function t(key: TranslationKey): string {
  const table = TRANSLATIONS[currentLanguage] ?? TRANSLATIONS.ko;
  return table[key] ?? TRANSLATIONS.ko[key] ?? key;
}

export function getTranslatedCategoryLabel(categoryKey: string, customLabel?: string): string {
  if (currentLanguage === 'en' && customLabel) {
    return customLabel;
  }
  const normalized = categoryKey.toLowerCase().replace(/[\s&]+/g, '_');
  const lookupKey = `cat_${normalized}` as TranslationKey;
  if (lookupKey in TRANSLATIONS[currentLanguage]) {
    return t(lookupKey);
  }
  return customLabel || categoryKey;
}
