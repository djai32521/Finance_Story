/**
 * Runtime Server Configuration (`server/config.ts`)
 *
 * Single source of truth for runtime model configuration (`MODEL_NAME` / `AGENT_MODEL`
 * defaulting to `gemini-4-argon`), AI Studio placeholder key rejection, and
 * environment variable loading (`MODEL_API_KEY`, `GEMINI_API_KEY`, `API_KEY`)
 * from `process.env`, `.env`, `../.env`, `.dev.env.json`, and `/tmp/.dev.env.json`.
 *
 * Rule 9: Secrets stay out of the repo; never log the API key.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_AGENT_ID = 'antigravity-preview-09-2026';
export const DEFAULT_MODEL_NAME = 'gemini-4-argon';
export const DEFAULT_SERVER_PORT = 4174;

export const CANDIDATE_BASE_AGENTS = [
  'antigravity-preview-09-2026',
] as const;

export const CANDIDATE_MODELS = [
  'gemini-4-argon',
  'gemini-3.8-flash',
  'gemini-3-flash-preview',
] as const;

export const PLACEHOLDER_API_KEYS: ReadonlySet<string> = new Set([
  '',
  'MY_GEMINI_API_KEY',
  'PLACEHOLDER_API_KEY',
  'YOUR_GEMINI_API_KEY',
  'YOUR_API_KEY',
  'INSERT_API_KEY',
  'TODO',
  'UNDEFINED',
  'NULL',
]);

export interface ServerConfig {
  port: number;
  host: string;
  modelName: string;
  agentId?: string;
  apiKey: string | null;
  hasApiKey: boolean;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = path.resolve(APP_ROOT, '..');

export function isValidApiKey(val: unknown): val is string {
  if (typeof val !== 'string') return false;
  const trimmed = val.trim();
  if (trimmed.length <= 8) return false;
  if (PLACEHOLDER_API_KEYS.has(trimmed) || PLACEHOLDER_API_KEYS.has(trimmed.toUpperCase())) {
    return false;
  }
  return true;
}

function parseDotEnvFile(filePath: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!fs.existsSync(filePath)) {
    return result;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx <= 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      result[key] = val;
    }
  } catch {
    // Ignore unreadable .env files
  }
  return result;
}

function readDevEnvJsonKey(): string | null {
  const candidateFiles = [
    path.resolve(process.cwd(), '.dev.env.json'),
    path.join(APP_ROOT, '.dev.env.json'),
    path.join(WORKSPACE_ROOT, '.dev.env.json'),
    '/tmp/.dev.env.json',
  ];
  for (const filePath of candidateFiles) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
      const candidates = [parsed?.MODEL_API_KEY, parsed?.GEMINI_API_KEY, parsed?.API_KEY];
      for (const c of candidates) {
        if (isValidApiKey(c)) {
          return c.trim();
        }
      }
    } catch {
      // Ignore malformed or unreadable .dev.env.json
    }
  }
  return null;
}

export function resolveRuntimeApiKey(
  envSource: Record<string, string | undefined> = process.env
): string | null {
  const candidates = [
    envSource.MODEL_API_KEY,
    envSource.GEMINI_API_KEY,
    envSource.API_KEY,
    process.env.MODEL_API_KEY,
    process.env.GEMINI_API_KEY,
    process.env.API_KEY,
  ];
  for (const candidate of candidates) {
    if (isValidApiKey(candidate)) {
      return candidate.trim();
    }
  }
  return readDevEnvJsonKey();
}

/**
 * Load configuration from `process.env`, falling back to `app/.env`, `../.env`,
 * and AI Studio `.dev.env.json` / `/tmp/.dev.env.json`.
 */
export function loadServerConfig(): ServerConfig {
  const rootEnv = parseDotEnvFile(path.join(WORKSPACE_ROOT, '.env'));
  const appEnv = parseDotEnvFile(path.join(APP_ROOT, '.env'));
  const merged: Record<string, string | undefined> = {
    ...rootEnv,
    ...appEnv,
    ...process.env,
  };

  const apiKey = resolveRuntimeApiKey(merged);

  const modelName =
    (merged.AGENT_MODEL || merged.MODEL_NAME || DEFAULT_MODEL_NAME).trim() || DEFAULT_MODEL_NAME;

  const agentId = (merged.AGENT_ID || DEFAULT_AGENT_ID).trim() || DEFAULT_AGENT_ID;

  const rawPort = Number(merged.PORT ?? DEFAULT_SERVER_PORT);
  const port = Number.isInteger(rawPort) && rawPort > 0 ? rawPort : DEFAULT_SERVER_PORT;

  const defaultHost =
    merged.NODE_ENV === 'production' || Boolean(merged.K_SERVICE) ? '0.0.0.0' : '127.0.0.1';
  const host = (merged.HOST ?? defaultHost).trim() || defaultHost;

  return {
    port,
    host,
    modelName,
    agentId,
    apiKey,
    hasApiKey: apiKey !== null,
  };
}
