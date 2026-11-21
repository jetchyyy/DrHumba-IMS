import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getAllowedTabIds,
  getAllowedWorkforceTabIds,
  resolveEffectiveTab,
} from '../src/lib/navPermissions.ts';

const on = { features: { staff_scheduling: true } };

test('workforce is hidden when the feature flag is missing or false', () => {
  const admin = { role_name: 'super_admin' };
  assert.deepEqual(getAllowedWorkforceTabIds(admin, { features: {} }), []);
  assert.deepEqual(getAllowedWorkforceTabIds(admin, { features: { staff_scheduling: false } }), []);
  assert.deepEqual(getAllowedWorkforceTabIds(admin, null), []);
});

test('operations tabs are unchanged by the workforce flag', () => {
  const manager = { role_name: 'branch_manager' };
  assert.deepEqual(getAllowedTabIds(manager, on), getAllowedTabIds(manager, { features: {} }));
  assert.ok(!getAllowedTabIds(manager, on).some(id => id.startsWith('wf-')));
});

test('cashier gets self-service and kiosk only', () => {
  assert.deepEqual(
    getAllowedWorkforceTabIds({ role_name: 'cashier' }, on),
    ['wf-time-clock', 'wf-kiosk', 'wf-my-schedule', 'wf-my-leave']
  );
});

test('branch manager gets management tabs', () => {
  const tabs = getAllowedWorkforceTabIds({ role_name: 'branch_manager' }, on);
  for (const id of ['wf-schedule', 'wf-attendance', 'wf-leave', 'wf-staff', 'wf-shift-templates', 'wf-settings', 'wf-audit']) {
    assert.ok(tabs.includes(id), id);
  }
});

test('custom Workforce access gives exactly the ticked tabs', () => {
  const tabs = getAllowedWorkforceTabIds(
    { role_name: 'cashier', allowed_tabs: ['pos', 'wf-custom', 'wf-time-clock', 'wf-attendance'] },
    on
  );
  assert.deepEqual(tabs, ['wf-time-clock', 'wf-attendance']);
});

test('the custom marker alone means no Workforce screens', () => {
  assert.deepEqual(getAllowedWorkforceTabIds({ role_name: 'branch_manager', allowed_tabs: ['pos', 'wf-custom'] }, on), []);
});

test('super admin is never locked out of Workforce', () => {
  const tabs = getAllowedWorkforceTabIds({ role_name: 'super_admin', allowed_tabs: ['wf-custom'] }, on);
  assert.ok(tabs.includes('wf-staff') && tabs.includes('wf-audit'));
});

test('a workforce tab is not bounced when both lists are passed', () => {
  const profile = { role_name: 'branch_manager' };
  const all = [...getAllowedTabIds(profile, on), ...getAllowedWorkforceTabIds(profile, on)];
  assert.equal(resolveEffectiveTab('wf-schedule', all), 'wf-schedule');
});
