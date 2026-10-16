/**
 * Shared Ingestion, Google Drive, Gemini Enrichment, and Managed Agent contracts.
 * Single source of truth connecting W1 (Server), W2 (B2B Pipeline), W3 (Visuals), and W4 (BYO UI).
 */

import type { BusinessArchetype, Category, Fact, RawSourceRow } from './data.js';
import type { DatasetBundle } from './story.js';

export interface RawIngestFile {
  name: string;
  mimeType: string;
  /** UTF-8 text for CSV/TSV/JSON/TXT, or base64 payload for PDF/images/XLSX */
  content: string;
  encoding?: 'utf8' | 'base64';
}

export interface DriveFileEntry {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  downloadUrl?: string;
}

export interface DriveFolderListing {
  folderId: string;
  folderName?: string;
  files: DriveFileEntry[];
  source: 'drive_api' | 'embedded_html' | 'direct_file' | 'sheets_export';
}

export interface GeminiEntityMapping {
  raw_description: string;
  merchant: string;
  category: Category;
  category_label: string;
  is_recurring: boolean;
}

export interface GeminiNarrativeOverride {
  entity_name?: string;
  fiscal_period_label?: string;
  archetype?: BusinessArchetype;
  archetype_label?: string;
  currency_code?: string;
  currency_symbol?: string;
  milestone_label?: string;
  milestone_singular?: string;
  outflow_label?: string;
  inflow_label?: string;
  counterparty_label?: string;
  readonly selected_chapters?: readonly string[];
  /** Must reference numbers exclusively via `{fact:id}` placeholders */
  one_line?: string;
  personality_title?: string;
  /** Must reference numbers exclusively via `{fact:id}` placeholders */
  personality_subtitle?: string;
  chapter_copy?: Record<
    string,
    {
      kicker?: string;
      headline?: string;
      body?: string;
    }
  >;
  category_labels?: Record<string, string>;
  sample_questions?: string[];
  agent_audit_notes?: string[];
  generated_by?: 'deterministic' | 'gemini_enriched' | 'managed_agent';
}

export interface IngestEnrichRequest {
  files?: RawIngestFile[];
  raw_rows?: RawSourceRow[];
  unclassified_descriptions?: string[];
  facts_summary?: Array<{
    id: string;
    label: string;
    formatted: string;
    computation: string;
  }>;
  chapter_ids?: string[];
  entity_name_hint?: string;
  deep_agent_audit?: boolean;
}

export interface IngestEnrichResponse {
  extracted_rows?: RawSourceRow[];
  entity_mappings?: GeminiEntityMapping[];
  narrative?: GeminiNarrativeOverride;
  bundle?: DatasetBundle;
  source: 'deterministic' | 'gemini_enriched' | 'managed_agent';
  model_used?: string;
  agent_steps?: string[];
}

export interface IngestProgressStep {
  phase: 'parse' | 'profile' | 'tier1_facts' | 'tier2_gemini' | 'tier3_agent' | 'verify' | 'ready';
  label: string;
  detail?: string;
  progress_pct: number;
}

export type FactMapLike = ReadonlyMap<string, Fact>;
