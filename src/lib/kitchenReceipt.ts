export interface KitchenReceiptTemplate {
  header_title: string;
  footer_text: string;
  paper_width: '58mm' | '80mm';
  font_size: 'small' | 'medium' | 'large';
  show_branch_name: boolean;
  show_cashier_name: boolean;
  show_date: boolean;
  show_order_number: boolean;
  show_order_type: boolean;
  show_notes: boolean;
  feed_lines: number;
}

export const DEFAULT_KITCHEN_RECEIPT_TEMPLATE: KitchenReceiptTemplate = {
  header_title: 'KITCHEN ORDER',
  footer_text: '* End of Kitchen Order *',
  paper_width: '58mm',
  font_size: 'medium',
  show_branch_name: false,
  show_cashier_name: false,
  show_date: true,
  show_order_number: true,
  show_order_type: true,
  show_notes: true,
  feed_lines: 3,
};

export function resolveKitchenReceiptTemplate(
  template?: Partial<KitchenReceiptTemplate> | null
): KitchenReceiptTemplate {
  const merged: KitchenReceiptTemplate = {
    ...DEFAULT_KITCHEN_RECEIPT_TEMPLATE,
    ...(template || {}),
  };

  merged.paper_width = merged.paper_width === '80mm' ? '80mm' : '58mm';
  merged.font_size =
    merged.font_size === 'small' || merged.font_size === 'large' ? merged.font_size : 'medium';

  const parsedFeed = Number(merged.feed_lines);
  merged.feed_lines = Number.isFinite(parsedFeed)
    ? Math.max(0, Math.min(8, Math.round(parsedFeed)))
    : DEFAULT_KITCHEN_RECEIPT_TEMPLATE.feed_lines;

  return merged;
}

export function getKitchenReceiptMetrics(template?: Partial<KitchenReceiptTemplate> | null) {
  const cfg = resolveKitchenReceiptTemplate(template);
  return {
    cfg,
    printWidthCss: cfg.paper_width === '58mm' ? '54mm' : '76mm',
    previewWidthPx: cfg.paper_width === '58mm' ? '192px' : '272px',
    printFontSizePx: cfg.font_size === 'small' ? '11px' : cfg.font_size === 'large' ? '14px' : '12px',
    previewFontSizePx: cfg.font_size === 'small' ? '9px' : cfg.font_size === 'large' ? '12px' : '10px',
    escPosLineChars: cfg.paper_width === '80mm' ? 48 : 32,
  };
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function resolveKitchenCashierName(sale: any): string {
  const explicitName = sale?.cashier_name || sale?.server_name;
  if (explicitName && String(explicitName).trim()) {
    return String(explicitName).trim();
  }
  if (sale?.cashier_email && String(sale.cashier_email).trim()) {
    const email = String(sale.cashier_email).trim();
    return email.includes('@') ? email.split('@')[0] : email;
  }
  return '';
}

function wrapReceiptText(text: string, maxLength: number): string[] {
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

export function buildKitchenReceiptHtml(
  sale: any,
  template?: Partial<KitchenReceiptTemplate> | null
): string {
  const { cfg, printWidthCss, printFontSizePx } = getKitchenReceiptMetrics(template);
  const saleItems = Array.isArray(sale?.items) ? sale.items : [];

  const itemsHtml = saleItems
    .map((item: any) => {
      const noteHtml =
        cfg.show_notes && item.notes
          ? `
      <div style="font-size: 0.85em; font-weight: bold; color: #b91c1c; margin-top: 3px; font-style: italic; background-color: #fef2f2; border: 1px dashed #ef4444; padding: 2px 6px; border-radius: 3px;">
        *** NOTE: ${escapeHtml(item.notes)} ***
      </div>
    `
          : '';

      return `
      <tr style="border-bottom: 1px dashed #cccccc;">
        <td style="padding: 6px 0; font-weight: bold; font-size: 1.2em;">
          ${escapeHtml(item.quantity)} x ${escapeHtml(item.item_name || item.name || 'Unknown Item')}
          ${noteHtml}
        </td>
      </tr>
    `;
    })
    .join('');

  const orderNoteText = sale?.notes || sale?.kitchen_notes;
  const orderNoteHtml =
    cfg.show_notes && orderNoteText
      ? `
    <div style="background-color: #fef3c7; border: 2px solid #f59e0b; color: #92400e; padding: 6px 8px; border-radius: 4px; font-weight: bold; font-size: 1.05em; margin: 8px 0; text-transform: uppercase;">
      ORDER NOTE: ${escapeHtml(orderNoteText)}
    </div>
  `
      : '';

  const dateStr = new Date(sale?.created_at || new Date()).toLocaleString();
  const orderRef = sale?.control_number || (sale?.id ? `${String(sale.id).substring(0, 8)}...` : 'ORDER');
  const titleId = sale?.id ? String(sale.id).substring(0, 8) : 'ORDER';
  const headerTitle = escapeHtml(cfg.header_title?.trim() || 'KITCHEN ORDER');
  const footerText = cfg.footer_text?.trim() ? escapeHtml(cfg.footer_text) : '';

  const metaRows: string[] = [];
  if (cfg.show_branch_name && sale?.branch_name) {
    metaRows.push(`
      <div class="flex-between">
        <span>Branch:</span>
        <span class="bold">${escapeHtml(sale.branch_name)}</span>
      </div>
    `);
  }
  const cashierName = cfg.show_cashier_name ? resolveKitchenCashierName(sale) : '';
  if (cashierName) {
    metaRows.push(`
      <div class="flex-between">
        <span>Cashier:</span>
        <span class="bold">${escapeHtml(cashierName)}</span>
      </div>
    `);
  }
  if (cfg.show_date) {
    metaRows.push(`
      <div class="flex-between">
        <span>Date:</span>
        <span>${escapeHtml(dateStr)}</span>
      </div>
    `);
  }
  if (cfg.show_order_number) {
    metaRows.push(`
      <div class="flex-between">
        <span>Invoice No:</span>
        <span class="bold">${escapeHtml(orderRef)}</span>
      </div>
    `);
  }

  return `
    <html>
      <head>
        <title>Kitchen - ${escapeHtml(titleId)}</title>
        <style>
          @page {
            margin: 0;
          }
          body {
            font-family: 'Courier New', Courier, monospace;
            font-size: ${printFontSizePx};
            line-height: 1.3;
            color: #000000;
            background-color: #ffffff;
            margin: 0;
            padding: 8px;
            width: ${printWidthCss};
          }
          .thermal-receipt {
            width: 100%;
          }
          .centered {
            text-align: center;
          }
          .bold {
            font-weight: bold;
          }
          .separator {
            border-top: 1px dashed #000000;
            margin: 8px 0;
          }
          .flex-between {
            display: flex;
            justify-content: space-between;
            gap: 8px;
          }
          .print-btn {
            display: block;
            width: 100%;
            background-color: #ef4444;
            color: #ffffff;
            border: none;
            padding: 6px 12px;
            font-size: 11px;
            font-weight: bold;
            text-align: center;
            cursor: pointer;
            margin-bottom: 15px;
            border-radius: 4px;
          }
          .category-badge {
            font-size: 1.3em;
            font-weight: 900;
            border: 2px solid #000000;
            padding: 4px;
            margin-top: 6px;
            text-align: center;
            text-transform: uppercase;
          }
          @media print {
            .print-btn {
              display: none;
            }
            body {
              width: 100%;
              padding: 0;
            }
          }
        </style>
      </head>
      <body>
        <button class="print-btn" onclick="window.print()">Print Kitchen Ticket</button>
        <div class="thermal-receipt">
          <div class="centered bold" style="font-size: 1.4em; border: 2px solid #000000; padding: 4px; text-transform: uppercase; margin-bottom: 8px;">
            ${headerTitle}
          </div>

          ${
            metaRows.length > 0
              ? `<div style="font-size: 0.95em; font-family: monospace;">${metaRows.join('')}</div>`
              : ''
          }

          ${cfg.show_order_type && sale?.sale_category ? `<div class="category-badge">${escapeHtml(sale.sale_category)}</div>` : ''}
          ${orderNoteHtml}

          <div class="separator"></div>

          <!-- Items list -->
          <table style="width: 100%; border-collapse: collapse;">
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>

          <div class="separator"></div>

          ${
            footerText
              ? `<div class="centered" style="margin-top: 15px; font-size: 10px; color: #333; font-weight: bold; white-space: pre-line;">${footerText}</div>`
              : ''
          }
        </div>
      </body>
    </html>
  `;
}

export function buildKitchenEscPosBytes(
  sale: any,
  template?: Partial<KitchenReceiptTemplate> | null
): Uint8Array {
  const { cfg, escPosLineChars } = getKitchenReceiptMetrics(template);
  const encoder = new TextEncoder();
  const payload: number[] = [];

  const INIT = [0x1b, 0x40];
  const ALIGN_CENTER = [0x1b, 0x61, 0x01];
  const ALIGN_LEFT = [0x1b, 0x61, 0x00];
  const BOLD_ON = [0x1b, 0x45, 0x01];
  const BOLD_OFF = [0x1b, 0x45, 0x00];
  const FONT_A = [0x1b, 0x4d, 0x00];
  const FONT_B = [0x1b, 0x4d, 0x01];
  const SIZE_NORMAL = [0x1d, 0x21, 0x00];
  const SIZE_DOUBLE_H = [0x1d, 0x21, 0x01];
  const CUT = [0x1d, 0x56, 0x42, 0x00];

  const baseFont = cfg.font_size === 'small' ? FONT_B : FONT_A;
  const headerSize = cfg.font_size === 'small' ? SIZE_NORMAL : SIZE_DOUBLE_H;
  const itemSize = cfg.font_size === 'large' ? SIZE_DOUBLE_H : SIZE_NORMAL;
  const divider = '-'.repeat(escPosLineChars) + '\n';

  payload.push(...INIT);
  payload.push(...baseFont);
  payload.push(...ALIGN_CENTER);
  payload.push(...BOLD_ON);
  payload.push(...headerSize);

  const headerTitle = (cfg.header_title?.trim() || 'KITCHEN ORDER').toUpperCase();
  for (const wrapped of wrapReceiptText(`*** ${headerTitle} ***`, escPosLineChars)) {
    payload.push(...encoder.encode(wrapped + '\n'));
  }
  payload.push(...SIZE_NORMAL);
  payload.push(...BOLD_OFF);

  if (cfg.show_branch_name && sale?.branch_name) {
    for (const wrapped of wrapReceiptText(String(sale.branch_name), escPosLineChars)) {
      payload.push(...encoder.encode(wrapped + '\n'));
    }
  }
  payload.push(...encoder.encode('\n'));

  payload.push(...ALIGN_LEFT);
  const escPosCashierName = cfg.show_cashier_name ? resolveKitchenCashierName(sale) : '';
  if (escPosCashierName) {
    for (const wrapped of wrapReceiptText(`Cashier: ${escPosCashierName}`, escPosLineChars)) {
      payload.push(...encoder.encode(wrapped + '\n'));
    }
  }
  if (cfg.show_date) {
    const dateStr = new Date(sale?.created_at || new Date()).toLocaleString();
    for (const wrapped of wrapReceiptText(`Date: ${dateStr}`, escPosLineChars)) {
      payload.push(...encoder.encode(wrapped + '\n'));
    }
  }

  if (cfg.show_order_number) {
    const invoiceNo = sale?.control_number || String(sale?.id || 'ORDER').substring(0, 8);
    for (const wrapped of wrapReceiptText(`Order #: ${invoiceNo}`, escPosLineChars)) {
      payload.push(...encoder.encode(wrapped + '\n'));
    }
  }

  if (cfg.show_order_type) {
    const saleType = sale?.sale_category || 'Dine in';
    for (const wrapped of wrapReceiptText(`Type: ${saleType}`, escPosLineChars)) {
      payload.push(...encoder.encode(wrapped + '\n'));
    }
  }

  const orderNote = sale?.notes || sale?.kitchen_notes;
  if (cfg.show_notes && orderNote) {
    payload.push(...BOLD_ON);
    for (const wrapped of wrapReceiptText(`ORDER NOTE: ${orderNote}`, escPosLineChars)) {
      payload.push(...encoder.encode(wrapped + '\n'));
    }
    payload.push(...BOLD_OFF);
  }

  payload.push(...encoder.encode(divider));

  payload.push(...BOLD_ON);
  payload.push(...itemSize);
  if (sale?.items && Array.isArray(sale.items)) {
    for (const item of sale.items) {
      const itemName = item.item_name || item.name || 'Unknown Item';
      const line = `${item.quantity} x ${itemName}`;
      for (const wrapped of wrapReceiptText(line, escPosLineChars)) {
        payload.push(...encoder.encode(wrapped + '\n'));
      }
      if (cfg.show_notes && item.notes) {
        payload.push(...BOLD_OFF);
        payload.push(...SIZE_NORMAL);
        for (const wrapped of wrapReceiptText(`  *** NOTE: ${item.notes} ***`, escPosLineChars)) {
          payload.push(...encoder.encode(wrapped + '\n'));
        }
        payload.push(...BOLD_ON);
        payload.push(...itemSize);
      }
    }
  }
  payload.push(...SIZE_NORMAL);
  payload.push(...BOLD_OFF);
  payload.push(...encoder.encode(divider));

  if (cfg.footer_text && cfg.footer_text.trim()) {
    payload.push(...ALIGN_CENTER);
    for (const rawLine of cfg.footer_text.split('\n')) {
      for (const wrapped of wrapReceiptText(rawLine, escPosLineChars)) {
        payload.push(...encoder.encode(wrapped + '\n'));
      }
    }
  }

  payload.push(...encoder.encode('\n'.repeat(cfg.feed_lines)));
  payload.push(...CUT);

  return new Uint8Array(payload);
}
