import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getAllowedTabIds,
  resolveEffectiveTab,
} from '../src/lib/navPermissions.ts';

test('getAllowedTabIds excludes dashboard when staff allowed_tabs omits dashboard', () => {
  const allowed = getAllowedTabIds(
    {
      role_name: 'cashier',
      allowed_tabs: ['pos', 'sales-history', 'z-read-history'],
    },
    {
      is_restaurant: true,
      features: { pos: true, sales_history: true, z_read_history: true },
    }
  );

  assert.equal(allowed.includes('dashboard'), false);
  assert.deepEqual(allowed, ['pos', 'sales-history', 'z-read-history']);
});

test('getAllowedTabIds respects plan feature flags as a hard ceiling even if present in allowed_tabs', () => {
  const allowed = getAllowedTabIds(
    {
      role_name: 'cashier',
      allowed_tabs: ['pos', 'table-management', 'sales-history'],
    },
    {
      is_restaurant: true,
      features: { pos: true, table_management: false, sales_history: true },
    }
  );

  assert.deepEqual(allowed, ['pos', 'sales-history']);
});

test('resolveEffectiveTab redirects away from dashboard on first sign-in when user lacks dashboard access', () => {
  const allowed = ['pos', 'sales-history'];
  assert.equal(resolveEffectiveTab('dashboard', allowed), 'pos');
  assert.equal(resolveEffectiveTab('users', allowed), 'pos');
  assert.equal(resolveEffectiveTab('sales-history', allowed), 'sales-history');
});

test('resolveEffectiveTab keeps dashboard when user has dashboard access', () => {
  const allowed = ['dashboard', 'pos', 'settings'];
  assert.equal(resolveEffectiveTab('dashboard', allowed), 'dashboard');
});

test('getAllowedTabIds includes service-charge for super_admin, branch_manager, and auditor by default', () => {
  for (const role_name of ['super_admin', 'branch_manager', 'auditor']) {
    const allowed = getAllowedTabIds({ role_name }, { is_restaurant: true, features: {} });
    assert.equal(allowed.includes('service-charge'), true, `expected service-charge for ${role_name}`);
  }
  for (const role_name of ['cashier', 'inventory_manager']) {
    const allowed = getAllowedTabIds({ role_name }, { is_restaurant: true, features: {} });
    assert.equal(allowed.includes('service-charge'), false, `expected no service-charge for ${role_name}`);
  }
});

test('getAllowedTabIds hides service-charge when features.service_charge_tracker is false even if in allowed_tabs', () => {
  const allowed = getAllowedTabIds(
    {
      role_name: 'super_admin',
      allowed_tabs: ['dashboard', 'service-charge', 'expenses'],
    },
    {
      is_restaurant: true,
      features: { service_charge_tracker: false, expenses: true },
    }
  );
  assert.equal(allowed.includes('service-charge'), false);
  assert.deepEqual(allowed, ['dashboard', 'expenses']);
});

test('getAllowedTabIds allows service-charge for cashier when explicitly granted in allowed_tabs and feature enabled', () => {
  const allowed = getAllowedTabIds(
    {
      role_name: 'cashier',
      allowed_tabs: ['pos', 'service-charge'],
    },
    {
      is_restaurant: true,
      features: { pos: true, service_charge_tracker: true },
    }
  );
  assert.deepEqual(allowed, ['pos', 'service-charge']);
});
