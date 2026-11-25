import { buildKitchenEscPosBytes } from './kitchenReceipt';
import type { KitchenReceiptTemplate } from './kitchenReceipt';

/**
 * Multi-printer Bluetooth engine.
 *
 * Each device (tablet / PC) keeps its own list of paired printers in localStorage,
 * because Web Bluetooth permissions are per browser. Every printer has two roles:
 *  - receipts: customer receipts, running bills, X/Z and EOD reports
 *  - kitchen:  kitchen order tickets (the same full ticket is sent to every kitchen printer,
 *              e.g. one in the kitchen and one at the bar)
 */
export type PrinterRole = 'receipts' | 'kitchen';

export interface SavedPrinter {
  id: string;
  name: string;
  receipts: boolean;
  kitchen: boolean;
}

const STORAGE_KEY = 'bt_printers_v1';
const CHANGE_EVENT = 'bt-printers-changed';

interface PrinterConnection {
  device: any;
  pipe: any | null;
}

/** Live device handles for this page session, keyed by Bluetooth device id. */
const connections = new Map<string, PrinterConnection>();
let isPrinting = false;

const COMMON_PRINTER_SERVICES = [
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // Dothantech / Deli
  '000018f0-0000-1000-8000-00805f9b34fb', // Generic ESC/POS
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // ISDC / Serial
  '0000fee7-0000-1000-8000-00805f9b34fb', // Generic
  '0000ffe0-0000-1000-8000-00805f9b34fb', // Generic BLE Serial (often used by JK-5802H)
  '0000ff00-0000-1000-8000-00805f9b34fb'  // Another generic BLE Serial
];

const KNOWN_TX_UUIDS = [
  '0000ff02-0000-1000-8000-00805f9b34fb', // Priority 1: Common JK-58 / MPT-II transparent serial
  '00002af1-0000-1000-8000-00805f9b34fb', // Priority 2: Official Bluetooth SIG ESC/POS
  '49535343-8841-43f4-a8d4-ecbe34729bb3', // Priority 3: ISSC SPP
  'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f', // Priority 4: Deli / Dothantech
  '0000ffe1-0000-1000-8000-00805f9b34fb',
  '0000fec9-0000-1000-8000-00805f9b34fb'
];

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Check if the current browser environment supports the Web Bluetooth API.
 * Requires Chromium (Chrome, Edge, Opera) and a secure context (HTTPS or localhost).
 */
export const isBluetoothSupported = (): boolean => {
  return typeof navigator !== 'undefined' && typeof (navigator as any)?.bluetooth !== 'undefined';
};

function getBluetooth(): any {
  const nav = typeof navigator !== 'undefined' ? (navigator as any) : null;
  if (!nav?.bluetooth) {
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      throw new Error(
        "Bluetooth printing is unavailable because this page is not running in a Secure Context (HTTPS or localhost). If you are accessing via a local network IP (e.g. http://192.168.x.x), browsers disable Web Bluetooth for security. Please use localhost, an HTTPS URL, or use System Print."
      );
    }
    throw new Error(
      "Web Bluetooth is not supported on this browser (Safari and Firefox do not support Web Bluetooth). Please use Google Chrome, Microsoft Edge, or Opera on Windows, Mac, Linux, ChromeOS, or Android, or use the 'Print Receipt (System)' button."
    );
  }
  return nav.bluetooth;
}

// ─── Saved printer list (per device) ────────────────────────────────────────

export function getSavedPrinters(): SavedPrinter[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((p: any) => p && typeof p.id === 'string') : [];
  } catch {
    return [];
  }
}

function savePrinters(list: SavedPrinter[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Storage blocked (private mode); printers then only last for this session.
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Subscribe to printer list / connection changes. Returns an unsubscribe function. */
export function onPrintersChanged(callback: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, callback);
  return () => window.removeEventListener(CHANGE_EVENT, callback);
}

export function isPrinterConnected(id: string): boolean {
  return !!connections.get(id)?.device?.gatt?.connected;
}

function rememberDevice(device: any) {
  const existing = connections.get(device.id);
  if (!existing || existing.device !== device) {
    connections.set(device.id, { device, pipe: null });
  }
}

function upsertPrinter(device: any, defaults: Pick<SavedPrinter, 'receipts' | 'kitchen'>): SavedPrinter {
  const list = getSavedPrinters();
  const existing = list.find(p => p.id === device.id);
  if (existing) {
    if (device.name) existing.name = device.name;
    savePrinters(list);
    return existing;
  }
  const printer: SavedPrinter = { id: device.id, name: device.name || 'Bluetooth Printer', ...defaults };
  list.push(printer);
  savePrinters(list);
  return printer;
}

async function requestPrinterDevice(): Promise<any> {
  return getBluetooth().requestDevice({
    acceptAllDevices: true,
    optionalServices: COMMON_PRINTER_SERVICES
  });
}

async function getPermittedDevices(): Promise<any[]> {
  const bluetooth = getBluetooth();
  if (typeof bluetooth.getDevices !== 'function') return [];
  try {
    return (await bluetooth.getDevices()) || [];
  } catch (err) {
    console.warn("getDevices() failed or not permitted:", err);
    return [];
  }
}

/**
 * Opens the browser's device picker and adds the chosen printer to this device's list.
 * The first printer prints everything; additional printers default to kitchen tickets only.
 * Must be called from a user gesture (button click).
 */
export async function addBluetoothPrinter(): Promise<SavedPrinter> {
  const device = await requestPrinterDevice();
  rememberDevice(device);
  const isFirst = getSavedPrinters().length === 0;
  return upsertPrinter(device, { receipts: isFirst, kitchen: true });
}

export function updateBluetoothPrinter(id: string, patch: Partial<Pick<SavedPrinter, 'name' | 'receipts' | 'kitchen'>>) {
  savePrinters(getSavedPrinters().map(p => (p.id === id ? { ...p, ...patch } : p)));
}

export function removeBluetoothPrinter(id: string) {
  const conn = connections.get(id);
  try {
    if (conn?.device?.gatt?.connected) conn.device.gatt.disconnect();
  } catch {
    // Ignore disconnect errors
  }
  connections.delete(id);
  savePrinters(getSavedPrinters().filter(p => p.id !== id));
}

/** Matches saved printers for a role to live device handles available in this session. */
async function resolvePrinters(role: PrinterRole) {
  const saved = getSavedPrinters().filter(p => p[role]);
  const targets: { printer: SavedPrinter; device: any }[] = [];
  const missing: SavedPrinter[] = [];
  let permitted: any[] | null = null;

  for (const printer of saved) {
    let device = connections.get(printer.id)?.device;
    if (!device) {
      permitted ??= await getPermittedDevices();
      device = permitted.find(d => d.id === printer.id);
      if (device) rememberDevice(device);
    }
    if (device) targets.push({ printer, device });
    else missing.push(printer);
  }
  return { saved, targets, missing };
}

/**
 * Call at the start of every Bluetooth print button handler (while the click gesture is
 * still active) so the device picker can open if no printer is reachable yet.
 */
export const ensureBluetoothPrinter = async (role: PrinterRole = 'receipts') => {
  getBluetooth();

  // Legacy / first-run: no printer list yet. Adopt the previously permitted device
  // (or ask for one) and let it print everything, matching the old single-printer behaviour.
  if (getSavedPrinters().length === 0) {
    const permitted = await getPermittedDevices();
    const device = permitted[0] ?? await requestPrinterDevice();
    rememberDevice(device);
    upsertPrinter(device, { receipts: true, kitchen: true });
    return device;
  }

  const { saved, targets, missing } = await resolvePrinters(role);
  if (targets.length > 0) return targets[0].device;

  if (saved.length === 0) {
    throw new Error(
      `No Bluetooth printer is set to print ${role === 'kitchen' ? 'kitchen tickets' : 'receipts'} on this device. Assign one in Settings → Printers.`
    );
  }

  // Saved printers exist but this browser can't restore them (no getDevices support,
  // or permission was reset). Ask the user to pick the printer again.
  const device = await requestPrinterDevice();
  rememberDevice(device);
  if (!getSavedPrinters().some(p => p.id === device.id)) {
    const replaced = missing[0];
    savePrinters(getSavedPrinters().map(p =>
      p.id === replaced.id ? { ...p, id: device.id, name: device.name || p.name } : p
    ));
  }
  return device;
};

// ─── Low-level write ────────────────────────────────────────────────────────

async function openWritePipe(device: any): Promise<any> {
  if (!device.gatt) {
    throw new Error("GATT server not found on device.");
  }
  console.log(`Connecting to GATT Server: ${device.name}`);

  let services: any[] = [];
  let connectionAttempts = 3;

  while (connectionAttempts > 0) {
    try {
      // Prevent infinite hang on Windows Web Bluetooth zombie objects
      const server: any = await Promise.race([
        device.gatt.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("GATT connect timeout. Device may be asleep.")), 4000))
      ]);

      // Crucial delay: Windows/Chrome needs time before GATT tables are accessible after a reconnect
      await sleep(1000);

      services = await Promise.race([
        server.getPrimaryServices(),
        new Promise<any[]>((_, reject) => setTimeout(() => reject(new Error("GATT services timeout. Device unresponsive.")), 4000))
      ]);
      break;
    } catch (connErr: any) {
      console.warn(`GATT Services fetch failed (${connectionAttempts} attempts left):`, connErr.message);
      connectionAttempts--;
      if (connectionAttempts === 0) throw connErr;
      // Wait and let the OS settle before trying again
      await sleep(1500);
    }
  }

  const writable: any[] = [];
  for (const service of services) {
    try {
      const characteristics = await service.getCharacteristics();
      for (const char of characteristics) {
        console.log(`  -> ${service.uuid} / ${char.uuid} [write:${char.properties.write}, writeWoRes:${char.properties.writeWithoutResponse}]`);
        if (char.properties.write || char.properties.writeWithoutResponse) writable.push(char);
      }
    } catch {
      // Characteristics discovery not supported or failed for this service
    }
  }

  // Prefer known SPP TX characteristics, otherwise the first writable one.
  const pipe = writable.find(c => KNOWN_TX_UUIDS.includes(c.uuid)) ?? writable[0];
  if (!pipe) {
    throw new Error("No available write characteristic pipelines found.");
  }
  console.log(`Selected characteristic: ${pipe.uuid}`);
  return pipe;
}

async function writeToDevice(device: any, rawEscPosBytes: Uint8Array, isRetry = false): Promise<void> {
  rememberDevice(device);
  const conn = connections.get(device.id)!;

  try {
    if (!device.gatt?.connected || !conn.pipe) {
      conn.pipe = await openWritePipe(device);
    }
    const pipe = conn.pipe;

    const printerName = (device.name || '').toUpperCase();
    const isGenericModel = printerName.includes('MPT-II') || printerName.includes('JK-58');

    // Use 20 for generic printers that drop large BLE MTUs (like JK-5801H), otherwise preserve 128 for others
    const chunkSize = isGenericModel ? 20 : 128;
    const chunkDelay = isGenericModel ? 20 : 100;

    for (let i = 0; i < rawEscPosBytes.length; i += chunkSize) {
      const chunk = rawEscPosBytes.slice(i, i + chunkSize);
      // Prefer writeWithoutResponse if available (some generic devices hang on writeWithResponse)
      if (pipe.properties.writeWithoutResponse) {
        await pipe.writeValueWithoutResponse(chunk);
        // Small delay to prevent hardware buffer overflow
        await sleep(chunkDelay);
      } else {
        await pipe.writeValueWithResponse(chunk);
      }
    }
    // We intentionally DO NOT disconnect: good printers keep the link for fast consecutive prints.
  } catch (error: any) {
    console.warn(`[WARN] GATT Operation failed on ${device.name}:`, error.message);
    try {
      if (device.gatt?.connected) device.gatt.disconnect();
    } catch {
      // Ignore disconnect errors during cleanup
    }
    conn.pipe = null;

    if (!isRetry) {
      console.log("Attempting automatic retry to recover Bluetooth connection...");
      await sleep(1500);
      return writeToDevice(device, rawEscPosBytes, true);
    }
    throw error;
  } finally {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGE_EVENT));
  }
}

/**
 * Sends raw ESC/POS bytes to every printer on this device assigned to the given role.
 * Printers are written one after another; a failure on one printer does not stop the others.
 */
export async function sendToGlobalThermalPrinter(rawEscPosBytes: Uint8Array, role: PrinterRole = 'receipts'): Promise<void> {
  if (isPrinting) {
    console.warn("A print job is already in progress. Please wait a moment.");
    return;
  }
  isPrinting = true;

  try {
    await ensureBluetoothPrinter(role);
    const { targets, missing } = await resolvePrinters(role);
    const failures = missing.map(p => `${p.name} (not connected — reconnect it in Settings → Printers)`);

    for (const { printer, device } of targets) {
      try {
        await writeToDevice(device, rawEscPosBytes);
      } catch (err: any) {
        console.error(`[CRITICAL] Printing failed on ${printer.name}:`, err);
        failures.push(`${printer.name} (${err?.message || 'unknown error'})`);
      }
    }

    if (failures.length > 0) {
      alert(`Printing failed on:\n${failures.join('\n')}`);
    } else {
      console.log(`Print job completed on ${targets.length} printer(s).`);
    }
  } catch (error: any) {
    console.error("[CRITICAL] Global Printing Engine Failure:", error);
    alert(`Printing Failed: ${error.message}`);
  } finally {
    isPrinting = false;
  }
}

/** Prints a short test slip on one saved printer. Call from a button click. */
export async function printBluetoothTestPage(id: string): Promise<void> {
  const printer = getSavedPrinters().find(p => p.id === id);
  if (!printer) throw new Error('Printer not found.');

  let device = connections.get(id)?.device ?? (await getPermittedDevices()).find(d => d.id === id);
  if (!device) {
    // Browser can't restore the saved handle; let the user pick it again.
    device = await requestPrinterDevice();
    if (device.id !== id) {
      savePrinters(getSavedPrinters().map(p => (p.id === id ? { ...p, id: device.id, name: device.name || p.name } : p)));
    }
  }

  const roles = [printer.kitchen && 'Kitchen tickets', printer.receipts && 'Receipts & reports'].filter(Boolean).join(', ') || 'Nothing assigned';
  const encoder = new TextEncoder();
  const bytes = new Uint8Array([
    0x1B, 0x40,             // INIT
    0x1B, 0x61, 0x01,       // ALIGN CENTER
    0x1B, 0x45, 0x01,       // BOLD ON
    ...encoder.encode('TEST PRINT\n'),
    0x1B, 0x45, 0x00,       // BOLD OFF
    ...encoder.encode(`${printer.name}\n`),
    ...encoder.encode(`Prints: ${roles}\n`),
    ...encoder.encode(`${new Date().toLocaleString()}\n\n\n\n`),
    0x1D, 0x56, 0x42, 0x00  // CUT
  ]);
  await writeToDevice(device, bytes);
}

/**
 * Helper to wrap text according to the 32-character limit of the 58mm printer.
 */
export function wrapText(text: string, maxLength: number = 32): string[] {
  const lines: string[] = [];
  const words = text.split(' ');
  let currentLine = '';

  for (const word of words) {
    if ((currentLine + word).length > maxLength) {
      if (currentLine) {
        lines.push(currentLine.trim());
      }
      currentLine = word + ' ';
    } else {
      currentLine += word + ' ';
    }
  }
  if (currentLine) {
    lines.push(currentLine.trim());
  }
  return lines;
}

/**
 * Helper to pad a string to exactly a certain length (useful for aligning columns)
 */
export function padRight(text: string, length: number = 32): string {
  return text.padEnd(length, ' ').substring(0, length);
}

export function padLeft(text: string, length: number = 32): string {
  return text.padStart(length, ' ').substring(0, length);
}

/**
 * Format a key-value line where key is on the left, value is on the right, e.g. "Total:       Php 500.00"
 */
export function formatKeyValueLine(key: string, value: string, length: number = 32): string {
  if (key.length + value.length > length) {
    return key.substring(0, length - value.length - 1) + ' ' + value;
  }
  return key + value.padStart(length - key.length, ' ');
}

/**
 * Generates ESC/POS byte array for a thermal invoice and sends it to the printer
 */
export async function printBluetoothThermalInvoice(sale: any, template: any = {}) {
  const encoder = new TextEncoder();
  const payload: number[] = [];

  // Commands
  const INIT = [0x1B, 0x40];
  const ALIGN_CENTER = [0x1B, 0x61, 0x01];
  const ALIGN_LEFT = [0x1B, 0x61, 0x00];
  const BOLD_ON = [0x1B, 0x45, 0x01];
  const BOLD_OFF = [0x1B, 0x45, 0x00];
  const CUT = [0x1D, 0x56, 0x42, 0x00];

  payload.push(...INIT);

  // Header
  payload.push(...ALIGN_CENTER);
  payload.push(...BOLD_ON);
  const merchantName = template.merchant_name || 'Dr. Humba';
  for (const line of wrapText(merchantName.toUpperCase(), 32)) {
    payload.push(...encoder.encode(line + '\n'));
  }
  payload.push(...BOLD_OFF);

  if (template.merchant_address) {
    for (const line of wrapText(template.merchant_address, 32)) {
      payload.push(...encoder.encode(line + '\n'));
    }
  }
  if (template.merchant_contact) {
    payload.push(...encoder.encode(template.merchant_contact + '\n'));
  }
  if (template.merchant_tin && template.merchant_tin.trim().length > 0) {
    payload.push(...encoder.encode(template.merchant_tin.trim() + '\n'));
  }

  payload.push(...encoder.encode('--------------------------------\n'));

  payload.push(...BOLD_ON);
  const headerText = (template.header_text && template.header_text !== 'SALES INVOICE') ? template.header_text : 'BILL';
  payload.push(...encoder.encode(headerText + '\n'));
  payload.push(...BOLD_OFF);
  payload.push(...encoder.encode('THIS DOCUMENT IS NOT VALID\nFOR CLAIM OF INPUT TAX\n'));
  payload.push(...encoder.encode('An OR will be issued\nupon payment\n'));

  payload.push(...encoder.encode('--------------------------------\n'));

  // Details
  payload.push(...ALIGN_LEFT);
  const dateStr = new Date(sale.created_at || new Date()).toLocaleString();
  payload.push(...encoder.encode(formatKeyValueLine('Date:', dateStr, 32) + '\n'));

  const invoiceNo = sale.control_number || String(sale.id).substring(0, 8);
  payload.push(...encoder.encode(formatKeyValueLine('Invoice No:', invoiceNo, 32) + '\n'));

  const branchName = sale.branch_name || 'Main Branch';
  payload.push(...encoder.encode(formatKeyValueLine('Branch:', branchName, 32) + '\n'));

  let cashierName = sale.cashier_email?.split('@')[0] || 'Staff';
  if (cashierName.length > 15) cashierName = cashierName.substring(0, 15);
  payload.push(...encoder.encode(formatKeyValueLine('Cashier:', cashierName, 32) + '\n'));

  const saleType = sale.sale_category || 'Dine in';
  payload.push(...encoder.encode(formatKeyValueLine('Sale Type:', saleType, 32) + '\n'));

  payload.push(...encoder.encode('--------------------------------\n'));

  // Items
  if (sale.items && Array.isArray(sale.items)) {
    for (const item of sale.items) {
      const itemName = item.item_name || item.name || 'Unknown Item';
      payload.push(...BOLD_ON);
      payload.push(...encoder.encode(String(itemName).toUpperCase() + '\n'));
      payload.push(...BOLD_OFF);
      const qtyStr = `  ${item.quantity} x P${Number(item.unit_price).toFixed(2)}`;
      const subtotalStr = `P${Number(item.subtotal).toFixed(2)}`;
      payload.push(...encoder.encode(formatKeyValueLine(qtyStr, subtotalStr, 32) + '\n'));
    }
  }

  payload.push(...encoder.encode('--------------------------------\n'));

  // Totals & BIR Compliance Breakdown
  const vatableSales = Number(sale.vatable_sales || 0);
  const vatAmount = Number(sale.vat_amount || 0);
  const vatExemptSales = Number(sale.vat_exempt_sales || 0);
  const discountAmt = Number(sale.discount_amount || 0);
  const vatRelief = vatExemptSales > 0 ? vatExemptSales * 0.12 : 0;
  const grossSales = (vatableSales + vatAmount) + (vatExemptSales * 1.12);

  payload.push(...encoder.encode(formatKeyValueLine('Gross Sales:', `P${grossSales.toFixed(2)}`, 32) + '\n'));
  if (vatRelief > 0) {
    payload.push(...encoder.encode(formatKeyValueLine('12% VAT Relief:', `-P${vatRelief.toFixed(2)}`, 32) + '\n'));
  }
  if (discountAmt > 0) {
    const discLabel = `Discount (${(sale.discount_type || 'DISC').toUpperCase()}):`;
    payload.push(...encoder.encode(formatKeyValueLine(discLabel, `-P${discountAmt.toFixed(2)}`, 32) + '\n'));
  }
  if (Number(sale.service_charge_amount || 0) > 0) {
    payload.push(...encoder.encode(formatKeyValueLine('Service Charge:', `P${Number(sale.service_charge_amount).toFixed(2)}`, 32) + '\n'));
  }

  payload.push(...BOLD_ON);
  const totalStr = `P${Number(sale.total_amount).toFixed(2)}`;
  payload.push(...encoder.encode(formatKeyValueLine('TOTAL VALUE:', totalStr, 32) + '\n'));
  payload.push(...BOLD_OFF);

  payload.push(...encoder.encode('--------------------------------\n'));
  payload.push(...encoder.encode(formatKeyValueLine('VATable Sales:', `P${vatableSales.toFixed(2)}`, 32) + '\n'));
  payload.push(...encoder.encode(formatKeyValueLine('VAT Amount (12%):', `P${vatAmount.toFixed(2)}`, 32) + '\n'));
  payload.push(...encoder.encode(formatKeyValueLine('VAT-Exempt Sales:', `P${vatExemptSales.toFixed(2)}`, 32) + '\n'));
  payload.push(...encoder.encode(formatKeyValueLine('Zero-Rated Sales:', 'P0.00', 32) + '\n'));

  const pMethod = String(sale.payment_method || sale.method || 'cash').toLowerCase();
  const isCash = pMethod === 'cash';
  const rawTendered = sale.amount_tendered !== null && sale.amount_tendered !== undefined
    ? Number(sale.amount_tendered)
    : (isCash ? Number(sale.total_amount || 0) : null);
  const changeGiven = Number(sale.change_given ?? sale.change ?? 0);

  payload.push(...encoder.encode('--------------------------------\n'));
  if (isCash) {
    if (rawTendered !== null && !isNaN(rawTendered)) {
      payload.push(...encoder.encode(formatKeyValueLine('Cash:', `P${rawTendered.toFixed(2)}`, 32) + '\n'));
    }
    payload.push(...encoder.encode(formatKeyValueLine('Change:', `P${changeGiven.toFixed(2)}`, 32) + '\n'));
  } else {
    payload.push(...encoder.encode(formatKeyValueLine('Payment Method:', pMethod.toUpperCase(), 32) + '\n'));
    if (sale.reference_number) {
      payload.push(...encoder.encode(formatKeyValueLine('Ref No:', String(sale.reference_number), 32) + '\n'));
    }
    if (rawTendered !== null && !isNaN(rawTendered)) {
      payload.push(...encoder.encode(formatKeyValueLine('Amount Paid:', `P${rawTendered.toFixed(2)}`, 32) + '\n'));
    }
    payload.push(...encoder.encode(formatKeyValueLine('Change:', `P${changeGiven.toFixed(2)}`, 32) + '\n'));
  }

  if (sale.discount_metadata && sale.discount_metadata.length > 0) {
    payload.push(...encoder.encode('--------------------------------\n'));
    payload.push(...ALIGN_CENTER);
    payload.push(...encoder.encode('DISCOUNT DETAILS\n'));
    payload.push(...ALIGN_LEFT);
    for (const dm of sale.discount_metadata) {
      payload.push(...encoder.encode(`Type: ${dm.type}\n`));
      payload.push(...encoder.encode(`ID: ${dm.id || 'N/A'}\n`));
      payload.push(...encoder.encode(`Name: ${dm.name || 'N/A'}\n\n`));
    }
    payload.push(...ALIGN_CENTER);
    payload.push(...encoder.encode('\n-----------------------\n'));
    payload.push(...encoder.encode('Customer Signature\n'));
    payload.push(...ALIGN_LEFT);
  }

  payload.push(...encoder.encode('--------------------------------\n'));

  // Footer
  payload.push(...ALIGN_CENTER);
  payload.push(...encoder.encode('THIS DOCUMENT IS NOT VALID\nFOR CLAIM OF INPUT TAX\n'));
  payload.push(...encoder.encode('An OR will be issued\nupon payment\n\n'));
  const footerText = template.footer_text || 'Thank you for dining with us!\nCome back again!';
  const footerLines = footerText.split('\n');
  for (const line of footerLines) {
    for (const wrapped of wrapText(line, 32)) {
      payload.push(...encoder.encode(wrapped + '\n'));
    }
  }

  payload.push(...encoder.encode(`\n${merchantName}\n\n\n`));

  // Cut
  payload.push(...CUT);

  await sendToGlobalThermalPrinter(new Uint8Array(payload));
}

/**
 * Generates ESC/POS byte array for a kitchen receipt and sends it to the printer
 */
export async function printBluetoothKitchenReceipt(
  sale: any,
  template?: Partial<KitchenReceiptTemplate>
) {
  const bytes = buildKitchenEscPosBytes(sale, template);
  // Same full ticket goes to every printer assigned to kitchen tickets (e.g. kitchen + bar).
  await sendToGlobalThermalPrinter(bytes, 'kitchen');
}

export async function printBluetoothXZReport(summary: any, isZRead: boolean, terminalName: string) {
  const encoder = new TextEncoder();
  const payload: number[] = [];
  const INIT = [0x1B, 0x40];
  const ALIGN_CENTER = [0x1B, 0x61, 0x01];
  const ALIGN_LEFT = [0x1B, 0x61, 0x00];
  const BOLD_ON = [0x1B, 0x45, 0x01];
  const BOLD_OFF = [0x1B, 0x45, 0x00];
  const CUT = [0x1D, 0x56, 0x42, 0x00];

  const formatPHP = (val: number) => 'P' + (val || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const totalPayments = Number(
    summary.totalPayments ?? (
      Number(summary.cashSales || 0) +
      Number(summary.gcashSales || 0) +
      Number(summary.mayaSales || 0) +
      Number(summary.cardSales || 0) +
      Number(summary.otherSales || 0)
    )
  );

  payload.push(...INIT);
  payload.push(...ALIGN_CENTER);
  payload.push(...BOLD_ON);
  payload.push(...encoder.encode(`${terminalName.toUpperCase()}\n`));
  payload.push(...encoder.encode(`${isZRead ? 'Z-READ CLOSED REPORT' : 'X-READ SUMMARY'}\n`));
  payload.push(...BOLD_OFF);
  payload.push(...encoder.encode('--------------------------------\n'));
  payload.push(...ALIGN_LEFT);
  payload.push(...encoder.encode(formatKeyValueLine('Status:', (summary.status || '').toUpperCase(), 32) + '\n'));
  if (summary.controlNumber) {
    payload.push(...encoder.encode(formatKeyValueLine('Control No:', summary.controlNumber, 32) + '\n'));
  }
  payload.push(...encoder.encode(formatKeyValueLine('Z-Counter:', `#${String(summary.zCounter || 0).padStart(5, '0')}`, 32) + '\n'));
  const cashierDisplayName = summary.cashierName || (summary.cashierEmail ? summary.cashierEmail.split('@')[0] : '') || summary.cashier || '';
  if (cashierDisplayName) {
    payload.push(...encoder.encode(formatKeyValueLine('Cashier:', cashierDisplayName, 32) + '\n'));
  }
  const shiftDisplayName = summary.shiftName || summary.shift_name || '';
  if (shiftDisplayName) {
    payload.push(...encoder.encode(formatKeyValueLine('Shift:', shiftDisplayName, 32) + '\n'));
  }
  payload.push(...encoder.encode(formatKeyValueLine('Opened:', new Date(summary.openedAt).toLocaleString('en-US', { hour12: false }), 32) + '\n'));
  if (isZRead && summary.closedAt) {
    payload.push(...encoder.encode(formatKeyValueLine('Closed:', new Date(summary.closedAt).toLocaleString('en-US', { hour12: false }), 32) + '\n'));
  }
  payload.push(...encoder.encode('--------------------------------\n'));

  payload.push(...ALIGN_CENTER);
  payload.push(...BOLD_ON);
  payload.push(...encoder.encode('SALES SUMMARY\n'));
  payload.push(...BOLD_OFF);
  payload.push(...ALIGN_LEFT);
  payload.push(...encoder.encode(formatKeyValueLine('Gross Sales:', formatPHP(summary.grossSales), 32) + '\n'));
  payload.push(...encoder.encode(formatKeyValueLine('Net Sales:', formatPHP(summary.netSales), 32) + '\n'));
  payload.push(...encoder.encode(formatKeyValueLine('VAT (12%):', formatPHP(summary.vatAmount), 32) + '\n'));
  if (Number(summary.vatExemptSales || 0) > 0) {
    payload.push(...encoder.encode(formatKeyValueLine('VAT-Exempt:', formatPHP(summary.vatExemptSales), 32) + '\n'));
  }
  if (Number(summary.discountAmount || 0) > 0) {
    payload.push(...encoder.encode(formatKeyValueLine('Discounts:', formatPHP(summary.discountAmount), 32) + '\n'));
  }
  if (Number(summary.serviceChargeTotal || 0) > 0) {
    payload.push(...encoder.encode(formatKeyValueLine('Service Chg:', formatPHP(summary.serviceChargeTotal), 32) + '\n'));
  }
  payload.push(...encoder.encode(formatKeyValueLine('Tx Count:', String(summary.transactionCount), 32) + '\n'));
  payload.push(...BOLD_ON);
  payload.push(...encoder.encode(formatKeyValueLine('Net Due / Paid:', formatPHP(totalPayments), 32) + '\n'));
  payload.push(...BOLD_OFF);

  payload.push(...encoder.encode('--------------------------------\n'));
  payload.push(...ALIGN_CENTER);
  payload.push(...BOLD_ON);
  payload.push(...encoder.encode('PAYMENTS\n'));
  payload.push(...BOLD_OFF);
  payload.push(...ALIGN_LEFT);
  payload.push(...encoder.encode(formatKeyValueLine('Cash:', formatPHP(summary.cashSales), 32) + '\n'));
  if (summary.gcashSales > 0) payload.push(...encoder.encode(formatKeyValueLine('GCash:', formatPHP(summary.gcashSales), 32) + '\n'));
  if (summary.mayaSales > 0) payload.push(...encoder.encode(formatKeyValueLine('Maya:', formatPHP(summary.mayaSales), 32) + '\n'));
  if (summary.cardSales > 0) payload.push(...encoder.encode(formatKeyValueLine('Card:', formatPHP(summary.cardSales), 32) + '\n'));
  if (summary.otherSales > 0) payload.push(...encoder.encode(formatKeyValueLine('Other:', formatPHP(summary.otherSales), 32) + '\n'));
  payload.push(...BOLD_ON);
  payload.push(...encoder.encode(formatKeyValueLine('Total Payments:', formatPHP(totalPayments), 32) + '\n'));
  payload.push(...BOLD_OFF);

  payload.push(...encoder.encode('--------------------------------\n'));
  payload.push(...ALIGN_CENTER);
  payload.push(...BOLD_ON);
  payload.push(...encoder.encode('DRAWER FLOW\n'));
  payload.push(...BOLD_OFF);
  payload.push(...ALIGN_LEFT);
  payload.push(...encoder.encode(formatKeyValueLine('Float:', formatPHP(summary.openingBalance), 32) + '\n'));
  payload.push(...encoder.encode(formatKeyValueLine('Exp Cash:', formatPHP(summary.cashSales), 32) + '\n'));
  payload.push(...BOLD_ON);
  payload.push(...encoder.encode(formatKeyValueLine('Exp Drawer:', formatPHP(summary.openingBalance + summary.cashSales), 32) + '\n'));
  if (isZRead) {
    payload.push(...encoder.encode(formatKeyValueLine('Act Drawer:', formatPHP(summary.actualCash), 32) + '\n'));
    payload.push(...encoder.encode(formatKeyValueLine('Discrepancy:', formatPHP(summary.discrepancy), 32) + '\n'));
  }
  payload.push(...BOLD_OFF);

  payload.push(...encoder.encode('\n\n\n'));
  payload.push(...CUT);
  await sendToGlobalThermalPrinter(new Uint8Array(payload));
}

export async function printBluetoothEODReport(report: any) {
  const encoder = new TextEncoder();
  const payload: number[] = [];
  const INIT = [0x1B, 0x40];
  const ALIGN_CENTER = [0x1B, 0x61, 0x01];
  const ALIGN_LEFT = [0x1B, 0x61, 0x00];
  const BOLD_ON = [0x1B, 0x45, 0x01];
  const BOLD_OFF = [0x1B, 0x45, 0x00];
  const CUT = [0x1D, 0x56, 0x42, 0x00];

  const formatPHP = (val: number) => 'P' + (val || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  payload.push(...INIT);
  payload.push(...ALIGN_CENTER);
  payload.push(...BOLD_ON);
  payload.push(...encoder.encode(`${(report.branchName || 'UNKNOWN BRANCH').toUpperCase()}\n`));
  payload.push(...encoder.encode(`END OF DAY REPORT\n`));
  payload.push(...BOLD_OFF);
  payload.push(...encoder.encode('--------------------------------\n'));

  payload.push(...ALIGN_LEFT);
  payload.push(...encoder.encode(formatKeyValueLine('Z-No:', report.controlNumber, 32) + '\n'));
  payload.push(...encoder.encode(formatKeyValueLine('Open:', report.shiftOpenTime, 32) + '\n'));
  payload.push(...encoder.encode(formatKeyValueLine('Close:', report.shiftCloseTime, 32) + '\n'));
  payload.push(...encoder.encode(formatKeyValueLine('Printed:', report.reportDate, 32) + '\n'));

  payload.push(...encoder.encode('--------------------------------\n'));
  payload.push(...ALIGN_CENTER);
  payload.push(...BOLD_ON);
  payload.push(...encoder.encode('SALES & REFUNDS\n'));
  payload.push(...BOLD_OFF);
  payload.push(...ALIGN_LEFT);
  payload.push(...encoder.encode(formatKeyValueLine('Gross:', formatPHP(report.salesSummary?.salesAmt), 32) + '\n'));
  payload.push(...encoder.encode(formatKeyValueLine('Refunds:', formatPHP(report.salesSummary?.refundsAmt), 32) + '\n'));
  payload.push(...encoder.encode(formatKeyValueLine('Net:', formatPHP(report.salesSummary?.netAmt), 32) + '\n'));
  payload.push(...encoder.encode(formatKeyValueLine('VAT:', formatPHP(report.vatAmount), 32) + '\n'));

  payload.push(...encoder.encode('--------------------------------\n'));
  payload.push(...ALIGN_CENTER);
  payload.push(...BOLD_ON);
  payload.push(...encoder.encode('DRAWER RECONCILIATION\n'));
  payload.push(...BOLD_OFF);
  payload.push(...ALIGN_LEFT);
  payload.push(...encoder.encode(formatKeyValueLine('Opening Cash:', formatPHP(report.openingCash), 32) + '\n'));
  payload.push(...encoder.encode(formatKeyValueLine('Cash Sales:', formatPHP(report.cashSales), 32) + '\n'));
  payload.push(...encoder.encode(formatKeyValueLine('Cash Refunds:', formatPHP(report.cashRefunds), 32) + '\n'));
  payload.push(...BOLD_ON);
  payload.push(...encoder.encode(formatKeyValueLine('Expected Drawer:', formatPHP(report.expectedDrawer), 32) + '\n'));
  payload.push(...encoder.encode(formatKeyValueLine('Actual Drawer:', formatPHP(report.actualDrawer), 32) + '\n'));
  payload.push(...encoder.encode(formatKeyValueLine('Over/Short:', formatPHP(report.overShort), 32) + '\n'));
  payload.push(...BOLD_OFF);

  payload.push(...encoder.encode('\n\n\n'));
  payload.push(...CUT);
  await sendToGlobalThermalPrinter(new Uint8Array(payload));
}

export async function printBluetoothRunningBill(bill: any, template: any = {}) {
  await ensureBluetoothPrinter();

  const payload: number[] = [];
  const encoder = new TextEncoder();

  const INIT = [0x1B, 0x40];
  const ALIGN_CENTER = [0x1B, 0x61, 0x01];
  const ALIGN_LEFT = [0x1B, 0x61, 0x00];
  const BOLD_ON = [0x1B, 0x45, 0x01];
  const BOLD_OFF = [0x1B, 0x45, 0x00];
  const CUT = [0x1D, 0x56, 0x42, 0x00];

  payload.push(...INIT);
  payload.push(...ALIGN_CENTER);
  payload.push(...BOLD_ON);

  const businessName = template.business_name || 'RESTAURANT';
  payload.push(...encoder.encode(businessName.toUpperCase() + '\n'));
  payload.push(...BOLD_OFF);

  const branchName = template.branch_name || bill.branch_name || '';
  if (branchName) payload.push(...encoder.encode(branchName + '\n'));
  if (template.address) payload.push(...encoder.encode(template.address + '\n'));
  if (template.tin) payload.push(...encoder.encode(`TIN: ${template.tin}\n`));

  payload.push(...encoder.encode('--------------------------------\n'));
  payload.push(...BOLD_ON);
  payload.push(...encoder.encode('*** GUEST CHECK / RUNNING BILL ***\n'));
  payload.push(...BOLD_OFF);
  payload.push(...encoder.encode('(NOT AN OFFICIAL SALES INVOICE)\n'));
  payload.push(...encoder.encode('--------------------------------\n'));

  payload.push(...ALIGN_LEFT);
  payload.push(...BOLD_ON);
  payload.push(...encoder.encode(formatKeyValueLine('TABLE:', (bill.table_number || '').toUpperCase(), 32) + '\n'));
  payload.push(...BOLD_OFF);
  payload.push(...encoder.encode(formatKeyValueLine('PAX:', String(bill.pax_count || 1), 32) + '\n'));

  const dateStr = new Date(bill.created_at || new Date()).toLocaleString('en-US', {
    dateStyle: 'short',
    timeStyle: 'short'
  });
  payload.push(...encoder.encode(formatKeyValueLine('Date:', dateStr, 32) + '\n'));

  if (bill.server_name) {
    payload.push(...encoder.encode(formatKeyValueLine('Server:', bill.server_name, 32) + '\n'));
  }
  if (bill.cashier_email) {
    let staffName = bill.cashier_email.split('@')[0];
    if (staffName.length > 15) staffName = staffName.substring(0, 15);
    payload.push(...encoder.encode(formatKeyValueLine('Staff:', staffName, 32) + '\n'));
  }

  payload.push(...encoder.encode('--------------------------------\n'));

  // Items
  if (bill.items && Array.isArray(bill.items)) {
    for (const item of bill.items) {
      const itemName = item.name || item.item_name || 'Unknown Item';
      payload.push(...BOLD_ON);
      payload.push(...encoder.encode(String(itemName).toUpperCase() + '\n'));
      payload.push(...BOLD_OFF);

      const itemSub = Number(item.subtotal ?? (item.quantity * item.price));
      const qtyStr = `  ${item.quantity} x P${Number(item.price).toFixed(2)}`;
      const subtotalStr = `P${itemSub.toFixed(2)}`;
      payload.push(...encoder.encode(formatKeyValueLine(qtyStr, subtotalStr, 32) + '\n'));
      if (item.notes) {
        payload.push(...encoder.encode(`  * ${item.notes}\n`));
      }
    }
  }

  payload.push(...encoder.encode('--------------------------------\n'));

  // Subtotal & Discounts
  const subtotal = Number(bill.subtotal || 0);
  payload.push(...encoder.encode(formatKeyValueLine('Gross Subtotal:', `P${subtotal.toFixed(2)}`, 32) + '\n'));

  if (Number(bill.vat_exempt_amount || 0) > 0) {
    payload.push(...encoder.encode(formatKeyValueLine('12% VAT Relief:', `-P${Number(bill.vat_exempt_amount).toFixed(2)}`, 32) + '\n'));
  }

  if (Number(bill.discount_amount || 0) > 0) {
    let discType = (bill.discount_type || 'DISC').toUpperCase();
    if (discType === 'SC') discType = 'SENIOR';
    payload.push(...encoder.encode(formatKeyValueLine(`Discount (${discType}):`, `-P${Number(bill.discount_amount).toFixed(2)}`, 32) + '\n'));
  }

  // Service Charge (NO percentage, exactly as requested!)
  if (Number(bill.service_charge_amount || 0) > 0) {
    payload.push(...encoder.encode(formatKeyValueLine('Service Charge:', `P${Number(bill.service_charge_amount).toFixed(2)}`, 32) + '\n'));
  }

  if (Number(bill.vat_amount || 0) > 0) {
    payload.push(...encoder.encode(formatKeyValueLine('12% VAT:', `P${Number(bill.vat_amount).toFixed(2)}`, 32) + '\n'));
  }

  payload.push(...encoder.encode('--------------------------------\n'));
  payload.push(...BOLD_ON);
  const totalStr = `P${Number(bill.payable_total || 0).toFixed(2)}`;
  payload.push(...encoder.encode(formatKeyValueLine('TOTAL AMOUNT DUE:', totalStr, 32) + '\n'));
  payload.push(...BOLD_OFF);
  payload.push(...encoder.encode('--------------------------------\n'));

  payload.push(...ALIGN_CENTER);
  payload.push(...encoder.encode('FOR BILLING PURPOSES ONLY\n'));
  if (Number(bill.discount_amount || 0) > 0) {
    payload.push(...encoder.encode('Discounts already applied.\n'));
  } else {
    payload.push(...encoder.encode('Present Senior/PWD ID before pay.\n'));
  }
  payload.push(...encoder.encode('Thank you for dining with us!\n'));

  payload.push(...encoder.encode('\n\n\n'));
  payload.push(...CUT);
  await sendToGlobalThermalPrinter(new Uint8Array(payload));
}

