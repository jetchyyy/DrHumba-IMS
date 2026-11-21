import assert from 'node:assert/strict';
import test from 'node:test';
import { allModuleTabs, getAvailableModules, moduleForTab, type AppModuleDef } from '../src/lib/appModules.ts';

test('only Operations when Workforce is off', () => {
  const mods = getAvailableModules({ role_name: 'cashier' }, { features: {} });
  assert.deepEqual(mods.map(m => m.id), ['operations']);
});

test('Operations and Workforce when the feature is on', () => {
  const mods = getAvailableModules({ role_name: 'branch_manager' }, { features: { staff_scheduling: true } });
  assert.deepEqual(mods.map(m => m.id), ['operations', 'workforce']);
  assert.equal(moduleForTab('wf-schedule', mods)?.id, 'workforce');
  assert.equal(moduleForTab('dashboard', mods)?.id, 'operations');
  assert.equal(allModuleTabs(mods)[0], 'dashboard');
});

test('a module with no allowed tabs is hidden, and new modules plug in', () => {
  const extra: AppModuleDef[] = [
    { id: 'a', name: 'A', description: '', tabsFor: () => ['a-1'] },
    { id: 'b', name: 'B', description: '', tabsFor: () => [] },
  ];
  const mods = getAvailableModules({ role_name: 'cashier' }, null, extra);
  assert.deepEqual(mods.map(m => m.id), ['a']);
});

test('no profile means no modules', () => {
  assert.deepEqual(getAvailableModules(null, { features: { staff_scheduling: true } }), []);
});
