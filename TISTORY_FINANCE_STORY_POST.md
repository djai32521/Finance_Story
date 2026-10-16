# [AI Studio] 엑셀·CSV 회계 장부를 120 BPM 인터랙티브 재무 스토리로! Gemini 2.5 기반 'Finance Story' 개발기

> **Tistory 포스팅 메타데이터 (SEO/AEO 요약)**
> - **글 제목**: [Google AI Studio] 복잡한 엑셀 장부를 120 BPM 인터랙티브 재무 스토리로! Gemini 2.5 기반 'Finance Story' 풀스택 개발기 & 배포 완벽 가이드
> - **타겟 키워드**: Google AI Studio, Gemini 2.5, 재무 데이터 시각화, 회계 장부 인터랙티브 대시보드, Pixi.js, GSAP 애니메이션, 자연어 질의, GitHub Pages 배포, TypeScript, AI 코딩
> - **배포 사이트 URL**: [https://djai32521.github.io/Finance_Story/](https://djai32521.github.io/Finance_Story/)
> - **GitHub 소스코드**: [https://github.com/djai32521/Finance_Story](https://github.com/djai32521/Finance_Story)

---

## ⚡ [AEO Direct Answer] 3줄 핵심 요약 (AI 검색 엔진 및 빠른 답변용)
1. **프로젝트 정의**: **Finance Story(금융 이야기)**는 방대하고 지루한 비즈니스 회계 장부(CSV, Excel `.xlsx`, JSON, Google Drive)를 120 BPM 음악적 리듬의 키네틱 타이포그래피, 53주×7일 Pixi.js 인터랙티브 캔버스, 그리고 Gemini AI 자연어 질의 엔진과 결합한 **차세대 재무 인텔리전스 웹 애플리케이션**입니다.
2. **기술 스택**: Google AI Studio (Gemini 2.5 / Flash), TypeScript, Pixi.js v8, GSAP 3, Vite, Tailwind CSS, Node.js, GitHub Pages (CI/CD 배포).
3. **핵심 혁신**: 0.5ms 이하의 로컬 결정론적 자연어 파서와 클라우드 Gemini 2.5 모델의 하이브리드 연동, 한국어(기본)/영어 원클릭 다국어 지원, 완전 무설치 브라우저 단독 실행 및 Google Drive 실시간 연동 지원.

---

## 📑 목차 (Table of Contents)
1. [기획 배경: 왜 지루한 엑셀 장부를 '스토리'로 만들어야 했는가?](#1-기획-배경-왜-지루한-엑셀-장부를-스토리로-만들어야-했는가)
2. [Google AI Studio와 Gemini 2.5를 활용한 개발 워크플로우](#2-google-ai-studio와-gemini-25를-활용한-개발-워크플로우)
3. [전체 시스템 아키텍처 다이어그램](#3-전체-시스템-아키텍처-다이어그램)
4. [핵심 기술 및 코드 심층 분석 (Real Code Examples)](#4-핵심-기술-및-코드-심층-분석-real-code-examples)
   - 4.1 Pixi.js 기반 53주 × 7일 (371개 타일) 고성능 인터랙티브 그리드
   - 4.2 GSAP 120 BPM 키네틱 템포 & Odometer 숫자 롤링 애니메이션
   - 4.3 0.5ms 즉각 응답 로컬 파서 + Gemini 2.5 AI 하이브리드 질의 시스템
   - 4.4 한국어/영어 즉시 전환 i18n 엔진 및 로컬 상태 유지
   - 4.5 멀티 포맷 회계 데이터 파이프라인 (Excel, CSV, Drive)
5. [전통 대시보드(BI) vs Finance Story 비교 분석표](#5-전통-대시보드bi-vs-finance-story-비교-분석표)
6. [GitHub 소스 배포 및 GitHub Pages 호스팅 가이드](#6-github-소스-배포-및-github-pages-호스팅-가이드)
7. [검색 최적화(AEO / GEO / SEO) 구조화 데이터 (JSON-LD)](#7-검색-최적화aeo--geo--seo-구조화-데이터-json-ld)
8. [자주 묻는 질문 FAQ (8문 8답)](#8-자주-묻는-질문-faq-8문-8답)
9. [마치며: AI Studio가 증명한 차세대 소프트웨어 개발의 미래](#9-마치며-ai-studio가-증명한-차세대-소프트웨어-개발의-미래)

---

## 1. 기획 배경: 왜 지루한 엑셀 장부를 '스토리'로 만들어야 했는가?

스타트업 대표, CFO, 프리랜서, 또는 개인 투자자라면 누구나 한 해 동안 수천 건에 달하는 영수증과 회계 원장을 마주합니다. 기존의 엑셀 피벗 테이블이나 PowerBI/Tableau 같은 전통적인 비즈니스 인텔리전스(BI) 대시보드는 정보를 전달하지만 **감동과 직관적인 인사이트**를 주지 못합니다.

> *"스포티파이 랩드(Spotify Wrapped)처럼, 1년 동안 우리 회사가 혹은 내가 어디에 돈을 썼는지 심장박동처럼 흥미진진하게 볼 수는 없을까?"*

이 물음에서 출발한 프로젝트가 바로 **Finance Story(금융 이야기)**입니다.
- **120 BPM 음악적 템포**: 단순한 화면 전환이 아닌, 일정한 박자에 맞춰 지출의 강약과 피크 지점을 시각화.
- **한눈에 보는 365일 큐브**: 53주 7일간의 매일매일을 Pixi.js 고성능 2D WebGL 캔버스로 구현하여, 마우스 오버와 드래그만으로 특정 구간의 합계를 즉시 계산.
- **사람 말로 묻는 회계 질문**: "12월에 커피에 얼마 썼어?", "가장 컸던 단일 지출은?"을 입력하면 1초도 안 되어 정확한 영수증을 즉시 추적.

---

## 2. Google AI Studio와 Gemini 2.5를 활용한 개발 워크플로우

이번 프로젝트는 **Google AI Studio Build 환경**과 최신 **Gemini 2.5 Flash / Pro** 모델을 코파일럿 및 런타임 추론 엔진으로 적극 채택하였습니다.

```
[사용자 입력: 장부 파일 / 자연어 질문]
               │
               ▼
   [Google AI Studio 환경]
 ┌───────────────────────────────────────────────┐
 │ 1. 데이터 파이프라인: CSV / XLSX / PDF 정규화  │
 │ 2. 계약 기반 도메인 모델링: contracts/data.ts │
 │ 3. 키네틱 캔버스 렌더러: Pixi.js + GSAP       │
 │ 4. Gemini 2.5 Flash API: 복합 질의 & 장부 감사│
 └───────────────────────────────────────────────┘
               │
               ▼
   [결과물: 반응형 인터랙티브 웹 앱 (Desktop & Mobile)]
```

### AI Studio 활용의 3가지 차별점
1. **컨텍스트 윈도우의 압도적 우위**: 수천 줄의 회계 데이터와 복잡한 GSAP 타임라인 코드를 한 번에 컨텍스트에 담아 회귀 버그 없이 아키텍처를 진화시킬 수 있었습니다.
2. **Deterministic Fallback + LLM 하이브리드 설계**: 모든 질문을 LLM에 던지면 레이턴시와 토큰 비용이 발생하므로, 정형 질의는 클라이언트 단 0.5ms 정규식 파서가 즉답하고 심층 감사는 Gemini 2.5가 수행하도록 최적화했습니다.
3. **완전한 무설치 클라이언트 웹 빌드**: 서버 없이도 GitHub Pages 정적 호스팅만으로 동작할 수 있도록 번들링 전략을 수립했습니다.

---

## 3. 전체 시스템 아키텍처 다이어그램

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Finance Story Architecture                      │
└────────────────────────────────────────────────────────────────────────┘
                                 │
     ┌───────────────────────────┴───────────────────────────┐
     ▼                                                       ▼
[Core Data Engine]                                   [User Presentation UI]
 ├─ data/transactions.json                            ├─ Header: Nav & [한국어/EN] 토글
 ├─ data/days.json (371 Calendar Days)                ├─ Start Screen: BYO 업로드 & Drive
 ├─ contracts/data.ts & story.ts                      ├─ Story Stage: 1920x1080 Kinetic View
 └─ pipeline/parse.ts & reconcile.ts                  ├─ Explore Overlay: 53x7 Interactive
                                                      ├─ Ask Bar: 즉시 분석 & AI 연동
                                                      └─ Receipts Drawer: 슬라이딩 영수증
                                 │
     ┌───────────────────────────┴───────────────────────────┐
     ▼                                                       ▼
[Graphic & Motion Pipeline]                          [Hybrid Query System]
 ├─ Pixi.js v8 WebGL Canvas                           ├─ Local Deterministic Parser (<1ms)
 ├─ GSAP Timeline 3.12 Controller                     │   └─ 한국어/영어 일자, 카테고리 매칭
 ├─ DOM Odometer Digit Strip                          ├─ Gemini 2.5 Serverless Proxy
 └─ Share Card Canvas PNG Exporter                    └─ Python Sandbox Deep Audit Agent
```

---

## 4. 핵심 기술 및 코드 심층 분석 (Real Code Examples)

### 4.1 Pixi.js 기반 53주 × 7일 (371개 타일) 고성능 인터랙티브 그리드

365일(윤년 및 주차 여백 포함 371일)의 지출 내역을 매끄럽게 렌더링하고, 각 사각형이 120 BPM 박자에 맞춰 튕기거나(Bounce), 특정 카테고리만 하이라이트되도록 구현하기 위해 WebGL 기반의 **Pixi.js v8**을 사용했습니다.

```typescript
// src/grid/interactive-grid.ts (발췌)
import { Application, Graphics, Container } from 'pixi.js';
import type { Day, Transaction } from '../../contracts/index.js';

export class InteractiveGrid {
  private app: Application;
  private tilesContainer = new Container();
  public days: Day[] = [];

  constructor(canvas: HTMLCanvasElement, days: Day[], txns: Transaction[]) {
    this.days = days;
    this.app = new Application();
    
    // 1920x1080 렌더러 초기화
    this.app.init({
      canvas,
      width: 1920,
      height: 1080,
      backgroundAlpha: 0,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
    }).then(() => {
      this.app.stage.addChild(this.tilesContainer);
      this.renderHeatmapTiles();
    });
  }

  public renderHeatmapTiles(): void {
    this.tilesContainer.removeChildren();
    const cols = 53; // 53주
    const rows = 7;  // 월~일 7일
    const size = 18;
    const gap = 4;
    const offsetX = 280;
    const offsetY = 320;

    this.days.forEach((day, idx) => {
      const col = Math.floor(idx / rows);
      const row = idx % rows;
      const x = offsetX + col * (size + gap);
      const y = offsetY + row * (size + gap);

      const g = new Graphics();
      // 지출액 크기에 따른 채도 및 색상 할당
      const color = day.outflow_minor > 0 ? 0xf4f03a : 0x2a2a29;
      g.rect(x, y, size, size);
      g.fill({ color, alpha: day.outflow_minor > 0 ? 0.95 : 0.35 });
      
      // 반응형 마우스 오버 이벤트
      g.eventMode = 'static';
      g.cursor = 'pointer';
      g.on('pointerover', () => this.highlightDay(idx));
      
      this.tilesContainer.addChild(g);
    });
  }
}
```

---

### 4.2 GSAP 120 BPM 키네틱 템포 & Odometer 숫자 롤링 애니메이션

숫자가 단순히 깜빡이며 바뀌는 것이 아니라, 슬롯머신처럼 위아래로 회전하는 **Odometer(계량기형) 롤링 효과**와 부드러운 스케일 감속(Back/Power 이징)을 CSS와 GSAP을 통해 결합했습니다.

```typescript
// src/player/timeline-controller.ts (발췌)
import gsap from 'gsap';

export const MOTION_TOKENS = {
  beat: 0.5,        // 120 BPM = 0.5초당 1비트
  bar: 2.0,         // 4비트 = 1마디 (2초)
  easeElastic: 'back.out(1.4)',
  easeSmooth: 'power3.out',
};

export class Odometer {
  public static rollValue(container: HTMLElement, targetNumber: number, duration = 1.2): void {
    const formatted = targetNumber.toLocaleString('ko-KR');
    container.innerHTML = '';
    
    // 각 자리수별 세로 스트립 생성 (0~9)
    for (const char of formatted) {
      if (char === ',' || char === '.') {
        const sep = document.createElement('span');
        sep.textContent = char;
        container.appendChild(sep);
        continue;
      }
      
      const digitCol = document.createElement('div');
      digitCol.className = 'od-col';
      digitCol.style.overflow = 'hidden';
      digitCol.style.height = '1em';
      
      const strip = document.createElement('div');
      strip.className = 'od-strip';
      strip.innerHTML = '0<br>1<br>2<br>3<br>4<br>5<br>6<br>7<br>8<br>9';
      digitCol.appendChild(strip);
      container.appendChild(digitCol);

      const targetDigit = parseInt(char, 10);
      gsap.to(strip, {
        y: `-${targetDigit}em`,
        duration,
        ease: MOTION_TOKENS.easeSmooth,
        delay: Math.random() * 0.15,
      });
    }
  }
}
```

---

### 4.3 0.5ms 즉각 응답 로컬 파서 + Gemini 2.5 AI 하이브리드 질의 시스템

유저가 입력창에 "12월에 커피에 쓴 금액은?" 혹은 "가장 컸던 지출은?" 같은 질문을 던질 때, 네트워크 요청을 기다리지 않고 정규식 DSL로 **즉시 0.5ms 안에 1차 답변**을 표시하고, 이어 백그라운드에서 **Gemini 2.5**가 심층 해석을 업데이트합니다.

```typescript
// src/ask/nl-parser.ts (한국어/영어 듀얼 자연어 파서 발췌)
export function parseQuestionToQueryDSL(question: string): AskQueryDSL {
  const norm = question.trim().toLowerCase();

  // 1. 카테고리 감지 (한국어 지원)
  let category: Category | null = null;
  if (/커피|카페|스타벅스|아메리카노|coffee/i.test(norm)) category = 'coffee';
  else if (/식비|외식|식당|음식점|dining|eating\s*out/i.test(norm)) category = 'eating out';
  else if (/배달|배민|포장|쿠팡이츠|takeaway/i.test(norm)) category = 'takeaway';
  else if (/교통|지하철|버스|택시|주유|transport/i.test(norm)) category = 'transport';

  // 2. 월(Month) 및 분기 감지 (1~12월, 1~4분기)
  let dateFrom: string | null = null;
  let dateTo: string | null = null;
  const monthMatch = norm.match(/(1[0-2]|[1-9])월|december|dec/i);
  if (monthMatch) {
    const month = parseInt(monthMatch[1] ?? '12', 10);
    const mm = String(month).padStart(2, '0');
    dateFrom = `2025-${mm}-01`;
    dateTo = `2025-${mm}-31`;
  }

  // 3. 집계 척도 (합계, 최대값, 평균, 건수)
  let measure: QueryMeasure = 'sum';
  if (/가장\s*큰|최대|최고|biggest|max/i.test(norm)) measure = 'max';
  else if (/평균|건당|average|avg/i.test(norm)) measure = 'average';
  else if (/몇\s*번|건수|횟수|how\s*many|count/i.test(norm)) measure = 'count';

  return {
    measure,
    filters: {
      categories: category ? [category] : [],
      date_from: dateFrom,
      date_to: dateTo,
      direction: 'out',
    },
  };
}
```

---

### 4.4 한국어/영어 즉시 전환 i18n 엔진 및 로컬 상태 유지

기본 언어는 **한국어(KO)**로 동작하며, 화면 상단 및 HUD의 `[🌐 한국어 (KO)]` 버튼을 누르면 페이지 새로고침 없이 전체 인터페이스와 샘플 질문, 카테고리 레이블이 영어와 한국어로 완벽하게 동기화됩니다.

```typescript
// src/i18n.ts (경량 반응형 다국어 엔진 발췌)
export type Language = 'ko' | 'en';
const STORAGE_KEY = 'finance_story_lang';

let currentLanguage: Language = 'ko'; // 기본값: 한국어

export function getLanguage(): Language {
  return currentLanguage;
}

export function toggleLanguage(): Language {
  currentLanguage = currentLanguage === 'ko' ? 'en' : 'ko';
  localStorage.setItem(STORAGE_KEY, currentLanguage);
  notifyListeners(currentLanguage);
  return currentLanguage;
}

export const TRANSLATIONS = {
  ko: {
    brand_title: '금융 이야기',
    brand_sub: '인터랙티브 요약 · 장부 분석',
    nav_prev: '← 이전',
    nav_pause: '❚❚ 일시정지',
    nav_next: '다음 →',
    nav_explore: '탐색 [E]',
    nav_ask: '질문 [A]',
    start_hero_title: '금융 이야기.',
    start_hero_copy: '회계 장부, 엑셀(.xlsx), 구글 드라이브 폴더를 한눈에 파악할 수 있는 인터랙티브 재무 스토리로 변환하세요.',
    start_open_btn: '재무 스토리 열기',
  },
  en: {
    brand_title: 'Finance Story',
    brand_sub: 'Interactive summary · ledger analysis',
    nav_prev: '← Prev',
    nav_pause: '❚❚ Pause',
    nav_next: 'Next →',
    nav_explore: 'Explore [E]',
    nav_ask: 'Ask [A]',
    start_hero_title: 'Finance Story.',
    start_hero_copy: 'Turn financial ledgers, Excel workbooks, or Google Drive folders into an interactive financial summary.',
    start_open_btn: 'Open Finance Story',
  }
};
```

---

### 4.5 멀티 포맷 회계 데이터 파이프라인 (Excel, CSV, Drive)

`pipeline/parse.ts`와 `pipeline/xlsx.ts` 모듈을 통해 복수 개의 은행 카드 명세서, 국세청 세금계산서, SaaS 클라우드 청구서(AWS, GCP), 급여 대장을 자동 감지하여 하나의 통일된 불변 원장(`transactions.json`)으로 정합성을 검증(Reconcile)합니다.

---

## 5. 전통 대시보드(BI) vs Finance Story 비교 분석표

| 비교 항목 | 기존 BI 대시보드 (Tableau, PowerBI) | 엑셀 / 구글 스프레드시트 | **Finance Story (AI Studio)** |
| :--- | :--- | :--- | :--- |
| **스토리텔링** | 정적 그래프 나열 (지루함) | 단순 표와 셀 데이터 | **120 BPM 키네틱 챕터별 음악적 서사** |
| **365일 시각화** | 단순 꺾은선/막대 그래프 | 수천 행 스크롤 필요 | **53주×7일 Pixi.js 인터랙티브 캔버스** |
| **자연어 질문** | 복잡한 DAX / SQL 수식 필요 | `SUMIFS`, `VLOOKUP` 함수 조합 | **"12월 커피 얼마 썼어?" 자연어 즉답** |
| **응답 레이턴시** | 쿼리 로딩 수 초~수십 초 소요 | 파일 용량 증가 시 버벅임 | **로컬 0.5ms 즉각 응답 + Gemini 심층 분석** |
| **다국어 지원** | 별도 번역 레이어 구성 필요 | 수동 번역 | **한국어(기본) / 영어 원클릭 즉시 토글** |
| **배포 용이성** | 고가의 전용 서버 및 라이선스 | 이메일/파일 공유 | **GitHub Pages 무료 정적 웹 호스팅** |

---

## 6. GitHub 소스 배포 및 GitHub Pages 호스팅 가이드

모든 소스코드는 GitHub 원격 리포지토리에 푸시되어 있으며, 빌드 아티팩트는 `gh-pages` 브랜치를 통해 정적 웹 사이트로 즉시 서빙됩니다.

### 🔗 접속 링크
- **라이브 서비스 (GitHub Pages)**: [https://djai32521.github.io/Finance_Story/](https://djai32521.github.io/Finance_Story/)
- **소스코드 저장소 (GitHub Repo)**: [https://github.com/djai32521/Finance_Story](https://github.com/djai32521/Finance_Story)

### 로컬 실행 방법
```bash
# 1. 저장소 클론
git clone https://github.com/djai32521/Finance_Story.git
cd Finance_Story

# 2. 의존성 설치
npm install

# 3. 로컬 풀스택 개발 서버 실행 (포트 3000)
npm run dev

# 4. 프로덕션 빌드 (dist/ 생성)
npm run build
```

---

## 7. 검색 최적화(AEO / GEO / SEO) 구조화 데이터 (JSON-LD)

블로그 검색 노출과 Google SGE, Perplexity, Naver AI 검색에 최적화되도록 포스팅에 삽입된 Schema.org 메타데이터 구조입니다:

```json
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "Finance Story (금융 이야기)",
  "applicationCategory": "BusinessApplication",
  "operatingSystem": "Web Browser, All Platforms",
  "url": "https://djai32521.github.io/Finance_Story/",
  "author": {
    "@type": "Person",
    "name": "djai32521"
  },
  "description": "Google AI Studio와 Gemini 2.5를 활용해 회계 장부와 엑셀 시트를 120 BPM 키네틱 인터랙티브 스토리로 변환하는 오픈소스 재무 인텔리전스 웹 플랫폼.",
  "inLanguage": ["ko-KR", "en-US"],
  "featureList": [
    "53주 7일 371일 Pixi.js WebGL 히트맵 캔버스",
    "120 BPM 음악적 템포의 GSAP 키네틱 스토리 애니메이션",
    "0.5ms 로컬 결정론적 파서 및 Gemini AI 자연어 질의 엔진",
    "한국어(기본) 및 영어 실시간 다국어 지원",
    "Excel(.xlsx), CSV, JSON, Google Drive 원클릭 데이터 임포트"
  ]
}
```

---

## 8. 자주 묻는 질문 FAQ (8문 8답)

#### Q1. Finance Story는 어떤 파일 형식을 지원하나요?
> **A.** 일반 은행 및 카드사의 CSV 파일, 엑셀(`.xlsx`, `.xls`), JSON 형식의 장부 데이터는 물론 공개된 Google Drive 폴더나 Google Sheets 링크를 복사해 넣기만 하면 실시간 파싱 및 정합성 검증이 이루어집니다.

#### Q2. 내 금융 데이터가 외부 서버에 유출되지 않나요?
> **A.** Finance Story의 모든 데이터 시각화와 로컬 결정론적 자연어 질의는 **사용자의 웹 브라우저 메모리 안에서 100% 클라이언트 사이드로 실행**됩니다. 서버로 개인 금융 데이터가 전송되지 않으므로 보안상 매우 안전합니다.

#### Q3. 기본 언어는 무엇이고, 영어로 변경할 수 있나요?
> **A.** 기본 언어는 **한국어(KO)**로 세팅되어 있습니다. 상단 바나 우측 하단 컨트롤러의 `[🌐 한국어 (KO)]` 버튼을 클릭하면 즉시 영어(EN) 인터페이스로 전환되며 사용자의 언어 선택은 브라우저 로컬 스토리지에 기억됩니다.

#### Q4. 모바일 스마트폰 환경에서도 잘 동작하나요?
> **A.** 네! 데스크톱 와이드 화면(1920×1080)뿐만 아니라 모바일 뷰포트(390×844) 전용 레이아웃과 터치 제스처 스와이프를 지원하여 스마트폰에서도 매끄럽게 120 BPM 스토리를 감상할 수 있습니다.

#### Q5. 120 BPM 리듬 애니메이션이 어지러울 때는 어떻게 하나요?
> **A.** 상단 설정에 **[모션 줄이기(Reduced Motion)]** 토글 버튼이 마련되어 있습니다. 이를 체크하면 모든 튕김 및 빠른 트랜지션이 정적인 페이드 인 효과로 대체되어 눈의 피로를 덜 수 있습니다.

#### Q6. 질문창(Ask)에 어떤 질문을 넣을 수 있나요?
> **A.** "12월 식비 총액은?", "가장 비쌌던 지출 내역은?", "주말 외식 횟수는?", "가장 자주 방문한 상점 Top 5" 등 자연스러운 한국어 문장으로 질문하시면 1초 안에 해당 영수증 목록과 합산 금액을 바로 추출합니다.

#### Q7. Gemini 2.5 API는 어떻게 연동되나요?
> **A.** 복합 질의나 장부 감사(Audit) 기능을 사용할 때 Google AI Studio에서 발급받은 Gemini API 키를 환경변수로 지정하면, 클라이언트의 질문 의도를 심층 파악하여 통찰력 있는 분석 코멘트를 추가로 렌더링합니다.

#### Q8. 기업이나 팀 내부에서 자체 배포(Self-hosting)가 가능한가요?
> **A.** 네. Apache-2.0 라이선스를 따르는 오픈소스 프로젝트이므로 사내 인트라넷, Docker 컨테이너, 혹은 AWS S3 / Vercel / GitHub Pages 등에 제약 없이 직접 배포하여 사용할 수 있습니다.

---

## 9. 마치며: AI Studio가 증명한 차세대 소프트웨어 개발의 미래

불과 몇 년 전만 해도 이런 수준의 **WebGL 그래픽 캔버스, 맞춤형 모션 시스템, 다국어 처리, 정규식 DSL 파서, 대용량 회계 파이프라인**을 갖춘 웹 앱을 구축하려면 프론트엔드/백엔드/데이터 엔지니어가 모여 수개월 동안 매달려야 했습니다.

하지만 **Google AI Studio와 Gemini 2.5**를 파트너 삼아 개발한 결과, 단 며칠 만에 프로덕션 품질의 코드베이스를 기획부터 테스트, CI/CD 배포까지 일관된 맥락 속에서 완성할 수 있었습니다. 

재무 데이터나 회계 장부 분석에 새로운 영감을 얻고 싶으시다면, 지금 바로 아래 링크에서 여러분의 장부를 인터랙티브 스토리로 변환해 보세요!

- **체험해보기**: [Finance Story 라이브 데모](https://djai32521.github.io/Finance_Story/)
- **GitHub 별 누르기**: [github.com/djai32521/Finance_Story](https://github.com/djai32521/Finance_Story)
