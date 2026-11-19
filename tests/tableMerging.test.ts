import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  formatTableGroupLabel,
  getCombinedTableCapacity,
  buildKitchenControlNumber,
  classifyMergeSelection,
  resolveCartItemKey,
  buildFlatDiscountUnits,
  groupDiscountedUnitResults,
  isKitchenSubmitted,
  groupOrderItemsByRound,
} from '../src/components/pos/tableUtils.ts';

test('formatTableGroupLabel formats single, merged, and fallback table labels cleanly', () => {
  assert.equal(formatTableGroupLabel([{ table_number: '1' }]), '1');
  assert.equal(
    formatTableGroupLabel([{ table_number: '1' }, { table_number: '2' }, { table_number: '3' }]),
    '1 + 2 + 3'
  );
  // Deduplicates while preserving order
  assert.equal(
    formatTableGroupLabel([{ table_number: 'VIP 1' }, { table_number: 'VIP 1' }, { table_number: 'VIP 2' }]),
    'VIP 1 + VIP 2'
  );
  assert.equal(formatTableGroupLabel([], '5'), '5');
  assert.equal(formatTableGroupLabel(null, 'T4'), 'T4');
});

test('getCombinedTableCapacity sums capacities and falls back safely', () => {
  assert.equal(getCombinedTableCapacity([{ capacity: 4 }, { capacity: 6 }]), 10);
  assert.equal(getCombinedTableCapacity([], 4), 4);
  assert.equal(getCombinedTableCapacity([{ capacity: 0 }], 4), 4);
});

test('buildKitchenControlNumber formats single and merged table control numbers', () => {
  assert.equal(buildKitchenControlNumber('1', 1), 'T1-R1');
  assert.equal(buildKitchenControlNumber('1 + 2', 3), 'T1+2-R3');
  assert.equal(buildKitchenControlNumber('VIP 1 + VIP 2', 2), 'TVIP1+VIP2-R2');
});

test('classifyMergeSelection identifies valid merge modes and rejects invalid combinations', () => {
  const v1 = { id: 't1', table_number: '1', capacity: 4, active_tab: null };
  const v2 = { id: 't2', table_number: '2', capacity: 4, active_tab: null };
  const occA1 = { id: 't3', table_number: '3', capacity: 4, active_tab: { id: 'tab-a', status: 'open' } };
  const occA2 = { id: 't4', table_number: '4', capacity: 4, active_tab: { id: 'tab-a', status: 'open' } };
  const occB = { id: 't5', table_number: '5', capacity: 6, active_tab: { id: 'tab-b', status: 'billed_out' } };
  const occC = { id: 't6', table_number: '6', capacity: 4, active_tab: { id: 'tab-c', status: 'open' } };

  assert.equal(classifyMergeSelection([]).mode, 'empty');
  assert.equal(classifyMergeSelection([v1]).mode, 'invalid');

  const openMerged = classifyMergeSelection([v1, v2]);
  assert.equal(openMerged.mode, 'open_merged');
  if (openMerged.mode === 'open_merged') {
    assert.equal(openMerged.totalCapacity, 8);
    assert.deepEqual(openMerged.tables.map(t => t.id), ['t1', 't2']);
  }

  const attach = classifyMergeSelection([occA1, occA2, v1]);
  assert.equal(attach.mode, 'attach_to_tab');
  if (attach.mode === 'attach_to_tab') {
    assert.equal(attach.targetTabId, 'tab-a');
    assert.deepEqual(attach.vacantTables.map(t => t.id), ['t1']);
  }

  const mergeTabs = classifyMergeSelection([occA1, occB]);
  assert.equal(mergeTabs.mode, 'merge_tabs');
  if (mergeTabs.mode === 'merge_tabs') {
    assert.equal(mergeTabs.targetTabId, 'tab-a');
    assert.equal(mergeTabs.sourceTabId, 'tab-b');
  }

  // Same tab's tables alone cannot merge with itself
  assert.equal(classifyMergeSelection([occA1, occA2]).mode, 'invalid');
  // Mixing 2 active tabs + vacant tables is invalid
  assert.equal(classifyMergeSelection([occA1, occB, v1]).mode, 'invalid');
  // More than 2 distinct active tabs is invalid
  assert.equal(classifyMergeSelection([occA1, occB, occC]).mode, 'invalid');
});

test('resolveCartItemKey distinguishes sent tab items from unsent items even with identical menu_item_id', () => {
  const sentFromTab1 = { menu_item_id: 'coke', tab_item_id: 'item-1' };
  const sentFromTab2 = { menu_item_id: 'coke', tab_item_id: 'item-2' };
  const unsent = { menu_item_id: 'coke' };

  assert.notEqual(resolveCartItemKey(sentFromTab1), resolveCartItemKey(sentFromTab2));
  assert.notEqual(resolveCartItemKey(sentFromTab1), resolveCartItemKey(unsent));
  assert.equal(resolveCartItemKey(unsent), 'unsent:coke');
});

test('table merging migration enforces multi-tenancy, RLS, trigger sync, and atomic RPCs', () => {
  const migrationPath = path.resolve(
    process.cwd(),
    'supabase/migrations/20261119190000_flexible_table_merging.sql'
  );
  const sql = fs.readFileSync(migrationPath, 'utf8');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.pos_tab_tables/i);
  assert.match(sql, /tenant_id\s+UUID\s+NOT\s+NULL/i);
  assert.match(sql, /UNIQUE\s*\(\s*tenant_id\s*,\s*tab_id\s*,\s*table_id\s*\)/i);
  assert.match(sql, /ALTER TABLE public\.pos_tab_tables ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /tg_auto_stamp_tenant_pos_tab_tables/i);
  assert.match(sql, /public\.get_my_tenant_id\(\)/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.fn_sync_table_status_from_tab\(\)/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.fn_open_tab_with_tables\(/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.fn_attach_tables_to_tab\(/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.fn_merge_tabs\(/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.fn_unmerge_table_from_tab\(/i);
  assert.match(sql, /FOR UPDATE/i);
  // Critical #2: settled/cancelled tabs cannot be resurrected to steal merged tables
  assert.match(sql, /OLD\.status\s+IN\s*\(\s*'settled'\s*,\s*'cancelled'\s*\)/i);
  // Important #4: fn_merge_tabs clears discount if EITHER target or source had one
  assert.match(sql, /v_target\.discount_type\s+IS\s+NOT\s+NULL/i);
});

test('buildFlatDiscountUnits and groupDiscountedUnitResults isolate identical menu_item_id rows across merged tabs', () => {
  const mergedCart = [
    { menu_item_id: 'coke', tab_item_id: 'ti-1', name: 'Coke', price: 60, quantity: 1, notes: 'No ice' },
    { menu_item_id: 'coke', tab_item_id: 'ti-2', name: 'Coke', price: 60, quantity: 1 },
  ];

  const units = buildFlatDiscountUnits(mergedCart);
  assert.equal(units.length, 2);
  assert.notEqual(units[0].id, units[1].id);
  assert.notEqual(units[0].rowKey, units[1].rowKey);

  // Discount only unit 0, keep unit 1 regular
  const grouped = groupDiscountedUnitResults([
    { ...units[0], discount_amount: 10.71, vatable_sales: 0, vat_amount: 0, vat_exempt_sales: 53.57, is_vat_exempt: true },
    { ...units[1], discount_amount: 0, vatable_sales: 53.57, vat_amount: 6.43, vat_exempt_sales: 0, is_vat_exempt: false },
  ]);

  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].notes, 'No ice');
  assert.equal(grouped[0].discount_amount, 10.71);
  assert.equal(grouped[1].notes, undefined);
  assert.equal(grouped[1].discount_amount, 0);
});

test('isKitchenSubmitted treats both sent and served items as already submitted to kitchen', () => {
  assert.equal(isKitchenSubmitted({ kitchen_status: 'sent' }), true);
  assert.equal(isKitchenSubmitted({ kitchen_status: 'served' }), true);
  assert.equal(isKitchenSubmitted({ kitchen_status: 'pending' }), false);
  assert.equal(isKitchenSubmitted({}), false);
});

test('groupOrderItemsByRound groups submitted rounds in order, tracks served counts, and separates unsent items', () => {
  const result = groupOrderItemsByRound([
    { menu_item_id: 'a', tab_item_id: 't1', name: 'Sisig', price: 200, quantity: 1, round_number: 2, kitchen_status: 'sent' },
    { menu_item_id: 'b', tab_item_id: 't2', name: 'Coke', price: 60, quantity: 2, round_number: 1, kitchen_status: 'served' },
    { menu_item_id: 'c', tab_item_id: 't3', name: 'Rice', price: 30, quantity: 1, round_number: 1, kitchen_status: 'sent' },
    { menu_item_id: 'd', name: 'Halo-Halo', price: 120, quantity: 1 },
  ]);

  assert.equal(result.rounds.length, 2);
  assert.equal(result.rounds[0].roundNumber, 1);
  assert.equal(result.rounds[0].items.length, 2);
  assert.equal(result.rounds[1].roundNumber, 2);
  assert.equal(result.rounds[1].items.length, 1);
  assert.equal(result.unsentItems.length, 1);
  assert.equal(result.servedCount, 1);
  assert.equal(result.submittedCount, 3);
});
