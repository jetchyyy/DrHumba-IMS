import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_KITCHEN_RECEIPT_TEMPLATE,
  resolveKitchenReceiptTemplate,
  getKitchenReceiptMetrics,
  buildKitchenReceiptHtml,
  buildKitchenEscPosBytes,
} from '../src/lib/kitchenReceipt.ts';

const sampleSale = {
  id: 'sale-12345678',
  control_number: 'SI-2026-00123',
  branch_name: 'Guadalupe Branch',
  cashier_name: 'Maria Santos',
  cashier_email: 'maria@drhumba.com',
  created_at: '2026-11-13T05:30:00.000Z',
  sale_category: 'Dine in',
  notes: 'Serve hot',
  items: [
    {
      quantity: 2,
      item_name: 'Spicy Dr. Humba Platter Extra Large',
      notes: 'No peanuts',
    },
  ],
};

test('resolveKitchenReceiptTemplate falls back to defaults and clamps feed_lines', () => {
  const resolved = resolveKitchenReceiptTemplate({
    paper_width: '80mm',
    font_size: 'large',
    feed_lines: 99,
  });

  assert.equal(resolved.paper_width, '80mm');
  assert.equal(resolved.font_size, 'large');
  assert.equal(resolved.feed_lines, 8);
  assert.equal(resolved.header_title, DEFAULT_KITCHEN_RECEIPT_TEMPLATE.header_title);

  const clampedLow = resolveKitchenReceiptTemplate({ feed_lines: -5 });
  assert.equal(clampedLow.feed_lines, 0);
});

test('buildKitchenReceiptHtml applies kitchen paper width, font size, header, footer, and visibility toggles', () => {
  const html80 = buildKitchenReceiptHtml(sampleSale, {
    paper_width: '80mm',
    font_size: 'large',
    header_title: 'GRILL STATION',
    footer_text: 'Call server when ready',
    show_branch_name: true,
    show_cashier_name: true,
    show_date: false,
    show_order_number: true,
    show_order_type: false,
    show_notes: false,
  });

  assert.match(html80, /width:\s*76mm/);
  assert.match(html80, /font-size:\s*14px/);
  assert.ok(html80.includes('GRILL STATION'));
  assert.ok(html80.includes('Call server when ready'));
  assert.ok(html80.includes('Guadalupe Branch'));
  assert.ok(html80.includes('Maria Santos'));
  assert.ok(html80.includes('SI-2026-00123'));
  assert.ok(!html80.includes('Date:'));
  assert.ok(!html80.includes('<div class="category-badge">'));
  assert.ok(!html80.includes('Dine in'));
  assert.ok(!html80.includes('Serve hot'));
  assert.ok(!html80.includes('No peanuts'));

  const html58Small = buildKitchenReceiptHtml(
    { ...sampleSale, cashier_name: null, cashier_email: 'juan.cruz@drhumba.com' },
    {
      paper_width: '58mm',
      font_size: 'small',
      show_cashier_name: false,
      show_notes: true,
    }
  );
  assert.match(html58Small, /width:\s*54mm/);
  assert.match(html58Small, /font-size:\s*11px/);
  assert.ok(!html58Small.includes('Cashier:'));
  assert.ok(html58Small.includes('Serve hot'));
  assert.ok(html58Small.includes('No peanuts'));
});

test('buildKitchenEscPosBytes respects 58mm/80mm line width, ESC/POS font size commands, visibility toggles, and feed lines', () => {
  const bytes80Large = buildKitchenEscPosBytes(sampleSale, {
    paper_width: '80mm',
    font_size: 'large',
    header_title: 'KITCHEN PASS',
    footer_text: 'Done',
    show_branch_name: true,
    show_cashier_name: true,
    show_date: false,
    show_order_number: true,
    show_order_type: true,
    show_notes: false,
    feed_lines: 5,
  });

  const text80 = new TextDecoder().decode(bytes80Large);
  assert.ok(text80.includes('-'.repeat(48)));
  assert.ok(!text80.includes('-'.repeat(49)));
  assert.ok(text80.includes('*** KITCHEN PASS ***'));
  assert.ok(text80.includes('Guadalupe Branch'));
  assert.ok(text80.includes('Cashier: Maria Santos'));
  assert.ok(!text80.includes('Date:'));
  assert.ok(!text80.includes('ORDER NOTE:'));
  assert.ok(!text80.includes('No peanuts'));
  // Double-height GS ! 0x01 command should be emitted for large kitchen items
  assert.ok(bytes80Large.includes(0x1d));
  assert.ok(text80.includes('\n'.repeat(5)));

  const bytes58Small = buildKitchenEscPosBytes(
    { ...sampleSale, cashier_name: undefined, cashier_email: 'juan.cruz@drhumba.com' },
    {
      paper_width: '58mm',
      font_size: 'small',
      show_cashier_name: true,
      feed_lines: 1,
    }
  );
  const text58 = new TextDecoder().decode(bytes58Small);
  assert.ok(text58.includes('-'.repeat(32)));
  assert.ok(!text58.includes('-'.repeat(33)));
  assert.ok(text58.includes('Cashier: juan.cruz'));
  // Font B command: 0x1b 0x4d 0x01
  const hasFontB = bytes58Small.some(
    (_, idx) => bytes58Small[idx] === 0x1b && bytes58Small[idx + 1] === 0x4d && bytes58Small[idx + 2] === 0x01
  );
  assert.equal(hasFontB, true);
  assert.equal(getKitchenReceiptMetrics({ paper_width: '80mm' }).escPosLineChars, 48);
});
