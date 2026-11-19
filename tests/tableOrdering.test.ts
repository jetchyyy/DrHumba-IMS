import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  sortRestaurantTables,
  moveTableInOrder,
} from '../src/components/pos/tableUtils.ts';

test('sortRestaurantTables sorts naturally (1..9, 10) when display_order is missing or equal', () => {
  const input = [
    { id: 't1', table_number: '1' },
    { id: 't10', table_number: '10' },
    { id: 't2', table_number: '2' },
    { id: 't3', table_number: '3' },
  ];

  assert.deepEqual(
    sortRestaurantTables(input).map(t => t.table_number),
    ['1', '2', '3', '10']
  );
});

test('sortRestaurantTables respects custom display_order before natural table_number fallback', () => {
  const input = [
    { id: 't1', table_number: '1', display_order: 2 },
    { id: 't10', table_number: '10', display_order: 1 },
    { id: 't2', table_number: '2', display_order: 3 },
    { id: 't9', table_number: '9', display_order: null },
  ];

  assert.deepEqual(
    sortRestaurantTables(input).map(t => t.table_number),
    ['10', '1', '2', '9']
  );
});

test('moveTableInOrder swaps adjacent tables cleanly and clamps at boundaries', () => {
  const list = [
    { id: 't1', table_number: '1' },
    { id: 't2', table_number: '2' },
    { id: 't3', table_number: '3' },
  ];

  assert.deepEqual(moveTableInOrder(list, 't2', 'up').map(t => t.id), ['t2', 't1', 't3']);
  assert.deepEqual(moveTableInOrder(list, 't2', 'down').map(t => t.id), ['t1', 't3', 't2']);
  assert.deepEqual(moveTableInOrder(list, 't1', 'up').map(t => t.id), ['t1', 't2', 't3']);
  assert.deepEqual(moveTableInOrder(list, 't3', 'down').map(t => t.id), ['t1', 't2', 't3']);
});

test('table display_order migration adds column, natural backfill, and tenant-safe reorder RPC', () => {
  const migrationPath = path.resolve(
    process.cwd(),
    'supabase/migrations/20261119193000_table_display_order.sql'
  );
  const sql = fs.readFileSync(migrationPath, 'utf8');

  assert.match(sql, /ALTER TABLE public\.restaurant_tables\s+ADD COLUMN IF NOT EXISTS display_order/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.fn_reorder_branch_tables\(/i);
  assert.match(sql, /public\.get_my_tenant_id\(\)/i);
});
