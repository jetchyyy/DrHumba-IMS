import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getBranchInventoryCatalog,
  getInventoryItemsForCategory,
  resolveInitialPosSubStore,
  buildPosBranchPriceMap,
  resolvePosItemPrice,
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

test('resolveInitialPosSubStore stays on Main Store (null) by default instead of auto-selecting first sub-store', () => {
  const branches = [
    { id: 'mtc-main', name: 'MTC Branch', is_warehouse: false, location: null, parent_id: null },
    { id: 'mtc-seafood', name: 'Seafood Overload', is_warehouse: false, location: null, parent_id: 'mtc-main' },
  ];
  const kids = [branches[1]];

  // Default cashier on parent branch with no saved preference -> stays on Main Store (null)
  assert.equal(resolveInitialPosSubStore(kids, branches, null, 'mtc-main', 'mtc-main'), null);
  assert.equal(resolveInitialPosSubStore(kids, branches, null, null, 'mtc-main'), null);

  // Cashier explicitly chose sub-store in localStorage -> honors sub-store
  assert.equal(resolveInitialPosSubStore(kids, branches, 'mtc-seafood', 'mtc-main', 'mtc-main')?.id, 'mtc-seafood');

  // Cashier assigned directly to sub-store in profile with no saved preference -> honors profile sub-store
  assert.equal(resolveInitialPosSubStore(kids, branches, null, 'mtc-seafood', 'mtc-main')?.id, 'mtc-seafood');

  // Cashier assigned to sub-store but explicitly switched to Main Store ('parent') -> honors 'parent'
  assert.equal(resolveInitialPosSubStore(kids, branches, 'parent', 'mtc-seafood', 'mtc-main'), null);

  // Single-store tenant with no sub-stores -> always null
  assert.equal(resolveInitialPosSubStore([], [branches[0]], null, 'mtc-main', 'mtc-main'), null);
});

test('buildPosBranchPriceMap merges menu_item_id and inventory_item_id overrides without clobbering positive prices with nulls', () => {
  const menuItems = [
    { id: 'menu-bangus', inventory_item_id: 'inv-bangus' },
  ];
  const bpData = [
    { branch_id: 'mtc-main', menu_item_id: 'menu-bangus', inventory_item_id: null, price: 185, foodpanda_price: null, grab_price: null },
    { branch_id: 'mtc-main', menu_item_id: null, inventory_item_id: 'inv-bangus', price: null, foodpanda_price: 220, grab_price: 225 },
  ];

  const bpMap = buildPosBranchPriceMap(bpData, menuItems);
  assert.deepEqual(bpMap['mtc-main']['menu-bangus'], {
    price: 185,
    foodpanda_price: 220,
    grab_price: 225,
  });
});

test('resolvePosItemPrice preserves normal tenant prices and recovers zeroed retail-linked prices from linked inventory item', () => {
  const bpMap = {
    'branch-1': {
      'menu-override': { price: 210, foodpanda_price: 250 },
    },
  };

  // Normal tenant item with catalog price
  assert.equal(
    resolvePosItemPrice(
      { id: 'menu-normal', price: 150, foodpanda_price: 180, grab_price: 185 },
      'standard',
      bpMap,
      'branch-1',
      null
    ),
    150
  );

  // Branch override takes precedence when positive
  assert.equal(
    resolvePosItemPrice(
      { id: 'menu-override', price: 150 },
      'standard',
      bpMap,
      'branch-1',
      null
    ),
    210
  );

  // Zeroed menu_items.price falls back to linked_selling_price (> 0.01)
  assert.equal(
    resolvePosItemPrice(
      {
        id: 'menu-zeroed',
        price: 0,
        inventory_item_id: 'inv-1',
        linked_selling_price: 195,
        linked_foodpanda_price: 230,
        linked_grab_price: 235,
      },
      'standard',
      bpMap,
      'branch-1',
      null
    ),
    195
  );

  // Delivery channel fallback to linked_foodpanda_price / linked_grab_price
  assert.equal(
    resolvePosItemPrice(
      {
        id: 'menu-zeroed',
        price: 0,
        inventory_item_id: 'inv-1',
        linked_selling_price: 195,
        linked_foodpanda_price: 230,
        linked_grab_price: 235,
      },
      'foodpanda',
      bpMap,
      'branch-1',
      null
    ),
    230
  );

  // Sentinel 0.01 on linked_selling_price is NOT treated as a real fallback when item.price is 0
  assert.equal(
    resolvePosItemPrice(
      {
        id: 'menu-sentinel',
        price: 0,
        inventory_item_id: 'inv-sentinel',
        linked_selling_price: 0.01,
      },
      'standard',
      bpMap,
      'branch-1',
      null
    ),
    0
  );
});
