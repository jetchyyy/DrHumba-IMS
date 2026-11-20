import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateServiceCharge,
  buildServiceChargeCsv,
  normalizeJoinedName,
  resolveBranchServiceChargeDetails,
  resolveBranchServiceChargeRate,
  resolveDatePresetBounds,
  type BranchRateLike,
  type ServiceChargeSaleRow,
} from '../src/lib/serviceCharge.ts';

const BRANCHES: BranchRateLike[] = [
  { id: 'b-main', name: 'Main Branch', is_warehouse: false, parent_id: null, service_charge_rate: null },
  { id: 'b-sub', name: 'Main Patio', is_warehouse: false, parent_id: 'b-main', service_charge_rate: null },
  { id: 'b-bgc', name: 'BGC Branch', is_warehouse: false, parent_id: null, service_charge_rate: 12 },
  { id: 'b-exempt', name: 'Kiosk Express', is_warehouse: false, parent_id: null, service_charge_rate: 0 },
  { id: 'b-wh', name: 'Central Warehouse', is_warehouse: true, parent_id: null, service_charge_rate: null },
];

test('resolveBranchServiceChargeRate respects explicit branch rate, 0% exemption, parent inheritance, and tenant default', () => {
  assert.equal(resolveBranchServiceChargeRate(BRANCHES[2], BRANCHES, 10), 12);
  assert.equal(resolveBranchServiceChargeRate(BRANCHES[3], BRANCHES, 10), 0);
  assert.equal(resolveBranchServiceChargeRate(BRANCHES[0], BRANCHES, 10), 10);

  const subWithParentOverride: BranchRateLike[] = [
    { id: 'p1', name: 'Parent', is_warehouse: false, parent_id: null, service_charge_rate: 8 },
    { id: 's1', name: 'Sub', is_warehouse: false, parent_id: 'p1', service_charge_rate: null },
  ];
  assert.equal(resolveBranchServiceChargeRate(subWithParentOverride[1], subWithParentOverride, 10), 8);
});

test('normalizeJoinedName handles singular object, array, empty array, and nullish values', () => {
  assert.equal(normalizeJoinedName({ name: 'Main Branch' }), 'Main Branch');
  assert.equal(normalizeJoinedName([{ name: 'BGC Branch' }]), 'BGC Branch');
  assert.equal(normalizeJoinedName([]), null);
  assert.equal(normalizeJoinedName(null), null);
  assert.equal(normalizeJoinedName(undefined), null);
});

test('aggregateServiceCharge sums completed SC sales, separates sub-stores, excludes non-completed/zero rows, and lists zero-earning stores on ALL', () => {
  const sales: ServiceChargeSaleRow[] = [
    {
      id: 's1',
      control_number: 'SI-0001',
      branch_id: 'b-main',
      sub_store_id: null,
      cashier_id: 'u1',
      total_amount: 1100,
      service_charge_rate: 10,
      service_charge_amount: 100,
      sale_category: 'Dine In',
      created_at: '2026-11-20T04:00:00.000Z',
    },
    {
      id: 's2',
      control_number: 'SI-0002',
      branch_id: 'b-main',
      sub_store_id: 'b-sub',
      cashier_id: 'u1',
      total_amount: 550,
      service_charge_rate: 10,
      service_charge_amount: 50,
      sale_category: 'Dine In',
      created_at: '2026-11-20T05:00:00.000Z',
    },
    {
      id: 's3',
      control_number: 'SI-0003',
      branch_id: 'b-bgc',
      sub_store_id: null,
      cashier_id: 'u2',
      total_amount: 1120,
      service_charge_rate: 12,
      service_charge_amount: 120,
      sale_category: 'Dine In',
      created_at: '2026-11-20T06:00:00.000Z',
    },
    {
      id: 's-void',
      control_number: 'SI-0004',
      branch_id: 'b-bgc',
      sub_store_id: null,
      cashier_id: 'u2',
      total_amount: 1120,
      service_charge_rate: 12,
      service_charge_amount: 120,
      sale_category: 'Dine In',
      status: 'refunded',
      created_at: '2026-11-20T06:30:00.000Z',
    },
    {
      id: 's-zero',
      control_number: 'SI-0005',
      branch_id: 'b-exempt',
      sub_store_id: null,
      cashier_id: 'u2',
      total_amount: 500,
      service_charge_rate: 0,
      service_charge_amount: 0,
      sale_category: 'Take Out',
      status: 'completed',
      created_at: '2026-11-20T07:00:00.000Z',
    },
  ];

  const allSummary = aggregateServiceCharge(sales, BRANCHES, 10, 'ALL');
  assert.equal(allSummary.totalServiceCharge, 270);
  assert.equal(allSummary.orderCount, 3);
  assert.equal(allSummary.salesTotal, 2770);
  assert.equal(allSummary.averageServiceCharge, 90);
  // 4 non-warehouse branches (b-bgc, b-main, b-sub, b-exempt), warehouse excluded when 0
  assert.equal(allSummary.branchBreakdown.length, 4);
  assert.equal(allSummary.branchBreakdown[0].branchId, 'b-bgc');
  assert.equal(allSummary.branchBreakdown[0].serviceChargeTotal, 120);
  assert.equal(allSummary.branchBreakdown[1].branchId, 'b-main');
  assert.equal(allSummary.branchBreakdown[1].serviceChargeTotal, 100);
  assert.equal(allSummary.branchBreakdown[2].branchId, 'b-sub');
  assert.equal(allSummary.branchBreakdown[2].isSubStore, true);
  assert.equal(allSummary.branchBreakdown[2].parentName, 'Main Branch');
  assert.equal(allSummary.branchBreakdown[3].branchId, 'b-exempt');
  assert.equal(allSummary.branchBreakdown[3].serviceChargeTotal, 0);

  // Filtering by parent branch includes its direct sales + its sub-store sales
  const mainSummary = aggregateServiceCharge(sales, BRANCHES, 10, 'b-main');
  assert.equal(mainSummary.totalServiceCharge, 150);
  assert.equal(mainSummary.orderCount, 2);

  // Filtering by sub-store isolates only that sub-store
  const subSummary = aggregateServiceCharge(sales, BRANCHES, 10, 'b-sub');
  assert.equal(subSummary.totalServiceCharge, 50);
  assert.equal(subSummary.orderCount, 1);
});

test('buildServiceChargeCsv escapes commas and quotes per RFC-4180', () => {
  const rows: ServiceChargeSaleRow[] = [
    {
      id: 's1',
      control_number: 'SI-0001',
      branch_id: 'b-main',
      sub_store_id: null,
      cashier_id: 'u1',
      total_amount: 1100,
      service_charge_rate: 10,
      service_charge_amount: 100,
      sale_category: 'Dine In',
      created_at: '2026-11-20T04:00:00.000Z',
    },
  ];
  const csv = buildServiceChargeCsv(
    rows,
    { 'b-main': 'Main, "Flagship" Branch' },
    { u1: 'Jane "Cashier", Doe' }
  );
  const lines = csv.trim().split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^Date & Time,Control Number,Branch,Sub-Store,Cashier,Order Total,SC Rate \(%\),Service Charge$/);
  assert.ok(lines[1].includes('"Main, ""Flagship"" Branch"'));
  assert.ok(lines[1].includes('"Jane ""Cashier"", Doe"'));
});

test('resolveDatePresetBounds computes local start/end ISO bounds for presets and custom ranges', () => {
  const ref = new Date(2026, 10, 20, 15, 30, 0, 0); // Nov 20, 2026 15:30 local

  const today = resolveDatePresetBounds('today', '', '', ref);
  assert.equal(new Date(today.from!).getDate(), 20);
  assert.equal(new Date(today.from!).getHours(), 0);
  assert.equal(new Date(today.to!).getHours(), 23);

  const month = resolveDatePresetBounds('month', '', '', ref);
  assert.equal(new Date(month.from!).getDate(), 1);
  assert.equal(new Date(month.from!).getMonth(), 10);

  const sevenDays = resolveDatePresetBounds('7days', '', '', ref);
  assert.equal(new Date(sevenDays.from!).getDate(), 14);

  const thirtyDays = resolveDatePresetBounds('30days', '', '', ref);
  assert.ok(new Date(thirtyDays.from!).getTime() < new Date(sevenDays.from!).getTime());

  const custom = resolveDatePresetBounds('custom', '2026-11-01', '2026-11-15', ref);
  assert.equal(new Date(custom.from!).getFullYear(), 2026);
  assert.equal(new Date(custom.from!).getMonth(), 10);
  assert.equal(new Date(custom.from!).getDate(), 1);
  assert.equal(new Date(custom.to!).getDate(), 15);
  assert.equal(new Date(custom.to!).getHours(), 23);

  const all = resolveDatePresetBounds('all', '', '', ref);
  assert.equal(all.from, undefined);
  assert.equal(all.to, undefined);
});

test('buildServiceChargeCsv handles null cashier_id (deleted staff) without throwing', () => {
  const rows: ServiceChargeSaleRow[] = [
    {
      id: 's-deleted-cashier',
      control_number: 'SI-0099',
      branch_id: 'b-main',
      sub_store_id: null,
      cashier_id: null,
      total_amount: 1100,
      service_charge_rate: 10,
      service_charge_amount: 100,
      sale_category: 'Dine In',
      status: 'completed',
      created_at: '2026-11-20T04:00:00.000Z',
    },
  ];
  const csv = buildServiceChargeCsv(rows, { 'b-main': 'Main Branch' }, {});
  const lines = csv.trim().split('\n');
  assert.equal(lines.length, 2);
  assert.ok(lines[1].includes(',Deleted Staff,'));
});

test('resolveBranchServiceChargeDetails distinguishes branch override, parent branch inheritance, and tenant default', () => {
  const hierarchy: BranchRateLike[] = [
    { id: 'p-override', name: 'Makati Main', is_warehouse: false, parent_id: null, service_charge_rate: 8 },
    { id: 'c-inherit-parent', name: 'Makati Garden', is_warehouse: false, parent_id: 'p-override', service_charge_rate: null },
    { id: 'p-default', name: 'BGC Main', is_warehouse: false, parent_id: null, service_charge_rate: null },
    { id: 'c-inherit-tenant', name: 'BGC Patio', is_warehouse: false, parent_id: 'p-default', service_charge_rate: null },
  ];

  assert.deepEqual(resolveBranchServiceChargeDetails(hierarchy[0], hierarchy, 10), {
    rate: 8,
    source: 'branch',
    parentName: null,
  });
  assert.deepEqual(resolveBranchServiceChargeDetails(hierarchy[1], hierarchy, 10), {
    rate: 8,
    source: 'parent',
    parentName: 'Makati Main',
  });
  assert.deepEqual(resolveBranchServiceChargeDetails(hierarchy[3], hierarchy, 10), {
    rate: 10,
    source: 'tenant',
    parentName: null,
  });
});
