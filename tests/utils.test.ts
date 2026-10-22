import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getBranchInventoryCatalog,
  getInventoryItemsForCategory,
} from '../src/lib/utils.ts';

interface CatalogItem {
  id: string;
  category: string;
  available_branches?: string[] | null;
}

test('keeps branch-available Portioned Meats visible in the Main Branch catalog', () => {
  const result = getBranchInventoryCatalog([
    { id: 'global-portioned', category: 'Portioned Meats', available_branches: null },
    { id: 'main-portioned', category: 'Portioned Meats', available_branches: ['main-branch'] },
    { id: 'other-portioned', category: 'Portioned Meats', available_branches: ['other-branch'] },
    { id: 'main-dry', category: 'Dry Goods', available_branches: ['main-branch'] },
  ], 'main-branch');

  assert.deepEqual(result.categories, ['Dry Goods', 'Portioned Meats']);
  assert.deepEqual(
    result.items.map(item => item.id),
    ['global-portioned', 'main-portioned', 'main-dry']
  );
});

test('omits categories that have no items available at the active branch', () => {
  const result = getBranchInventoryCatalog([
    { id: 'other-portioned', category: 'Portioned Meats', available_branches: ['other-branch'] },
    { id: 'main-dry', category: 'Dry Goods', available_branches: ['main-branch'] },
  ], 'main-branch');

  assert.deepEqual(result.categories, ['Dry Goods']);
  assert.deepEqual(result.items.map(item => item.id), ['main-dry']);
});

test('returns only items from the selected inventory category', () => {
  const items: CatalogItem[] = [
    { id: 'portioned', category: 'Portioned Meats' },
    { id: 'dry', category: 'Dry Goods' },
  ];

  assert.deepEqual(
    getInventoryItemsForCategory(items, 'Portioned Meats').map(item => item.id),
    ['portioned']
  );
  assert.deepEqual(
    getInventoryItemsForCategory(items, 'All').map(item => item.id),
    ['portioned', 'dry']
  );
});
