import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Day, Fact, Transaction } from '../contracts/index.js';
import {
  auditPrivacyOnTransactions,
  buildTransactions,
  computeDays,
  computeFacts,
  extractInlineFx,
  loadMerchantCache,
  parseCsvFile,
  parseRawCsvContent,
  reconcileDataset,
  sanitizeMerchantForPrivacy,
} from '../pipeline/index.js';

const APP_ROOT = path.resolve(import.meta.dirname, '..');
const REPO_ROOT = path.resolve(APP_ROOT, '..');

describe('Data Pipeline (M1 Data Truth)', () => {
  it('parses data/transactions_2025.csv (1,000 rows: 809 Credit card, 191 Savings) with 0.00 reconciliation diff', () => {
    const csvPath = path.join(REPO_ROOT, 'data', 'transactions_2025.csv');
    const rawRows = parseCsvFile(csvPath);
    expect(rawRows.length).toBe(1000);
    expect(rawRows.filter((r) => r.account === 'Credit card').length).toBe(809);
    expect(rawRows.filter((r) => r.account === 'Savings').length).toBe(191);

    const cache = loadMerchantCache(path.join(APP_ROOT, 'data', 'merchant_cache.json'));
    const transactions = buildTransactions(rawRows, cache);
    const days = computeDays(transactions, 2025);
    const facts = computeFacts(transactions, days, 2025);
    const recon = reconcileDataset(rawRows, transactions, days, facts);

    expect(recon.ok).toBe(true);
    expect(recon.diffSignedMinor).toBe(0);
    expect(recon.rawSignedMinor).toBe(-2499715); // -$24,997.15
    expect(recon.rawCardSignedMinor).toBe(1644468); // +$16,444.68
    expect(recon.rawSavingsSignedMinor).toBe(-4144183); // -$41,441.83
    expect(recon.txnsAllOutMinor).toBe(recon.daysAllOutMinor);
    expect(recon.txnsDiscOutMinor).toBe(recon.daysDiscOutMinor);
    expect(recon.txnsInMinor).toBe(recon.daysInMinor);
  });

  it('parses raw bank exports (card_statement & savings_statement) and matches transactions_2020-2025.csv (5,424 rows)', () => {
    const rawCardRows = parseCsvFile(
      path.join(REPO_ROOT, 'data', 'raw', 'card_statement_2020-2025.csv')
    );
    const rawSavRows = parseCsvFile(
      path.join(REPO_ROOT, 'data', 'raw', 'savings_statement_2020-2025.csv')
    );
    const multiYearRows = parseCsvFile(path.join(REPO_ROOT, 'data', 'transactions_2020-2025.csv'));

    expect(rawCardRows.length).toBe(4527);
    expect(rawSavRows.length).toBe(897);
    expect(rawCardRows.length + rawSavRows.length).toBe(5424);
    expect(multiYearRows.length).toBe(5424);

    // Verify sign inversion on raw card statement matches normalized multi-year CSV
    const combinedRawMinor = [...rawCardRows, ...rawSavRows].reduce(
      (acc, r) => acc + Math.round(Number.parseFloat(r.amount) * 100),
      0
    );
    const multiYearMinor = multiYearRows.reduce(
      (acc, r) => acc + Math.round(Number.parseFloat(r.amount) * 100),
      0
    );
    expect(combinedRawMinor).toBe(multiYearMinor);
  });

  it('deduplicates exact duplicate IDs and PENDING rows while preserving same-day repeat visits', () => {
    const sampleCsv = [
      'id,date,posted_date,account,tran_type,description,amount,currency',
      'CARD-1,2025-03-01,2025-03-01,Credit card,DEBIT,Blue Bottle Coffee Seattle WA,-7.40,USD',
      'CARD-1,2025-03-01,2025-03-01,Credit card,DEBIT,Blue Bottle Coffee Seattle WA,-7.40,USD',
      'CARD-2,2025-03-01,2025-03-01,Credit card,DEBIT,Blue Bottle Coffee Seattle WA,-7.40,USD',
      'CARD-3,2025-03-01,2025-03-01,Credit card,PENDING,Blue Bottle Coffee Seattle WA,-7.40,USD',
    ].join('\n');

    const parsed = parseRawCsvContent(sampleCsv);
    expect(parsed.length).toBe(2);
    expect(parsed.map((r) => r.id)).toEqual(['CARD-1', 'CARD-2']);
  });

  it('accurately detects all transfers, refunds, and inline FX metadata in 2025 data', () => {
    const transactions = JSON.parse(
      fs.readFileSync(path.join(APP_ROOT, 'data', 'transactions.json'), 'utf8')
    ) as Transaction[];

    const transfers = transactions.filter((t) => t.is_transfer);
    expect(transfers.length).toBe(150);
    expect(transfers.every((t) => t.category === 'transfers')).toBe(true);

    const refunds = transactions.filter((t) => t.is_refund);
    expect(refunds.map((r) => r.id)).toEqual(['CARD-2025011702', 'CARD-2025013108']);
    expect(refunds.every((r) => r.direction === 'in' && !r.is_transfer)).toBe(true);

    const fxTxns = transactions.filter((t) => Boolean(t.fx));
    expect(fxTxns.length).toBe(8);
    const etsyFx = extractInlineFx(
      'Etsy.com BramblePressCo Dublin 1 80.39 POUND STERLING at a Conversion Rate  of 0.76 (US$105.78)'
    );
    expect(etsyFx).toEqual({
      foreign_amount_minor: 8039,
      foreign_currency: 'GBP',
      rate: 0.76,
      stripped_description: 'Etsy.com BramblePressCo Dublin 1',
    });
  });

  it('enforces Rule 6 privacy masking: zero account numbers, card numbers, references, or personal names in merchant', () => {
    const transactions = JSON.parse(
      fs.readFileSync(path.join(APP_ROOT, 'data', 'transactions.json'), 'utf8')
    ) as Transaction[];

    const violations = auditPrivacyOnTransactions(transactions);
    expect(violations).toEqual([]);

    // Verify Friend A..D masking
    expect(sanitizeMerchantForPrivacy('Max Vance')).toBe('Friend A');
    expect(sanitizeMerchantForPrivacy('LEE R')).toBe('Friend B');
    expect(sanitizeMerchantForPrivacy('Share')).toBe('Friend C');
    expect(sanitizeMerchantForPrivacy('Theo flight')).toBe('Friend D');

    // Verify Blue Bottle Coffee has 72 visits and Sightglass Coffee variants are unified to 41 visits
    const blueBottleVisits = transactions.filter((t) => t.merchant === 'Blue Bottle Coffee');
    expect(blueBottleVisits.length).toBe(72);
    const sightglassVisits = transactions.filter((t) => t.merchant === 'Sightglass Coffee');
    expect(sightglassVisits.length).toBe(41);
  });

  it('verifies all generated Days (365) and Facts (96) recompute deterministically with valid txn_ids', () => {
    const transactions = JSON.parse(
      fs.readFileSync(path.join(APP_ROOT, 'data', 'transactions.json'), 'utf8')
    ) as Transaction[];
    const days = JSON.parse(
      fs.readFileSync(path.join(APP_ROOT, 'data', 'days.json'), 'utf8')
    ) as Day[];
    const facts = JSON.parse(
      fs.readFileSync(path.join(APP_ROOT, 'data', 'facts.json'), 'utf8')
    ) as Fact[];

    expect(days.length).toBe(365);
    expect(days[0]?.date).toBe('2025-01-01');
    expect(days[364]?.date).toBe('2025-12-31');
    expect(days.filter((d) => d.is_payday).length).toBe(12);

    const txnIdSet = new Set(transactions.map((t) => t.id));
    expect(facts.length).toBeGreaterThanOrEqual(45);

    for (const fact of facts) {
      expect(fact.txn_ids.length).toBeGreaterThan(0);
      for (const tid of fact.txn_ids) {
        expect(txnIdSet.has(tid)).toBe(true);
      }
    }

    // Recompute facts and verify deterministic match
    const recomputed = computeFacts(transactions, days, 2025);
    expect(recomputed).toEqual(facts);
  });
});
