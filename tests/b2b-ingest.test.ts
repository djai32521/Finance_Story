import fs from 'node:fs';
import path from 'node:path';
import gsap from 'gsap';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DatasetBundle, RawIngestFile } from '../contracts/index.js';
import {
  applyGeminiEnrichmentToBundle,
  ingestFilesDeterministically,
  verifyFactPlaceholders,
} from '../pipeline/ingest-business.js';
import { parseUniversalBusinessData } from '../pipeline/parse.js';
import {
  CANDIDATE_BASE_AGENTS,
  CANDIDATE_MODELS,
  DEFAULT_AGENT_ID,
  DEFAULT_MODEL_NAME,
  loadServerConfig,
} from '../server/config.js';
import { listDriveFolder, parseDriveUrl } from '../server/drive.js';
import { createAskHttpServer } from '../server/index.js';
import { extractInteractionText } from '../server/managed-agent.js';
import { answerQuestionDeterministically } from '../src/ask/index.js';
import { registerBespokeChapters } from '../src/chapters/bespoke/index.js';
import { StoryPlayer } from '../src/player/story-player.js';

const SAMPLE_SAAS_B2B_CSV = `Invoice Date,Vendor,Department,Description,Amount,Currency
2025-01-05,Stripe Enterprise Settlement,Revenue & ARR,Enterprise Annual Subscription Cohort Q1,185000.00,USD
2025-01-12,Amazon Web Services,Cloud & Infrastructure,AWS Production Cluster Jan,"($14,200.00)",USD
2025-01-18,Snowflake,Cloud & Infrastructure,Snowflake Data Warehouse Compute,-6400.00,USD
2025-02-05,Stripe Enterprise Settlement,Revenue & ARR,Enterprise Subscription Settlement Feb,192000.00,USD
2025-02-12,Amazon Web Services,Cloud & Infrastructure,AWS Production Cluster Feb,-14800.00,USD
2025-02-19,Snowflake,Cloud & Infrastructure,Snowflake Data Warehouse Compute,-6800.00,USD
2025-03-05,Stripe Enterprise Settlement,Revenue & ARR,Enterprise Subscription Settlement Mar,210000.00,USD
2025-03-12,Amazon Web Services,Cloud & Infrastructure,AWS GPU Cluster Scale-Up,-16500.00,USD
2025-03-22,Datadog,Cloud & Infrastructure,Observability Enterprise Annual,-4900.00,USD
2025-04-10,Nvidia Enterprise,AI CapEx & Hardware,H100 Rack Cluster Deposit,-48000.00,USD
2025-05-12,Amazon Web Services,Cloud & Infrastructure,AWS Production Cluster May,-15200.00,USD
2025-05-18,Snowflake,Cloud & Infrastructure,Snowflake Data Warehouse Compute,-7100.00,USD
2025-06-15,Nvidia Enterprise,AI CapEx & Hardware,H100 Rack Cluster Final Tranche,-72000.00,USD
2025-07-12,Amazon Web Services,Cloud & Infrastructure,AWS Production Cluster Jul,-15900.00,USD
2025-08-14,WeWork Enterprise,Facilities & Real Estate,HQ Floor Lease Q3,-24000.00,USD
2025-09-12,Amazon Web Services,Cloud & Infrastructure,AWS Production Cluster Sep,-16100.00,USD
2025-10-04,Stripe Enterprise Settlement,Revenue & ARR,Enterprise Q4 Expansion Cohort,265000.00,USD
2025-10-12,Amazon Web Services,Cloud & Infrastructure,AWS Q4 Peak Compute,-18400.00,USD
2025-10-15,Snowflake,Cloud & Infrastructure,Snowflake Q4 Analytics Surge,-8900.00,USD
2025-10-18,Deloitte Tax & Audit,Legal & Advisory,SOC2 & Annual Financial Audit,-22500.00,USD
2025-11-12,Amazon Web Services,Cloud & Infrastructure,AWS Production Cluster Nov,-17200.00,USD
2025-12-12,Amazon Web Services,Cloud & Infrastructure,AWS Production Cluster Dec,-17900.00,USD
`;

describe('B2B Annual Report Pivot, AI Studio Server & Argon/Barium Managed Agent Verification', () => {
  it('configures antigravity-preview-09-2026 and gemini-4-argon as the primary Managed Agent & model cascade', () => {
    expect(DEFAULT_AGENT_ID).toBe('antigravity-preview-09-2026');
    expect(DEFAULT_MODEL_NAME).toBe('gemini-4-argon');
    expect(CANDIDATE_BASE_AGENTS[0]).toBe('antigravity-preview-09-2026');
    expect(CANDIDATE_MODELS[0]).toBe('gemini-4-argon');
    expect(CANDIDATE_MODELS).toContain('gemini-4-argon');
    expect(CANDIDATE_MODELS).toContain('gemini-3.8-flash');
    expect(CANDIDATE_MODELS).toContain('gemini-3-flash-preview');

    const extracted = extractInteractionText({
      steps: [
        {
          type: 'model_output',
          content: [
            {
              type: 'text',
              text: '{"agent_audit_notes": ["Verified 100% double-entry ledger tie-out across all Q1-Q4 settlements."]}',
            },
          ],
        },
      ],
    });
    expect(extracted).toContain('agent_audit_notes');
  });

  it('parses arbitrary B2B CSV ledgers and generates a 100% fact-verified B2B StoryPlan + DatasetBundle', () => {
    const parsed = parseUniversalBusinessData(SAMPLE_SAAS_B2B_CSV, 'acme_cloud_fy2025.csv');
    expect(parsed.rows.length).toBe(22);

    const files: RawIngestFile[] = [
      {
        name: 'acme_cloud_fy2025.csv',
        content: SAMPLE_SAAS_B2B_CSV,
        mimeType: 'text/csv',
      },
    ];

    const bundle = ingestFilesDeterministically(files, {
      entityName: 'Acme Cloud Corp',
      isB2B: true,
    });

    expect(bundle.transactions.length).toBe(22);
    expect(bundle.days.length).toBe(365);
    expect(bundle.plan.person_name).toBe('Acme Cloud Corp');
    expect(bundle.plan.business_meta).toBeDefined();
    expect(bundle.plan.business_meta?.archetype).toBe('saas_arr');
    expect(bundle.plan.sample_questions?.length).toBeGreaterThanOrEqual(4);

    // Verify procedural B2B facts exist and have non-empty txn_ids
    const factMap = new Map(bundle.facts.map((f) => [f.id, f]));
    expect(factMap.get('total_inflow_usd')?.value).toBeGreaterThan(0);
    expect(factMap.get('studio_total_with_gear_spend')?.value).toBeGreaterThan(0);
    expect(factMap.get('top_merchant_name')?.formatted).toBe('AWS');
    expect(factMap.get('second_coffee_merchant_name')?.formatted).toBe('Snowflake');

    // Verify strict Rule 1 & Rule 2: zero raw digits outside {fact:id} placeholders across the entire B2B StoryPlan
    const oneLineCheck = verifyFactPlaceholders(bundle.plan.one_line, factMap, '');
    expect(oneLineCheck.valid).toBe(true);

    const subCheck = verifyFactPlaceholders(bundle.plan.personality.subtitle, factMap, '');
    expect(subCheck.valid).toBe(true);

    for (const ch of bundle.plan.chapters) {
      if (ch.headline) {
        const hCheck = verifyFactPlaceholders(ch.headline, factMap, '');
        expect(hCheck.valid).toBe(true);
      }
      if (ch.body) {
        const bCheck = verifyFactPlaceholders(ch.body, factMap, '');
        expect(bCheck.valid).toBe(true);
      }
    }
  });

  it('answers natural-language B2B vendor, category_label, and quarterly questions deterministically', () => {
    const bundle = ingestFilesDeterministically(
      [
        {
          name: 'acme_cloud_fy2025.csv',
          content: SAMPLE_SAAS_B2B_CSV,
          mimeType: 'text/csv',
        },
      ],
      { entityName: 'Acme Cloud Corp', isB2B: true }
    );

    const awsRes = answerQuestionDeterministically(
      'How much did we spend at Amazon Web Services?',
      bundle.transactions
    );
    expect(awsRes.answerable).toBe(true);
    expect(awsRes.query.filters.merchants).toContain('AWS');
    expect(awsRes.matching_txn_ids.length).toBe(9);
    expect(awsRes.value_minor).toBeGreaterThan(1000000);

    const q4Res = answerQuestionDeterministically(
      'How much did we spend in Q4?',
      bundle.transactions
    );
    expect(q4Res.answerable).toBe(true);
    expect(q4Res.query.filters.date_from).toBe('2025-10-01');
    expect(q4Res.query.filters.date_to).toBe('2025-12-31');
    expect(q4Res.matching_txn_ids.length).toBe(5);
  });

  it('parses Google Drive folder, file, and Google Sheets URLs accurately', async () => {
    const sheetParsed = parseDriveUrl(
      'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0'
    );
    expect(sheetParsed).toEqual({
      kind: 'sheet',
      id: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
    });

    const folderParsed = parseDriveUrl(
      'https://drive.google.com/drive/folders/1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p?usp=sharing'
    );
    expect(folderParsed).toEqual({
      kind: 'folder',
      id: '1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p',
    });

    const sheetListing = await listDriveFolder(
      'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit'
    );
    expect(sheetListing.source).toBe('sheets_export');
    expect(sheetListing.files).toHaveLength(1);
    expect(sheetListing.files[0]?.downloadUrl).toContain('export?format=csv');
  });

  it('serves /api/ingest/enrich, /api/agent/analyze, and /api/dataset/active over HTTP', async () => {
    const cfg = {
      ...loadServerConfig(),
      apiKey: null,
      hasApiKey: false,
    };
    const server = createAskHttpServer({ config: cfg });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const agentRes = await fetch(`${baseUrl}/api/agent/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entity_name_hint: 'Acme Cloud Corp',
          files: [
            {
              name: 'acme_cloud_fy2025.csv',
              content: SAMPLE_SAAS_B2B_CSV,
              mimeType: 'text/csv',
            },
          ],
        }),
      });
      expect(agentRes.status).toBe(200);
      const agentJson = (await agentRes.json()) as {
        source: string;
        agent_steps: string[];
        bundle: {
          plan: { person_name: string };
          transactions: unknown[];
        };
      };
      expect(agentJson.source).toBe('managed_agent');
      expect(agentJson.agent_steps.length).toBeGreaterThanOrEqual(3);
      expect(agentJson.bundle.plan.person_name).toBe('Acme Cloud Corp');
      expect(agentJson.bundle.transactions.length).toBe(22);

      // Verify that active dataset on the server was automatically updated to Acme Cloud Corp (22 txns)
      const askRes = await fetch(`${baseUrl}/api/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: 'How much did we spend at Amazon Web Services?',
        }),
      });
      expect(askRes.status).toBe(200);
      const askJson = (await askRes.json()) as {
        answerable: boolean;
        matching_txn_ids: string[];
      };
      expect(askJson.answerable).toBe(true);
      expect(askJson.matching_txn_ids.length).toBe(9);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      );
    }
  });

  it('applies Gemini narrative overrides and Managed Agent audit notes while rejecting any raw un-sourced digits', () => {
    const files: RawIngestFile[] = [
      {
        name: 'acme_cloud_fy2025.csv',
        content: SAMPLE_SAAS_B2B_CSV,
        mimeType: 'text/csv',
      },
    ];
    const baseBundle = ingestFilesDeterministically(files, {
      entityName: 'Acme Cloud Corp',
      isB2B: true,
    });
    const rawRows = baseBundle.transactions.map((t) => t.source_row);

    const enrichedBundle = applyGeminiEnrichmentToBundle(
      rawRows,
      files,
      {
        source: 'managed_agent',
        model_used: 'gemini-4-argon',
        narrative: {
          entity_name: 'Acme Cloud Holdings',
          archetype: 'saas_arr',
          one_line:
            'In {fact:year_number}, Acme Cloud Holdings deployed {fact:total_spend_usd} across {fact:total_transactions_count} ledger movements against {fact:total_inflow_usd} in enterprise ARR.',
          // Intentionally pass a bad headline with a raw digit to verify that verifyFactPlaceholders rejects it and preserves the verified fallback!
          chapter_copy: {
            pour: {
              headline: 'We grew 42% in 2025 with raw unverified numbers',
              body: 'Across {fact:total_transactions_count} movements and {fact:total_spend_usd} in operating outflows, {fact:top_merchant_name} led recurring vendor settlements.',
            },
          },
          agent_audit_notes: [
            'Reconciled gross inflows against operating outflows with zero double-entry variance.',
          ],
          generated_by: 'managed_agent',
        },
      },
      'Acme Cloud Corp'
    );

    expect(enrichedBundle.plan.person_name).toBe('Acme Cloud Holdings');
    expect(enrichedBundle.plan.business_meta?.generated_by).toBe('managed_agent');
    expect(enrichedBundle.plan.business_meta?.agent_audit_notes).toHaveLength(1);
    const pourChapter = enrichedBundle.plan.chapters.find((c) => c.id === 'pour')!;
    // The raw-digit headline was rejected and kept the verified {fact:id} headline, while the valid {fact:id} body was applied
    expect(pourChapter.headline).not.toContain('42%');
    expect(pourChapter.body).toContain('{fact:total_transactions_count}');
  });

  it('ingests the 505-row sample_b2b_data/nimbus_cloud_saas_fy2025.csv and 3-file multi_table_cfo_audit bundle cleanly', () => {
    const sampleDir = path.resolve(process.cwd(), '..', 'sample_b2b_data');
    const singleCsvPath = path.join(sampleDir, 'nimbus_cloud_saas_fy2025.csv');
    if (!fs.existsSync(singleCsvPath)) return;

    const singleContent = fs.readFileSync(singleCsvPath, 'utf8');
    const singleBundle = ingestFilesDeterministically(
      [{ name: 'nimbus_cloud_saas_fy2025.csv', content: singleContent, mimeType: 'text/csv' }],
      { entityName: 'Nimbus AI Cloud Corp', isB2B: true }
    );
    expect(singleBundle.transactions.length).toBe(505);
    expect(singleBundle.plan.chapters.length).toBeGreaterThanOrEqual(10);

    const multiDir = path.join(sampleDir, 'multi_table_cfo_audit');
    const multiFiles: RawIngestFile[] = [
      {
        name: '01_revenue_and_arr_settlements_2025.csv',
        content: fs.readFileSync(
          path.join(multiDir, '01_revenue_and_arr_settlements_2025.csv'),
          'utf8'
        ),
        mimeType: 'text/csv',
      },
      {
        name: '02_cloud_and_opex_ledger_2025.csv',
        content: fs.readFileSync(path.join(multiDir, '02_cloud_and_opex_ledger_2025.csv'), 'utf8'),
        mimeType: 'text/csv',
      },
      {
        name: '03_capex_and_treasury_2025.json',
        content: fs.readFileSync(path.join(multiDir, '03_capex_and_treasury_2025.json'), 'utf8'),
        mimeType: 'application/json',
      },
    ];
    const multiBundle = ingestFilesDeterministically(multiFiles, {
      entityName: 'Nimbus AI Cloud Corp',
      isB2B: true,
    });
    expect(multiBundle.transactions.length).toBe(505);
  });

  it('ingests .xlsx Excel workbooks (including multi-tab trading logs with merged title rows, serial dates & subtotals)', () => {
    const sampleDir = path.resolve(process.cwd(), '..', 'sample_b2b_data');
    const nimbusXlsxPath = path.join(sampleDir, 'nimbus_cloud_saas_fy2025.xlsx');
    if (fs.existsSync(nimbusXlsxPath)) {
      const b64 = fs.readFileSync(nimbusXlsxPath).toString('base64');
      const nimbusBundle = ingestFilesDeterministically([
        {
          name: 'nimbus_cloud_saas_fy2025.xlsx',
          content: b64,
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          encoding: 'base64',
        },
      ]);
      expect(nimbusBundle.transactions.length).toBe(505);
      expect(nimbusBundle.plan.person_name).toBe('Nimbus Cloud SaaS');
    }

    const northbankPath = path.resolve(
      process.cwd(),
      '..',
      '..',
      'knowledge_work',
      'sample_data_sheets',
      'northbank_coffee_2025-26.xlsx'
    );
    if (fs.existsSync(northbankPath)) {
      const b64 = fs.readFileSync(northbankPath).toString('base64');
      const nbBundle = ingestFilesDeterministically([
        {
          name: 'northbank_coffee_2025-26.xlsx',
          content: b64,
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          encoding: 'base64',
        },
      ]);
      expect(nbBundle.plan.person_name).toBe('Northbank Coffee');
      expect(nbBundle.plan.business_meta?.fiscal_period_label).toBe('FY 2025–26');
      expect(nbBundle.plan.business_meta?.currency_symbol).toBe('£');
      expect(nbBundle.plan.chapters[0]?.params.blocks?.[0]?.unit_sup).toBe('£');
      expect(nbBundle.days.length).toBe(365);
      expect(nbBundle.days[0]?.date).toBe('2025-10-01');
      expect(nbBundle.days[364]?.date).toBe('2026-09-30');
      const totalFact = nbBundle.facts.find((f) => f.id === 'total_spend_usd');
      expect(totalFact?.value).toBe(225162500);
      const studioMonthsFact = nbBundle.facts.find((f) => f.id === 'studio_months_span');
      expect(Number(studioMonthsFact?.value)).toBeGreaterThan(0);
      const octFact = nbBundle.facts.find((f) => f.id === 'october_spend_usd');
      expect(Number(octFact?.value)).toBeGreaterThan(0);
      const decFact = nbBundle.facts.find((f) => f.id === 'december_bonus_pay_usd');
      expect(Number(decFact?.value)).toBeGreaterThan(0);
      const janFact = nbBundle.facts.find((f) => f.id === 'jan_tech_spend');
      expect(Number(janFact?.value)).toBeGreaterThan(0);

      const mayRes = answerQuestionDeterministically(
        'How much did we spend in May?',
        nbBundle.transactions
      );
      expect(mayRes.answerable).toBe(true);
      expect(mayRes.query.filters.date_from).toBe('2026-05-01');
      expect(mayRes.matching_txn_ids.length).toBeGreaterThan(0);
    }
  });
});

/**
 * Lightweight DOM & Window implementation for mounting StoryPlayer and all 13 chapters
 * in Node Vitest environment without external browser dependencies.
 */
class TestDomElement {
  public tagName: string;
  public id = '';
  private _className = '';
  public style: Record<string, string> & {
    setProperty: (k: string, v: string) => void;
    getPropertyValue: (k: string) => string;
  };
  public dataset: Record<string, string> = {};
  public attributes = new Map<string, string>();
  public children: TestDomElement[] = [];
  public parentElement: TestDomElement | null = null;
  public checked = false;
  public value = '';
  public type = '';
  public disabled = false;
  public files: FileList | null = null;
  public width = 1920;
  public height = 1080;
  public clientWidth = 1920;
  public clientHeight = 1080;
  public scrollWidth = 400;
  public scrollHeight = 120;
  public offsetWidth = 1920;
  public offsetHeight = 60;
  public autoAlpha = 1;
  public opacity = 1;
  public color = '#1C1C1B';
  public clipPath = 'none';
  public scaleX = 1;
  public scaleY = 1;
  public x = 0;
  public y = 0;
  public yPercent = 0;
  public transformOrigin = '50% 50%';
  private _rawHtml = '';
  private _text = '';
  private listeners = new Map<string, Array<(e: unknown) => void>>();

  public readonly classList = {
    add: (...tokens: string[]) => {
      const set = new Set(this.classListArray());
      tokens.forEach((t) => set.add(t));
      this._className = Array.from(set).join(' ');
    },
    remove: (...tokens: string[]) => {
      const set = new Set(this.classListArray());
      tokens.forEach((t) => set.delete(t));
      this._className = Array.from(set).join(' ');
    },
    contains: (token: string) => this.classListArray().includes(token),
    toggle: (token: string, force?: boolean) => {
      const has = this.classListArray().includes(token);
      const next = force ?? !has;
      if (next) this.classList.add(token);
      else this.classList.remove(token);
      return next;
    },
  };

  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    const rawStyle: Record<string, unknown> = {};
    const onCssText = (val: string) => this.parseStyleString(val);
    this.style = new Proxy(rawStyle, {
      get(target, prop: string) {
        if (prop === 'setProperty') {
          return (k: string, v: string) => {
            target[k] = v;
          };
        }
        if (prop === 'getPropertyValue') {
          return (k: string) => String(target[k] ?? '');
        }
        return target[prop] ?? '';
      },
      set(target, prop: string, val: string) {
        target[prop] = val;
        if (prop === 'cssText' && typeof val === 'string') {
          onCssText(val);
        }
        return true;
      },
    }) as TestDomElement['style'];
  }

  public get className(): string {
    return this._className;
  }

  public set className(val: string) {
    this._className = val;
  }

  private classListArray(): string[] {
    return this._className.split(/\s+/).filter(Boolean);
  }

  public get firstElementChild(): TestDomElement | null {
    return this.children[0] ?? null;
  }

  public get lastElementChild(): TestDomElement | null {
    return this.children[this.children.length - 1] ?? null;
  }

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === 'id') this.id = value;
    else if (name === 'class') this._className = value;
    else if (name === 'style') this.parseStyleString(value);
    else if (name === 'type') this.type = value;
    else if (name === 'value') this.value = value;
    else if (name === 'checked') this.checked = value !== 'false';
    else if (name.startsWith('data-')) {
      const camel = name.slice(5).replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
      this.dataset[camel] = value;
    }
  }

  public getAttribute(name: string): string | null {
    if (name === 'id' && this.id) return this.id;
    if (name === 'class' && this._className) return this._className;
    return this.attributes.get(name) ?? null;
  }

  public parseStyleString(css: string): void {
    css.split(';').forEach((part) => {
      const idx = part.indexOf(':');
      if (idx > 0) {
        const rawKey = part.slice(0, idx).trim();
        const camelKey = rawKey.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
        const v = part.slice(idx + 1).trim();
        this.style[rawKey] = v;
        this.style[camelKey] = v;
        if (camelKey === 'width' && v.endsWith('px')) {
          const parsed = Number.parseFloat(v);
          if (!Number.isNaN(parsed)) this.clientWidth = parsed;
        }
        if (camelKey === 'height' && v.endsWith('px')) {
          const parsed = Number.parseFloat(v);
          if (!Number.isNaN(parsed)) this.clientHeight = parsed;
        }
      }
    });
  }

  public get innerHTML(): string {
    if (this._rawHtml) return this._rawHtml;
    if (this.children.length > 0) {
      return this.children.map((c) => c.outerHTML).join('');
    }
    return this._text;
  }

  public set innerHTML(html: string) {
    this._rawHtml = html;
    this._text = html.replace(/<[^>]+>/g, '');
    this.children = [];
    if (html.trim().length > 0) {
      parseTestHtmlInto(this, html);
    }
  }

  public get outerHTML(): string {
    const tag = this.tagName.toLowerCase();
    const cls = this._className ? ` class="${this._className}"` : '';
    const idAttr = this.id ? ` id="${this.id}"` : '';
    const dataAttrs = Object.entries(this.dataset)
      .map(([k, v]) => ` data-${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}="${v}"`)
      .join('');
    return `<${tag}${idAttr}${cls}${dataAttrs}>${this.innerHTML}</${tag}>`;
  }

  public get textContent(): string {
    if (this.children.length > 0 && !this._rawHtml) {
      return this.children.map((c) => c.textContent).join('');
    }
    return this._text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&nbsp;/g, ' ');
  }

  public set textContent(txt: string) {
    this._text = txt;
    this._rawHtml = txt;
    this.children = [];
  }

  public appendChild(child: TestDomElement): TestDomElement {
    this._rawHtml = '';
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  public getContext(): Record<string, unknown> {
    return {
      fillStyle: '#000',
      strokeStyle: '#000',
      lineWidth: 1,
      font: '12px sans-serif',
      textAlign: 'left',
      textBaseline: 'alphabetic',
      globalAlpha: 1,
      clearRect: () => {},
      fillRect: () => {},
      strokeRect: () => {},
      beginPath: () => {},
      closePath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      quadraticCurveTo: () => {},
      bezierCurveTo: () => {},
      arc: () => {},
      rect: () => {},
      fill: () => {},
      stroke: () => {},
      clip: () => {},
      save: () => {},
      restore: () => {},
      scale: () => {},
      translate: () => {},
      rotate: () => {},
      setTransform: () => {},
      setLineDash: () => {},
      fillText: () => {},
      strokeText: () => {},
      measureText: (txt: string) => ({ width: String(txt ?? '').length * 14 }),
      getImageData: (_x: number, _y: number, w = 16, h = 16) => ({
        data: new Uint8ClampedArray(Math.min(w * h * 4, 4096)),
      }),
      putImageData: () => {},
      createLinearGradient: () => ({ addColorStop: () => {} }),
      drawImage: () => {},
    };
  }

  public getBoundingClientRect(): {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
    x: number;
    y: number;
  } {
    return {
      left: 0,
      top: 0,
      right: 1920,
      bottom: 1080,
      width: 1920,
      height: 1080,
      x: 0,
      y: 0,
    };
  }

  public focus(): void {}
  public blur(): void {}

  public addEventListener(type: string, handler: (e: unknown) => void): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(handler);
    this.listeners.set(type, arr);
  }

  public removeEventListener(type: string, handler: (e: unknown) => void): void {
    const arr = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      arr.filter((fn) => fn !== handler)
    );
  }

  public dispatchEvent(ev: { type?: string }): boolean {
    const arr = this.listeners.get(ev.type ?? '') ?? [];
    arr.forEach((fn) => fn(ev));
    return true;
  }

  public click(): void {
    const arr = this.listeners.get('click') ?? [];
    const ev = { stopPropagation: () => {}, preventDefault: () => {}, target: this };
    arr.forEach((fn) => fn(ev));
  }

  public closest<T = TestDomElement>(selector: string): T | null {
    if (matchesTestSelector(this, selector)) return this as unknown as T;
    let cur = this.parentElement;
    while (cur) {
      if (matchesTestSelector(cur, selector)) return cur as unknown as T;
      cur = cur.parentElement;
    }
    return null;
  }

  public querySelector<T = TestDomElement>(selector: string): T | null {
    return (this.querySelectorAll<T>(selector)[0] ?? null) as T | null;
  }

  public querySelectorAll<T = TestDomElement>(selector: string): T[] {
    const groups = selector
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const out: TestDomElement[] = [];
    const visit = (node: TestDomElement) => {
      for (const child of node.children) {
        if (groups.some((g) => matchesTestSelector(child, g))) {
          out.push(child);
        }
        visit(child);
      }
    };
    visit(this);
    return out as unknown as T[];
  }
}

function matchesSingleTestToken(el: TestDomElement, token: string): boolean {
  if (!token) return false;
  if (token === '*') return true;
  let rest = token;
  let notToken: string | null = null;
  const notMatch = rest.match(/:not\(([^)]+)\)/);
  if (notMatch) {
    notToken = notMatch[1]!;
    rest = rest.replace(notMatch[0], '');
  }
  if (notToken && matchesSingleTestToken(el, notToken)) {
    return false;
  }

  const attrRegex = /\[([a-zA-Z0-9_-]+)(?:=["']?([^"'\]]+)["']?)?\]/g;
  let m: RegExpExecArray | null;
  while ((m = attrRegex.exec(rest)) !== null) {
    const attrName = m[1]!;
    const attrVal = m[2];
    const actual = el.getAttribute(attrName);
    if (actual === null) return false;
    if (attrVal !== undefined && actual !== attrVal) return false;
  }
  const withoutAttrs = rest.replace(attrRegex, '');
  if (!withoutAttrs) return true;

  if (withoutAttrs.startsWith('#')) {
    return el.id === withoutAttrs.slice(1);
  }
  if (withoutAttrs.startsWith('.')) {
    const classes = withoutAttrs.slice(1).split('.');
    return classes.every((c) => el.classList.contains(c));
  }
  if (withoutAttrs.includes('.')) {
    const [tagPart, ...clsParts] = withoutAttrs.split('.');
    if (tagPart && el.tagName.toLowerCase() !== tagPart.toLowerCase()) return false;
    return clsParts.every((c) => el.classList.contains(c));
  }
  return el.tagName.toLowerCase() === withoutAttrs.toLowerCase();
}

function matchesTestSelector(el: TestDomElement, selector: string): boolean {
  const normalized = selector.replace(/\s*>\s*/g, ' > ').trim();
  const parts = normalized.split(/\s+/);
  if (parts.length === 1) {
    return matchesSingleTestToken(el, parts[0]!);
  }
  if (!matchesSingleTestToken(el, parts[parts.length - 1]!)) return false;
  let cur = el.parentElement;
  for (let i = parts.length - 2; i >= 0; i--) {
    const token = parts[i]!;
    if (token === '>') {
      const parentToken = parts[i - 1];
      if (!parentToken || !cur || !matchesSingleTestToken(cur, parentToken)) return false;
      cur = cur.parentElement;
      i -= 1;
      continue;
    }
    while (cur && !matchesSingleTestToken(cur, token)) {
      cur = cur.parentElement;
    }
    if (!cur) return false;
    cur = cur.parentElement;
  }
  return true;
}

const TEST_VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'path', 'line', 'circle', 'rect']);

function parseTestAttributes(el: TestDomElement, attrStr: string): void {
  const re = /([a-zA-Z0-9_:-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrStr)) !== null) {
    const name = m[1]!;
    const val = m[2] ?? m[3] ?? m[4] ?? '';
    el.setAttribute(name, val);
  }
}

function parseTestHtmlInto(root: TestDomElement, html: string): void {
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)(\/?)>/g;
  const stack: TestDomElement[] = [root];
  let m: RegExpExecArray | null;

  while ((m = tagRe.exec(html)) !== null) {
    const full = m[0];
    const isClosing = full.startsWith('</');
    const tagName = m[1]!;
    const attrStr = m[2] ?? '';
    const isSelfClosing =
      m[3] === '/' || TEST_VOID_TAGS.has(tagName.toLowerCase()) || attrStr.trim().endsWith('/');

    const parent = stack[stack.length - 1] ?? root;

    if (!isClosing) {
      const el = new TestDomElement(tagName);
      parseTestAttributes(el, attrStr);
      el.parentElement = parent;
      parent.children.push(el);
      if (!isSelfClosing) {
        (el as unknown as { _innerStart?: number })._innerStart = tagRe.lastIndex;
        stack.push(el);
      }
    } else if (stack.length > 1) {
      const closed = stack.pop()!;
      const innerStart = (closed as unknown as { _innerStart?: number })._innerStart;
      if (innerStart !== undefined) {
        const slice = html.slice(innerStart, m.index);
        (closed as unknown as { _rawHtml: string })._rawHtml = slice;
        (closed as unknown as { _text: string })._text = slice.replace(/<[^>]+>/g, '');
      }
    }
  }
}

class MockKeyboardEvent {
  public readonly type: string;
  public readonly key: string;
  public defaultPrevented = false;
  public target: unknown = null;

  constructor(type: string, init?: { key?: string }) {
    this.type = type;
    this.key = init?.key ?? '';
  }

  public preventDefault(): void {
    this.defaultPrevented = true;
  }

  public stopPropagation(): void {}
}

function setupStoryPlayerTestDom(search = '?byo=1'): {
  rootEl: HTMLElement;
  dispatchWindowKeydown: (key: string) => void;
} {
  gsap.config({ nullTargetWarn: false });
  const headEl = new TestDomElement('head');
  const bodyEl = new TestDomElement('body');
  const docEl = new TestDomElement('html');
  docEl.clientWidth = 1920;
  docEl.clientHeight = 1080;
  const rootEl = new TestDomElement('div');
  rootEl.id = 'app';
  bodyEl.appendChild(rootEl);

  const windowListeners = new Map<string, Array<(e: unknown) => void>>();

  (globalThis as unknown as { KeyboardEvent: unknown }).KeyboardEvent = MockKeyboardEvent;
  (globalThis as unknown as { document: unknown }).document = {
    head: headEl,
    body: bodyEl,
    documentElement: docEl,
    fullscreenElement: null,
    createElement: (tag: string) => new TestDomElement(tag),
    getElementById: (id: string) => {
      if (id === 'app') return rootEl;
      return headEl.querySelector(`#${id}`) ?? bodyEl.querySelector(`#${id}`);
    },
  };

  (globalThis as unknown as { window: unknown }).window = {
    location: { search },
    innerWidth: 1920,
    innerHeight: 1080,
    devicePixelRatio: 1,
    matchMedia: () => ({ matches: true }),
    getComputedStyle: (el: TestDomElement) => ({
      fontSize: el.style.fontSize || '48px',
      lineHeight: el.style.lineHeight || '52px',
    }),
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      const list = windowListeners.get(type) ?? [];
      list.push(fn);
      windowListeners.set(type, list);
    },
    removeEventListener: (type: string, fn: (e: unknown) => void) => {
      const list = windowListeners.get(type) ?? [];
      windowListeners.set(
        type,
        list.filter((item) => item !== fn)
      );
    },
    dispatchEvent: (ev: { type?: string }) => {
      const list = windowListeners.get(ev.type ?? '') ?? [];
      list.forEach((fn) => fn(ev));
      return true;
    },
  };

  return {
    rootEl: rootEl as unknown as HTMLElement,
    dispatchWindowKeydown: (key: string) => {
      const ev = new MockKeyboardEvent('keydown', { key });
      (globalThis.window as unknown as { dispatchEvent: (e: unknown) => void }).dispatchEvent(ev);
    },
  };
}

function buildMultiYear2025To2026B2BCsv(): string {
  const rows: string[] = ['Invoice Date,Vendor,Department,Description,Amount,Currency'];
  const months = [
    '2025-10',
    '2025-11',
    '2025-12',
    '2026-01',
    '2026-02',
    '2026-03',
    '2026-04',
    '2026-05',
    '2026-06',
    '2026-07',
    '2026-08',
    '2026-09',
  ];
  months.forEach((ym, idx) => {
    rows.push(
      `${ym}-02,Stripe UK Settlement Clearing,Revenue & Sales,Monthly Commercial Settlement Cycle ${idx + 1},320000.00,GBP`
    );
    rows.push(
      `${ym}-08,Northbank Coffee Roasters — Southbank Flagship,Inventory & Green Bean Supply,Direct Trade Espresso Roast Lot #${101 + idx},-42500.00,GBP`
    );
    rows.push(
      `${ym}-14,Global Cloud Infrastructure Services Ltd — EMEA Cluster,Cloud & POS Systems,Multi-Region Telemetry & Point-of-Sale Hosting,-18900.00,GBP`
    );
    rows.push(
      `${ym}-19,Metropolitan Commercial Property Management LLP,Premises & Leasehold,Flagship Roastery & Café Quarter Lease,-64000.00,GBP`
    );
    rows.push(
      `${ym}-24,Highland Dairy & Oat Barista Distributors UK,Perishables & Cold Chain,Weekly Chilled Barista Supply Delivery,-14200.00,GBP`
    );
  });
  // Add a 7-day連続 operating deployment streak in May 2026 + large flagship buildout commitment
  for (let d = 10; d <= 16; d++) {
    rows.push(
      `2026-05-${String(d).padStart(2, '0')},Northbank Coffee Roasters — Southbank Flagship,Flagship Roastery Expansion,La Marzocco KB90 & Probat Roaster Commissioning Day ${d - 9},-28500.00,GBP`
    );
  }
  rows.push(
    '2026-05-18,Probat Werke Industrial Roastery Engineering GmbH,Flagship Roastery Expansion,Turnkey P60 Drum Roaster & Afterburner Installation,-241625.00,GBP'
  );
  return rows.join('\n') + '\n';
}

const FORBIDDEN_B2B_COPY_PHRASES = [
  'Longest Coffee Streak',
  'Coastal Getaway',
  'Favourite Coastal Getaway',
  'Ritual calendar',
  'Peak ritual',
  'MERCHANT UNSCRAMBLE',
  'Merchant gibberish',
  'EVERYDAY PURCHASES',
  'ONLY IN YOUR APP',
  'YOU ARE',
  'paydays in orange',
  'Payday vs normal',
  'Payday Spending Multiplier',
  'Top Merchant Visits',
  'SETTLEMENTSS',
  'CLOSESS',
] as const;

const ALL_13_B2B_CHAPTER_KEYS = [
  'pour',
  'year_as_squares',
  'your_place',
  'bespoke_studio',
  'streak',
  'getaway',
  'bespoke_coffee',
  'heartbeat',
  'big_one',
  'shatter',
  'personality',
  'one_line',
  'share_card',
] as const;

describe('End-to-End B2B UI, Copy & Layout Verification (Review Pass 1)', () => {
  beforeAll(() => {
    gsap.config({ nullTargetWarn: false });
  });

  it('1. verifies Landing Screen (#start-screen) B2B copy, removed consumer labels/inputs, and unchecked Deep Agent toggle', () => {
    const { rootEl } = setupStoryPlayerTestDom('?byo=1');
    const initialBundle = ingestFilesDeterministically(
      [
        {
          name: 'acme_cloud_fy2025.csv',
          content: SAMPLE_SAAS_B2B_CSV,
          mimeType: 'text/csv',
        },
      ],
      { entityName: 'Acme Cloud Corp', isB2B: true }
    );

    const player = new StoryPlayer(rootEl, initialBundle);
    registerBespokeChapters(player);

    const startScreen = rootEl.querySelector<HTMLElement>('#start-screen');
    expect(startScreen).not.toBeNull();

    // Title is "Finance Story." and no "Data Story" anywhere
    const heroTitle = rootEl.querySelector<HTMLElement>('#start-hero-title');
    expect(heroTitle?.textContent?.trim()).toBe('Finance Story.');
    expect(rootEl.innerHTML).not.toContain('Data Story');

    // Top-left is "FINANCE STORY · INTERACTIVE SUMMARY" when awaiting BYO upload
    const topLeft = rootEl.querySelector<HTMLElement>('#start-top-left-label');
    expect(topLeft?.textContent?.trim()).toBe('FINANCE STORY · INTERACTIVE SUMMARY');

    // Top-right is "LEDGER ANALYSIS" (no "VERIFIED")
    const topRight = rootEl.querySelector<HTMLElement>('#start-top-right-label');
    expect(topRight?.textContent?.trim()).toBe('LEDGER ANALYSIS');
    expect(topRight?.textContent).not.toContain('VERIFIED');

    // Bottom-left "DEMO TERMS" and bottom-right "DETERMINISTIC ENGINE" are completely gone
    expect(startScreen?.innerHTML).not.toContain('DEMO TERMS');
    expect(startScreen?.innerHTML).not.toContain('DETERMINISTIC ENGINE');

    // #byo-entity-input optional text input is completely gone
    expect(rootEl.querySelector('#byo-entity-input')).toBeNull();

    // #byo-deep-agent-toggle ("Advanced: Deep Agent Audit") is present and unchecked by default
    const deepAgentToggle = rootEl.querySelector<HTMLInputElement>('#byo-deep-agent-toggle');
    expect(deepAgentToggle).not.toBeNull();
    expect(deepAgentToggle?.checked).toBe(false);
    expect(startScreen?.innerHTML).toContain('Advanced: Deep Agent Audit');

    // #byo-upload-disclaimer is present under the upload button with hyperlinks
    const disclaimerEl = rootEl.querySelector<HTMLElement>('#byo-upload-disclaimer');
    expect(disclaimerEl).not.toBeNull();
    expect(disclaimerEl?.textContent).toContain(
      'By using this feature, you confirm that you have the necessary rights to any content that you upload.'
    );
    expect(disclaimerEl?.textContent).toContain(
      'Do not generate content that infringes on others’ intellectual property or privacy rights.'
    );
    expect(disclaimerEl?.textContent).toContain(
      'Your use of this generative AI service is subject to our Prohibited Use Policy.'
    );
    expect(disclaimerEl?.textContent).toContain(
      'Please note that uploads from Google Workspace may be used to develop and improve Google products and services in accordance with our terms.'
    );

    const prohibitedLink = disclaimerEl?.querySelector<HTMLAnchorElement>(
      'a[href="https://policies.google.com/terms/generative-ai/use-policy"]'
    );
    expect(prohibitedLink).not.toBeNull();
    expect(prohibitedLink?.textContent?.trim()).toBe('Prohibited Use Policy');

    const termsLink = disclaimerEl?.querySelector<HTMLAnchorElement>(
      'a[href="https://ai.google.dev/gemini-api/terms"]'
    );
    expect(termsLink).not.toBeNull();
    expect(termsLink?.textContent?.trim()).toBe('terms');

    player.destroy();
  });

  it('2. verifies D/d keyboard shortcut removal and "Upload Data" button labels without [D]', () => {
    const { rootEl, dispatchWindowKeydown } = setupStoryPlayerTestDom('?byo=1');
    const bundle = ingestFilesDeterministically(
      [
        {
          name: 'acme_cloud_fy2025.csv',
          content: SAMPLE_SAAS_B2B_CSV,
          mimeType: 'text/csv',
        },
      ],
      { entityName: 'Acme Cloud Corp', isB2B: true }
    );

    const player = new StoryPlayer(rootEl, bundle);
    registerBespokeChapters(player);
    player.loadDataset(bundle, true);

    const startScreen = rootEl.querySelector<HTMLElement>('#start-screen')!;
    expect(player.getState().started).toBe(true);
    expect(player.getState().mode).toBe('story');
    expect(startScreen.style.display).toBe('none');

    // Verify #nav-data-btn and #hud-data-btn say "Upload Data" (no [D])
    const navDataBtn = rootEl.querySelector<HTMLElement>('#nav-data-btn');
    const hudDataBtn = rootEl.querySelector<HTMLElement>('#hud-data-btn');
    expect(navDataBtn?.textContent?.trim()).toBe('Upload Data');
    expect(hudDataBtn?.textContent?.trim()).toBe('Upload Data');
    expect(navDataBtn?.textContent).not.toContain('[D]');
    expect(hudDataBtn?.textContent).not.toContain('[D]');

    // Dispatching 'd' and 'D' keydown events must NOT re-open #start-screen
    dispatchWindowKeydown('d');
    expect(player.getState().mode).toBe('story');
    expect(startScreen.style.display).toBe('none');

    dispatchWindowKeydown('D');
    expect(player.getState().mode).toBe('story');
    expect(startScreen.style.display).toBe('none');

    player.destroy();
  });

  it('3. verifies multi-year (2025–26) period rendering in PourChapter (#ttlt and #ttlB)', () => {
    const { rootEl } = setupStoryPlayerTestDom('?byo=1');

    // Test both synthetic 2025-26 dataset and real northbank_coffee_2025-26.xlsx if present
    const syntheticMultiYearBundle = ingestFilesDeterministically(
      [
        {
          name: 'northbank_flagship_2025-26.csv',
          content: buildMultiYear2025To2026B2BCsv(),
          mimeType: 'text/csv',
        },
      ],
      { entityName: 'Northbank Coffee Roasters — Southbank Flagship', isB2B: true }
    );

    const bundlesToVerify: DatasetBundle[] = [syntheticMultiYearBundle];
    const northbankPath = path.resolve(
      process.cwd(),
      '..',
      '..',
      'knowledge_work',
      'sample_data_sheets',
      'northbank_coffee_2025-26.xlsx'
    );
    if (fs.existsSync(northbankPath)) {
      bundlesToVerify.push(
        ingestFilesDeterministically([
          {
            name: 'northbank_coffee_2025-26.xlsx',
            content: fs.readFileSync(northbankPath).toString('base64'),
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            encoding: 'base64',
          },
        ])
      );
    }

    const player = new StoryPlayer(rootEl, syntheticMultiYearBundle);
    registerBespokeChapters(player);

    for (const bundle of bundlesToVerify) {
      player.loadDataset(bundle, true);
      player.goToChapter(0);

      const chapterHost = rootEl.querySelector<HTMLElement>('#chapter-host')!;
      const ttlt = chapterHost.querySelector<HTMLElement>('#ttlt');
      const ttlB = chapterHost.querySelector<HTMLElement>('#ttlB');

      expect(ttlt).not.toBeNull();
      expect(ttlt?.textContent?.trim()).toBe('2025–26');
      expect(ttlB).not.toBeNull();
      expect(ttlB?.textContent).toContain('2025–26');
      expect(ttlB?.textContent).not.toMatch(/\b2025 operating grid\b/);
    }

    player.destroy();
  });

  it('4 & 5. verifies adaptive 6-to-13 slide selection, sequential 01 / 0N kickers, and full 13-chapter B2B DOM & copy audit', () => {
    const { rootEl } = setupStoryPlayerTestDom('?byo=1');

    // A. Adaptive chapter count (6..13) and sequential kicker numbering on natural B2B datasets
    const naturalBundles: DatasetBundle[] = [
      ingestFilesDeterministically(
        [{ name: 'acme_cloud_fy2025.csv', content: SAMPLE_SAAS_B2B_CSV, mimeType: 'text/csv' }],
        { entityName: 'Acme Cloud Corp', isB2B: true }
      ),
      ingestFilesDeterministically(
        [
          {
            name: 'northbank_flagship_2025-26.csv',
            content: buildMultiYear2025To2026B2BCsv(),
            mimeType: 'text/csv',
          },
        ],
        { entityName: 'Northbank Coffee Roasters — Southbank Flagship', isB2B: true }
      ),
    ];

    const sampleDir = path.resolve(process.cwd(), '..', 'sample_b2b_data');
    const nimbusXlsxPath = path.join(sampleDir, 'nimbus_cloud_saas_fy2025.xlsx');
    if (fs.existsSync(nimbusXlsxPath)) {
      naturalBundles.push(
        ingestFilesDeterministically([
          {
            name: 'nimbus_cloud_saas_fy2025.xlsx',
            content: fs.readFileSync(nimbusXlsxPath).toString('base64'),
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            encoding: 'base64',
          },
        ])
      );
    }

    const northbankPath = path.resolve(
      process.cwd(),
      '..',
      '..',
      'knowledge_work',
      'sample_data_sheets',
      'northbank_coffee_2025-26.xlsx'
    );
    if (fs.existsSync(northbankPath)) {
      naturalBundles.push(
        ingestFilesDeterministically([
          {
            name: 'northbank_coffee_2025-26.xlsx',
            content: fs.readFileSync(northbankPath).toString('base64'),
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            encoding: 'base64',
          },
        ])
      );
    }

    for (const bundle of naturalBundles) {
      const total = bundle.plan.chapters.length;
      expect(total).toBeGreaterThanOrEqual(6);
      expect(total).toBeLessThanOrEqual(13);
      const totalStr = String(total).padStart(2, '0');
      bundle.plan.chapters.forEach((ch, idx) => {
        const expectedPrefix = `${String(idx + 1).padStart(2, '0')} / ${totalStr} · `;
        expect(ch.params.kicker?.startsWith(expectedPrefix)).toBe(true);
      });
    }

    // B. Force all 13 B2B chapters via selectedChapters and mount every single one (0..12) in StoryPlayer
    const forced13Bundle = ingestFilesDeterministically(
      [
        {
          name: 'northbank_flagship_2025-26.csv',
          content: buildMultiYear2025To2026B2BCsv(),
          mimeType: 'text/csv',
        },
      ],
      {
        entityName: 'Northbank Coffee Roasters — Southbank Flagship',
        isB2B: true,
        selectedChapters: [...ALL_13_B2B_CHAPTER_KEYS],
      }
    );

    expect(forced13Bundle.plan.chapters.length).toBe(13);

    const player = new StoryPlayer(rootEl, forced13Bundle);
    registerBespokeChapters(player);

    const datasetsToMountAudit: DatasetBundle[] = [forced13Bundle, ...naturalBundles];

    for (const bundle of datasetsToMountAudit) {
      player.loadDataset(bundle, true);
      const total = bundle.plan.chapters.length;
      const totalStr = String(total).padStart(2, '0');
      const chapterHost = rootEl.querySelector<HTMLElement>('#chapter-host')!;
      const chlEl = rootEl.querySelector<HTMLElement>('#chl')!;

      for (let i = 0; i < total; i++) {
        player.goToChapter(i);
        const ch = bundle.plan.chapters[i]!;
        const expectedPrefix = `${String(i + 1).padStart(2, '0')} / ${totalStr}`;

        expect(ch.params.kicker?.startsWith(`${expectedPrefix} · `)).toBe(true);
        expect(chlEl.textContent?.startsWith(`${expectedPrefix} · `)).toBe(true);

        const html = chapterHost.innerHTML;
        const text = chapterHost.textContent ?? '';

        // Verify zero occurrences of any forbidden consumer/typo copy across DOM & chrome
        for (const phrase of FORBIDDEN_B2B_COPY_PHRASES) {
          expect(html).not.toContain(phrase);
          expect(text).not.toContain(phrase);
          expect(chlEl.textContent ?? '').not.toContain(phrase);
        }

        // In shatter chapter: assert .num.gh does NOT exist (giant "505" ghost number is gone)
        if (ch.type === 'shatter') {
          expect(chapterHost.querySelector('.num.gh')).toBeNull();
        }

        // Assert every chapter with a header has .ch-header-stack containing headline and body
        const headerStack = chapterHost.querySelector<HTMLElement>('.ch-header-stack');
        expect(headerStack).not.toBeNull();
        expect(headerStack?.querySelector('[data-testid="chapter-headline"]')).not.toBeNull();
        expect(headerStack?.querySelector('[data-testid="chapter-body"]')).not.toBeNull();
      }
    }

    player.destroy();
  });
});
