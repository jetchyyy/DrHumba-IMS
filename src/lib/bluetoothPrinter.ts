/**
 * Global State to hold the active device reference once selected.
 * This prevents the user from having to select the printer for every single button click.
 */
let globalConnectedPrinter: any = null;
let globalWritePipe: any = null;
let isPrinting = false;
const COMMON_PRINTER_SERVICES = [
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // Dothantech / Deli
  '000018f0-0000-1000-8000-00805f9b34fb', // Generic ESC/POS
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // ISDC / Serial
  '0000fee7-0000-1000-8000-00805f9b34fb', // Generic
  '0000ffe0-0000-1000-8000-00805f9b34fb', // Generic BLE Serial (often used by JK-5802H)
  '0000ff00-0000-1000-8000-00805f9b34fb'  // Another generic BLE Serial
];

/**
 * Core Global Controller. Call this single function inside EVERY print button
 * event handler throughout the application.
 */
export const ensureBluetoothPrinter = async () => {
  const nav = navigator as any;

  // 1. If we already have it in current page memory, return it
  if (globalConnectedPrinter) {
    return globalConnectedPrinter;
  }

  // 2. Try to retrieve previously permitted devices (bypasses popup across page reloads in modern Chrome)
  if (nav.bluetooth.getDevices) {
    try {
      const devices = await nav.bluetooth.getDevices();
      if (devices && devices.length > 0) {
        // Just pick the first previously permitted device. 
        // The user explicitly granted it access to this site, so it's their intended printer.
        console.log("Found previously paired device via getDevices():", devices[0].name);
        globalConnectedPrinter = devices[0];
        return globalConnectedPrinter;
      }
    } catch (err) {
      console.warn("getDevices() failed or not permitted:", err);
    }
  }

  // 3. Fallback: Request device explicitly (shows pairing popup)
  console.log("No printer active in state. Initializing device discovery popup...");
  globalConnectedPrinter = await nav.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: COMMON_PRINTER_SERVICES
  });
  
  return globalConnectedPrinter;
};

/**
 * Core Global Controller. Call this single function inside EVERY print button
 * to send raw ESC/POS bytes to the remembered device.
 */
export async function sendToGlobalThermalPrinter(rawEscPosBytes: Uint8Array, isRetry = false): Promise<void> {
  if (isPrinting && !isRetry) {
    console.warn("A print job is already in progress. Please wait a moment.");
    return;
  }
  if (!isRetry) isPrinting = true;

  try {
    // 1. Ensure printer is connected (uses existing if available)
    await ensureBluetoothPrinter();

    // 2. Open live RFCOMM/GATT pipe to execute the print job
    if (!globalConnectedPrinter.gatt) {
        throw new Error("GATT server not found on device.");
    }

    if (!globalConnectedPrinter.gatt.connected || !globalWritePipe) {
        console.log(`Connecting to GATT Server: ${globalConnectedPrinter.name}`);
        
        let server: any;
        let services: any[] = [];
        let connectionAttempts = 3;
        
        while (connectionAttempts > 0) {
            try {
                // Prevent infinite hang on Windows Web Bluetooth zombie objects
                server = await Promise.race([
                    globalConnectedPrinter.gatt.connect(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error("GATT connect timeout. Device may be asleep.")), 4000))
                ]);
                
                // Crucial delay: Windows/Chrome needs time before GATT tables are accessible after a reconnect
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                services = await Promise.race([
                    server.getPrimaryServices(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error("GATT services timeout. Device unresponsive.")), 4000))
                ]);
                
                break; // Success
            } catch (connErr: any) {
                console.warn(`GATT Services fetch failed (${connectionAttempts} attempts left):`, connErr.message);
                connectionAttempts--;
                if (connectionAttempts === 0) throw connErr;
                // Wait and let the OS settle before trying again
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
        }
        
        // Find a valid service and write characteristic
        let writePipe: any = null;
        
        const knownTxUuids = [
          '0000ff02-0000-1000-8000-00805f9b34fb', // Priority 1: Common JK-58 / MPT-II transparent serial
          '00002af1-0000-1000-8000-00805f9b34fb', // Priority 2: Official Bluetooth SIG ESC/POS
          '49535343-8841-43f4-a8d4-ecbe34729bb3', // Priority 3: ISSC SPP
          'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f', // Priority 4: Deli / Dothantech
          '0000ffe1-0000-1000-8000-00805f9b34fb',
          '0000fec9-0000-1000-8000-00805f9b34fb'
        ];

        // Debug logging for all discovered services and characteristics
        console.log("--- Discovering Services & Characteristics ---");
        for (const service of services) {
          console.log(`Service: ${service.uuid}`);
          try {
            const characteristics = await service.getCharacteristics();
            for (const char of characteristics) {
              console.log(`  -> Char: ${char.uuid} [write:${char.properties.write}, writeWoRes:${char.properties.writeWithoutResponse}]`);
            }
          } catch(e) {}
        }
        console.log("----------------------------------------------");

        // Priority 1: Look for known SPP TX characteristics
        for (const service of services) {
          try {
            const characteristics = await service.getCharacteristics();
            for (const char of characteristics) {
              if (knownTxUuids.includes(char.uuid) && (char.properties.write || char.properties.writeWithoutResponse)) {
                writePipe = char;
                console.log(`Selected PRIORITY characteristic: ${char.uuid}`);
                break;
              }
            }
          } catch(e) {}
          if (writePipe) break;
        }

        // Priority 2: Fallback to the first writable characteristic found
        if (!writePipe) {
          for (const service of services) {
            try {
              const characteristics = await service.getCharacteristics();
              for (const char of characteristics) {
                if (char.properties.write || char.properties.writeWithoutResponse) {
                  writePipe = char;
                  console.log(`Selected FALLBACK characteristic: ${char.uuid}`);
                  break;
                }
              }
            } catch(e) {}
            if (writePipe) break;
          }
        }
        
        if (!writePipe) {
          throw new Error("No available write characteristic pipelines found.");
        }
        globalWritePipe = writePipe;
    }

    // 3. Stream the button's specific payload
    const printerName = (globalConnectedPrinter.name || '').toUpperCase();
    const isGenericModel = printerName.includes('MPT-II') || printerName.includes('JK-58');
    
    // Use 20 for generic printers that drop large BLE MTUs (like JK-5801H), otherwise preserve 128 for others
    const chunkSize = isGenericModel ? 20 : 128;
    const chunkDelay = isGenericModel ? 20 : 100;

    for (let i = 0; i < rawEscPosBytes.length; i += chunkSize) {
      const chunk = rawEscPosBytes.slice(i, i + chunkSize);
      
      // Prefer writeWithoutResponse if available (some generic devices hang on writeWithResponse)
      if (globalWritePipe.properties.writeWithoutResponse) {
        await globalWritePipe.writeValueWithoutResponse(chunk);
        // Small delay to prevent hardware buffer overflow
        await new Promise(resolve => setTimeout(resolve, chunkDelay));
      } else if (globalWritePipe.properties.write) {
        await globalWritePipe.writeValueWithResponse(chunk);
      }
    }
    console.log("Print job completed successfully.");
    
    // We intentionally DO NOT disconnect here. 
    // High-quality printers (like Deli) can maintain the connection for fast consecutive prints.
    // If a cheap printer (like JK-5802H) drops the connection, the catch block will cleanly reset the state.

  } catch (error: any) {
    console.warn("[WARN] GATT Operation failed:", error.message);
    
    // Clean up the dead/flaky connection
    if (globalConnectedPrinter && globalConnectedPrinter.gatt && globalConnectedPrinter.gatt.connected) {
        try { globalConnectedPrinter.gatt.disconnect(); } catch (e) {}
    }
    globalWritePipe = null;
    
    // Auto-retry exactly once if this wasn't already a retry
    if (!isRetry) {
        console.log("Attempting automatic retry to recover Bluetooth connection...");
        // Wait a tiny bit for OS to clean up the disconnect
        await new Promise(resolve => setTimeout(resolve, 1500));
        return await sendToGlobalThermalPrinter(rawEscPosBytes, true);
    }

    console.error("[CRITICAL] Global Printing Engine Failure after retry:", error);
    // Reset state on failure so the next button click lets the user re-select the hardware
    globalConnectedPrinter = null; 
    alert(`Printing Failed: ${error.message}`);
  } finally {
    if (!isRetry) {
        isPrinting = false;
    }
  }
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
    if (template.merchant_tin) {
        payload.push(...encoder.encode(template.merchant_tin + '\n'));
    }

    payload.push(...encoder.encode('--------------------------------\n'));
    
    payload.push(...BOLD_ON);
    const headerText = template.header_text || 'SALES INVOICE';
    payload.push(...encoder.encode(headerText + '\n'));
    payload.push(...BOLD_OFF);

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
    const grossSales = vatableSales + vatAmount + vatExemptSales + discountAmt;

    payload.push(...encoder.encode(formatKeyValueLine('Gross Sales:', `P${grossSales.toFixed(2)}`, 32) + '\n'));
    if (discountAmt > 0) {
        payload.push(...encoder.encode(formatKeyValueLine('Discount Total:', `-P${discountAmt.toFixed(2)}`, 32) + '\n'));
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

    if (sale.amount_tendered !== null && sale.amount_tendered !== undefined) {
        payload.push(...encoder.encode('--------------------------------\n'));
        payload.push(...encoder.encode(formatKeyValueLine('Tendered:', `P${Number(sale.amount_tendered).toFixed(2)}`, 32) + '\n'));
        const changeGiven = Number(sale.change_given || sale.change || 0);
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
export async function printBluetoothKitchenReceipt(sale: any) {
    const encoder = new TextEncoder();
    const payload: number[] = [];

    const INIT = [0x1B, 0x40];
    const ALIGN_CENTER = [0x1B, 0x61, 0x01];
    const ALIGN_LEFT = [0x1B, 0x61, 0x00];
    const BOLD_ON = [0x1B, 0x45, 0x01];
    const BOLD_OFF = [0x1B, 0x45, 0x00];
    const CUT = [0x1D, 0x56, 0x42, 0x00];

    payload.push(...INIT);
    payload.push(...ALIGN_CENTER);
    payload.push(...BOLD_ON);
    payload.push(...encoder.encode('*** KITCHEN ORDER ***\n\n'));
    payload.push(...BOLD_OFF);

    payload.push(...ALIGN_LEFT);
    const dateStr = new Date(sale.created_at || new Date()).toLocaleString();
    payload.push(...encoder.encode(`Date: ${dateStr}\n`));
    
    const invoiceNo = sale.control_number || String(sale.id).substring(0, 8);
    payload.push(...encoder.encode(`Order #: ${invoiceNo}\n`));
    
    const saleType = sale.sale_category || 'Dine in';
    payload.push(...encoder.encode(`Type: ${saleType}\n`));
    
    payload.push(...encoder.encode('--------------------------------\n'));

    payload.push(...BOLD_ON);
    if (sale.items && Array.isArray(sale.items)) {
        for (const item of sale.items) {
            const itemName = item.item_name || item.name || 'Unknown Item';
            const line = `${item.quantity} x ${itemName}`;
            for (const wrapped of wrapText(line, 32)) {
                payload.push(...encoder.encode(wrapped + '\n'));
            }
            if (item.notes) {
                payload.push(...BOLD_OFF);
                for (const wrapped of wrapText(`  Note: ${item.notes}`, 32)) {
                    payload.push(...encoder.encode(wrapped + '\n'));
                }
                payload.push(...BOLD_ON);
            }
        }
    }
    payload.push(...BOLD_OFF);

    payload.push(...encoder.encode('\n\n\n'));
    payload.push(...CUT);

    await sendToGlobalThermalPrinter(new Uint8Array(payload));
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
    
    payload.push(...INIT);
    payload.push(...ALIGN_CENTER);
    payload.push(...BOLD_ON);
    payload.push(...encoder.encode(`${terminalName.toUpperCase()}\n`));
    payload.push(...encoder.encode(`${isZRead ? 'Z-READ CLOSED REPORT' : 'X-READ SUMMARY'}\n`));
    payload.push(...BOLD_OFF);
    payload.push(...encoder.encode('--------------------------------\n'));
    payload.push(...ALIGN_LEFT);
    payload.push(...encoder.encode(formatKeyValueLine('Status:', (summary.status || '').toUpperCase(), 32) + '\n'));
    payload.push(...encoder.encode(formatKeyValueLine('Z-Counter:', `#${String(summary.zCounter || 0).padStart(5, '0')}`, 32) + '\n'));
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
    payload.push(...encoder.encode(formatKeyValueLine('Tx Count:', String(summary.transactionCount), 32) + '\n'));
    
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

