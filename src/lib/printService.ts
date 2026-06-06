import type { TransferSlipTemplate, SalesInvoiceTemplate } from './settingsService';

export const printTransferSlip = (transfer: any, items: any[], template: TransferSlipTemplate) => {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Please allow popups to generate the receipt.');
    return;
  }

  const itemsHtml = items.map(item => `
    <tr style="border-bottom: 1px solid #e2e8f0;">
      <td style="padding: 12px; font-weight: 500;">${item.inventory_items?.item_name || 'Item'}</td>
      <td style="padding: 12px; text-align: right; font-weight: 700;">${item.quantity_base_unit} ${item.inventory_items?.base_unit || 'units'}</td>
    </tr>
  `).join('');

  const logoHtml = template.logo_url
    ? `<img src="${template.logo_url}" style="max-height: 56px; max-width: 120px; object-fit: contain; border-radius: 4px;" />`
    : '';

  const signaturesHtml = template.show_signatures
    ? `<div class="signatures">
        <div class="sig-box">
          <div class="sig-title">${template.sender_label || 'Dispatched By (Sender Signature)'}</div>
          <div class="sig-subtitle">Main Warehouse / Source Branch Authority</div>
          <div style="margin-top: 40px; font-size: 11px; color: #94a3b8; text-align: left; display: flex; justify-content: space-between;">
            <span>Name: ______________________</span>
            <span>Date: ____/____/________</span>
          </div>
        </div>
        <div class="sig-box">
          <div class="sig-title">${template.receiver_label || 'Received By (Receiver Signature)'}</div>
          <div class="sig-subtitle font-normal text-slate-400">Target Branch Manager / Cashier Authority</div>
          <div style="margin-top: 40px; font-size: 11px; color: #94a3b8; text-align: left; display: flex; justify-content: space-between;">
            <span>Name: ______________________</span>
            <span>Date: ____/____/________</span>
          </div>
        </div>
      </div>`
    : '';

  const html = `
    <html>
      <head>
        <title>Receipt - ${transfer.control_number || transfer.id}</title>
        <style>
          body {
            font-family: 'Inter', -apple-system, sans-serif;
            color: #1e293b;
            padding: 40px;
            background-color: #ffffff;
            margin: 0;
          }
          .receipt-container {
            max-width: 800px;
            margin: 0 auto;
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 2px solid #e2e8f0;
            padding-bottom: 20px;
            margin-bottom: 30px;
          }
          .header-brand {
            display: flex;
            align-items: center;
            gap: 16px;
          }
          .brand {
            font-size: 24px;
            font-weight: 800;
            color: #4f46e5;
            letter-spacing: -0.025em;
            text-transform: uppercase;
          }
          .title {
            font-size: 14px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: #64748b;
          }
          .details-grid {
            display: grid;
            grid-template-cols: 1fr 1fr;
            gap: 24px;
            margin-bottom: 40px;
          }
          .info-block h3 {
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            color: #64748b;
            margin: 0 0 6px 0;
            letter-spacing: 0.05em;
          }
          .info-block p {
            font-size: 14px;
            font-weight: 600;
            margin: 0;
            color: #0f172a;
          }
          .branches-box {
            display: flex;
            justify-content: space-between;
            background-color: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 40px;
          }
          .branch-col {
            width: 48%;
          }
          .branch-col h3 {
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            color: #64748b;
            margin: 0 0 8px 0;
            letter-spacing: 0.05em;
          }
          .branch-col p {
            font-size: 15px;
            font-weight: 700;
            margin: 0;
            color: #0f172a;
          }
          .items-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 50px;
          }
          .items-table th {
            background-color: #f1f5f9;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            color: #475569;
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #cbd5e1;
            letter-spacing: 0.05em;
          }
          .signatures {
            display: flex;
            justify-content: space-between;
            margin-top: 80px;
            page-break-inside: avoid;
          }
          .sig-box {
            width: 45%;
            border-top: 1px dashed #cbd5e1;
            padding-top: 15px;
            text-align: center;
          }
          .sig-title {
            font-size: 12px;
            font-weight: 700;
            color: #475569;
            margin-bottom: 4px;
          }
          .sig-subtitle {
            font-size: 10px;
            color: #94a3b8;
          }
          .print-btn {
            background-color: #4f46e5;
            color: #ffffff;
            border: none;
            padding: 10px 20px;
            font-size: 14px;
            font-weight: 700;
            border-radius: 6px;
            cursor: pointer;
            margin-bottom: 20px;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            font-family: inherit;
          }
          @media print {
            .print-btn {
              display: none;
            }
            body {
              padding: 0;
            }
          }
        </style>
      </head>
      <body>
        <div class="receipt-container">
          <button class="print-btn" onclick="window.print()">Print / Save PDF</button>
          
          <div class="header">
            <div class="header-brand">
              ${logoHtml}
              <div>
                <div class="brand">${template.header_title || 'RESTAURANT INVENTORY SYSTEM'}</div>
                <div style="font-size: 12px; color: #64748b; margin-top: 4px;">${template.header_subtitle || 'Kitchen & Stock Logistics Management'}</div>
              </div>
            </div>
            <div style="text-align: right;">
              <div class="title">Delivery Slip / Transfer Receipt</div>
              <div style="font-size: 12px; color: #64748b; font-weight: bold; margin-top: 4px;">Status: ${(transfer.status || 'PENDING').toUpperCase()}</div>
            </div>
          </div>

          <div class="details-grid">
            <div class="info-block">
              <h3>Control Number</h3>
              <p style="font-weight: 700; font-size: 16px; color: #4f46e5;">${transfer.control_number || 'PENDING'}</p>
              <div style="font-family: monospace; font-size: 10px; color: #94a3b8; margin-top: 4px;">System ID: ${transfer.id}</div>
            </div>
            <div class="info-block" style="text-align: right;">
              <h3>Issue Date</h3>
              <p>${new Date(transfer.created_at || new Date()).toLocaleString()}</p>
            </div>
          </div>

          <div class="branches-box">
            <div class="branch-col">
              <h3>Dispatched From (Source)</h3>
              <p>${transfer.source_branch?.name || 'Warehouse'}</p>
              <div style="font-size: 12px; color: #64748b; margin-top: 4px;">Authorized Dispatch Location</div>
            </div>
            <div style="display: flex; align-items: center; justify-content: center; font-size: 24px; color: #94a3b8;">➔</div>
            <div class="branch-col" style="text-align: right;">
              <h3>Delivered To (Target)</h3>
              <p>${transfer.target_branch?.name || 'Branch'}</p>
              <div style="font-size: 12px; color: #64748b; margin-top: 4px;">Destination Location</div>
            </div>
          </div>

          <div class="info-block" style="margin-bottom: 24px;">
            <h3>Remarks / Purpose</h3>
            <p style="font-weight: 500; font-style: ${transfer.remarks ? 'normal' : 'italic'}; color: ${transfer.remarks ? '#1e293b' : '#94a3b8'};">
              ${transfer.remarks || 'No remarks provided'}
            </p>
          </div>

          <table class="items-table">
            <thead>
              <tr>
                <th>Item Name</th>
                <th style="text-align: right;">Quantity (Base Unit)</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>

          ${signaturesHtml}

          <div style="margin-top: 50px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 15px;">
            ${template.custom_footer || 'Kitchen & Stock Logistics Management'}
          </div>
        </div>
      </body>
    </html>
  `;

  printWindow.document.write(html);
  printWindow.document.close();
};

export const printThermalInvoice = (sale: any, template: SalesInvoiceTemplate) => {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Please allow popups to generate the thermal receipt.');
    return;
  }

  const itemsHtml = sale.items.map((item: any) => {
    return `
      <div style="margin-bottom: 6px;">
        <div style="font-weight: bold; text-transform: uppercase;">${item.item_name}</div>
        <div style="display: flex; justify-content: space-between; font-family: monospace;">
          <span>  ${item.quantity} x ₱${item.unit_price.toFixed(2)}</span>
          <span>₱${item.subtotal.toFixed(2)}</span>
        </div>
      </div>
    `;
  }).join('');

  const logoHtml = template.logo_url
    ? `<div class="centered" style="margin-bottom: 10px;">
         <img src="${template.logo_url}" style="max-height: 60px; max-width: 100%; object-fit: contain;" />
       </div>`
    : '';

  const dateStr = new Date(sale.created_at || new Date()).toLocaleString();

  // Font sizes and widths
  const widthStyle = template.paper_width === '58mm' ? '54mm' : '76mm';
  const fontSizeStyle = template.font_size === 'small' ? '11px' : template.font_size === 'large' ? '14px' : '12px';

  const html = `
    <html>
      <head>
        <title>Receipt - ${sale.id.substring(0, 8)}</title>
        <style>
          @page {
            margin: 0;
          }
          body {
            font-family: 'Courier New', Courier, monospace;
            font-size: ${fontSizeStyle};
            line-height: 1.3;
            color: #000000;
            background-color: #ffffff;
            margin: 0;
            padding: 8px;
            width: ${widthStyle};
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
          }
          .footer-text {
            white-space: pre-line;
            font-size: 11px;
            margin-top: 15px;
          }
          .print-btn {
            display: block;
            width: 100%;
            background-color: #4f46e5;
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
        <button class="print-btn" onclick="window.print()">Print Thermal Invoice</button>
        <div class="thermal-receipt">
          ${logoHtml}
          
          <div class="centered bold" style="font-size: 1.15em; text-transform: uppercase;">
            ${template.merchant_name || 'Dr. Humba'}
          </div>
          <div class="centered" style="font-size: 0.9em; margin-top: 2px;">
            ${template.merchant_address || '123 Main St, Metro Manila'}
          </div>
          <div class="centered" style="font-size: 0.9em;">
            ${template.merchant_contact || '+63 912 345 6789'}
          </div>
          <div class="centered" style="font-size: 0.9em; margin-bottom: 4px;">
            ${template.merchant_tin || 'TIN: 000-123-456-000'}
          </div>

          <div class="separator"></div>

          <div class="centered bold" style="font-size: 1.1em; letter-spacing: 1px; margin: 4px 0;">
            ${template.header_text || 'SALES INVOICE'}
          </div>

          <div class="separator"></div>

          <div style="font-size: 0.95em; font-family: monospace;">
            <div class="flex-between">
              <span>Date:</span>
              <span>${dateStr}</span>
            </div>
            <div class="flex-between">
              <span>Invoice No:</span>
              <span>${sale.control_number || (sale.id.substring(0, 8) + '...')}</span>
            </div>
            <div class="flex-between">
              <span>Branch:</span>
              <span>${sale.branch_name || 'Main Branch'}</span>
            </div>
            <div class="flex-between">
              <span>Cashier:</span>
              <span style="max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${sale.cashier_email?.split('@')[0] || 'Staff'}
              </span>
            </div>
          </div>

          <div class="separator"></div>

          <!-- Items list -->
          <div style="margin: 6px 0;">
            ${itemsHtml}
          </div>

          <div class="separator"></div>

          <!-- Totals -->
          <div style="font-family: monospace; font-size: 1.05em;">
            <div class="flex-between bold" style="font-size: 1.15em;">
              <span>TOTAL VALUE:</span>
              <span>₱${sale.total_amount.toFixed(2)}</span>
            </div>
          </div>

          <div class="separator"></div>

          <div class="centered footer-text">
            ${template.footer_text || 'Thank you for dining with us!\nCome back again!'}
          </div>
          
          <div class="centered" style="margin-top: 15px; font-size: 9px; color: #555;">
            Dr. Humba
          </div>
        </div>
      </body>
    </html>
  `;

  printWindow.document.write(html);
  printWindow.document.close();
};

export const printStockInReceipt = (receipt: any, items: any[], template: TransferSlipTemplate) => {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Please allow popups to generate the receipt.');
    return;
  }

  let grandTotal = 0;
  const itemsHtml = items.map(item => {
    const subtotal = item.quantity_purchased * item.cost_per_purchase_unit;
    grandTotal += subtotal;
    return `
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 12px; font-weight: 500;">${item.inventory_items?.item_name || 'Item'}</td>
        <td style="padding: 12px; text-align: right; font-weight: 700;">${item.quantity_purchased} ${item.inventory_items?.purchase_unit || 'units'}</td>
        <td style="padding: 12px; text-align: right;">₱${item.cost_per_purchase_unit.toFixed(2)}</td>
        <td style="padding: 12px; text-align: right; font-weight: 700;">₱${subtotal.toFixed(2)}</td>
      </tr>
    `;
  }).join('');

  const logoHtml = template.logo_url
    ? `<img src="${template.logo_url}" style="max-height: 56px; max-width: 120px; object-fit: contain; border-radius: 4px;" />`
    : '';

  const signaturesHtml = template.show_signatures
    ? `<div class="signatures">
        <div class="sig-box">
          <div class="sig-title">Received By</div>
          <div style="margin-top: 40px; font-size: 11px; color: #94a3b8; text-align: left; display: flex; justify-content: space-between;">
            <span>Name: ______________________</span>
            <span>Date: ____/____/________</span>
          </div>
        </div>
        <div class="sig-box">
          <div class="sig-title">Verified By (Manager)</div>
          <div style="margin-top: 40px; font-size: 11px; color: #94a3b8; text-align: left; display: flex; justify-content: space-between;">
            <span>Name: ______________________</span>
            <span>Date: ____/____/________</span>
          </div>
        </div>
      </div>`
    : '';

  const html = `
    <html>
      <head>
        <title>Stock In - ${receipt.control_number || receipt.id}</title>
        <style>
          body { font-family: 'Inter', -apple-system, sans-serif; color: #1e293b; padding: 40px; background-color: #ffffff; margin: 0; }
          .receipt-container { max-width: 800px; margin: 0 auto; }
          .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #e2e8f0; padding-bottom: 20px; margin-bottom: 30px; }
          .header-brand { display: flex; align-items: center; gap: 16px; }
          .brand { font-size: 24px; font-weight: 800; color: #4f46e5; letter-spacing: -0.025em; text-transform: uppercase; }
          .title { font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; }
          .details-grid { display: grid; grid-template-cols: 1fr 1fr; gap: 24px; margin-bottom: 40px; }
          .info-block h3 { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b; margin: 0 0 6px 0; letter-spacing: 0.05em; }
          .info-block p { font-size: 14px; font-weight: 600; margin: 0; color: #0f172a; }
          .branches-box { display: flex; justify-content: space-between; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 40px; }
          .branch-col { width: 48%; }
          .branch-col h3 { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b; margin: 0 0 8px 0; letter-spacing: 0.05em; }
          .branch-col p { font-size: 15px; font-weight: 700; margin: 0; color: #0f172a; }
          .items-table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
          .items-table th { background-color: #f1f5f9; font-size: 11px; font-weight: 700; text-transform: uppercase; color: #475569; padding: 12px; text-align: left; border-bottom: 1px solid #cbd5e1; letter-spacing: 0.05em; }
          .total-box { display: flex; justify-content: flex-end; font-size: 16px; font-weight: 800; padding: 15px; border-top: 2px solid #cbd5e1; margin-bottom: 50px; }
          .signatures { display: flex; justify-content: space-between; margin-top: 80px; page-break-inside: avoid; }
          .sig-box { width: 45%; border-top: 1px dashed #cbd5e1; padding-top: 15px; text-align: center; }
          .sig-title { font-size: 12px; font-weight: 700; color: #475569; margin-bottom: 4px; }
          .print-btn { background-color: #4f46e5; color: #ffffff; border: none; padding: 10px 20px; font-size: 14px; font-weight: 700; border-radius: 6px; cursor: pointer; margin-bottom: 20px; display: inline-flex; align-items: center; gap: 8px; font-family: inherit; }
          @media print { .print-btn { display: none; } body { padding: 0; } }
        </style>
      </head>
      <body>
        <div class="receipt-container">
          <button class="print-btn" onclick="window.print()">Print / Save PDF</button>
          
          <div class="header">
            <div class="header-brand">
              ${logoHtml}
              <div>
                <div class="brand">${template.header_title || 'RESTAURANT INVENTORY SYSTEM'}</div>
                <div style="font-size: 12px; color: #64748b; margin-top: 4px;">${template.header_subtitle || 'Kitchen & Stock Logistics Management'}</div>
              </div>
            </div>
            <div style="text-align: right;">
              <div class="title">Stock In Receipt</div>
              <div style="font-size: 12px; color: #64748b; font-weight: bold; margin-top: 4px;">Status: ${(receipt.status || 'PENDING').toUpperCase()}</div>
            </div>
          </div>

          <div class="details-grid">
            <div class="info-block">
              <h3>Control Number</h3>
              <p style="font-weight: 700; font-size: 16px; color: #4f46e5;">${receipt.control_number || 'PENDING'}</p>
              <div style="font-family: monospace; font-size: 10px; color: #94a3b8; margin-top: 4px;">System ID: ${receipt.id}</div>
            </div>
            <div class="info-block" style="text-align: right;">
              <h3>Issue Date</h3>
              <p>${new Date(receipt.created_at || new Date()).toLocaleString()}</p>
            </div>
          </div>

          <div class="branches-box">
            <div class="branch-col">
              <h3>Supplier</h3>
              <p>${receipt.supplier}</p>
            </div>
            <div class="branch-col" style="text-align: right;">
              <h3>Invoice No.</h3>
              <p>${receipt.invoice_no || 'N/A'}</p>
            </div>
          </div>

          <table class="items-table">
            <thead>
              <tr>
                <th>Item Name</th>
                <th style="text-align: right;">Quantity</th>
                <th style="text-align: right;">Unit Cost</th>
                <th style="text-align: right;">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>

          <div class="total-box">
            Total Value: &nbsp; <span style="color: #4f46e5;">₱${grandTotal.toFixed(2)}</span>
          </div>

          ${signaturesHtml}

          <div style="margin-top: 50px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 15px;">
            ${template.custom_footer || 'Kitchen & Stock Logistics Management'}
          </div>
        </div>
      </body>
    </html>
  `;

  printWindow.document.write(html);
  printWindow.document.close();
};

export const printAdjustmentSlip = (adjustment: any, items: any[], template: TransferSlipTemplate) => {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Please allow popups to generate the receipt.');
    return;
  }

  const isWaste = ['spoilage', 'damage', 'expired'].includes(adjustment.reason);
  const title = isWaste ? "Food Waste Report" : "Stock Adjustment Slip";

  const itemsHtml = items.map(item => `
    <tr style="border-bottom: 1px solid #e2e8f0;">
      <td style="padding: 12px; font-weight: 500;">${item.inventory_items?.item_name || 'Item'}</td>
      <td style="padding: 12px; text-align: right; font-weight: 700; color: ${item.quantity_base_unit < 0 ? '#ef4444' : '#10b981'};">
        ${item.quantity_base_unit > 0 ? '+' : ''}${item.quantity_base_unit} ${item.inventory_items?.base_unit || 'units'}
      </td>
    </tr>
  `).join('');

  const logoHtml = template.logo_url
    ? `<img src="${template.logo_url}" style="max-height: 56px; max-width: 120px; object-fit: contain; border-radius: 4px;" />`
    : '';

  const signaturesHtml = template.show_signatures
    ? `<div class="signatures">
        <div class="sig-box">
          <div class="sig-title">Logged By</div>
          <div style="margin-top: 40px; font-size: 11px; color: #94a3b8; text-align: left; display: flex; justify-content: space-between;">
            <span>Name: ______________________</span>
            <span>Date: ____/____/________</span>
          </div>
        </div>
        <div class="sig-box">
          <div class="sig-title">Approved By (Manager)</div>
          <div style="margin-top: 40px; font-size: 11px; color: #94a3b8; text-align: left; display: flex; justify-content: space-between;">
            <span>Name: ______________________</span>
            <span>Date: ____/____/________</span>
          </div>
        </div>
      </div>`
    : '';

  const html = `
    <html>
      <head>
        <title>${title} - ${adjustment.control_number || adjustment.id}</title>
        <style>
          body { font-family: 'Inter', -apple-system, sans-serif; color: #1e293b; padding: 40px; background-color: #ffffff; margin: 0; }
          .receipt-container { max-width: 800px; margin: 0 auto; }
          .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #e2e8f0; padding-bottom: 20px; margin-bottom: 30px; }
          .header-brand { display: flex; align-items: center; gap: 16px; }
          .brand { font-size: 24px; font-weight: 800; color: #4f46e5; letter-spacing: -0.025em; text-transform: uppercase; }
          .title { font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; }
          .details-grid { display: grid; grid-template-cols: 1fr 1fr; gap: 24px; margin-bottom: 40px; }
          .info-block h3 { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b; margin: 0 0 6px 0; letter-spacing: 0.05em; }
          .info-block p { font-size: 14px; font-weight: 600; margin: 0; color: #0f172a; }
          .branches-box { background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 40px; }
          .branches-box h3 { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b; margin: 0 0 6px 0; letter-spacing: 0.05em; }
          .branches-box p { font-size: 14px; font-weight: 600; margin: 0; color: #0f172a; }
          .items-table { width: 100%; border-collapse: collapse; margin-bottom: 50px; }
          .items-table th { background-color: #f1f5f9; font-size: 11px; font-weight: 700; text-transform: uppercase; color: #475569; padding: 12px; text-align: left; border-bottom: 1px solid #cbd5e1; letter-spacing: 0.05em; }
          .signatures { display: flex; justify-content: space-between; margin-top: 80px; page-break-inside: avoid; }
          .sig-box { width: 45%; border-top: 1px dashed #cbd5e1; padding-top: 15px; text-align: center; }
          .sig-title { font-size: 12px; font-weight: 700; color: #475569; margin-bottom: 4px; }
          .print-btn { background-color: #4f46e5; color: #ffffff; border: none; padding: 10px 20px; font-size: 14px; font-weight: 700; border-radius: 6px; cursor: pointer; margin-bottom: 20px; display: inline-flex; align-items: center; gap: 8px; font-family: inherit; }
          @media print { .print-btn { display: none; } body { padding: 0; } }
        </style>
      </head>
      <body>
        <div class="receipt-container">
          <button class="print-btn" onclick="window.print()">Print / Save PDF</button>
          
          <div class="header">
            <div class="header-brand">
              ${logoHtml}
              <div>
                <div class="brand">${template.header_title || 'RESTAURANT INVENTORY SYSTEM'}</div>
                <div style="font-size: 12px; color: #64748b; margin-top: 4px;">${template.header_subtitle || 'Kitchen & Stock Logistics Management'}</div>
              </div>
            </div>
            <div style="text-align: right;">
              <div class="title">${title}</div>
              <div style="font-size: 12px; color: #64748b; font-weight: bold; margin-top: 4px;">Status: ${(adjustment.status || 'PENDING').toUpperCase()}</div>
            </div>
          </div>

          <div class="details-grid">
            <div class="info-block">
              <h3>Control Number</h3>
              <p style="font-weight: 700; font-size: 16px; color: #4f46e5;">${adjustment.control_number || 'PENDING'}</p>
              <div style="font-family: monospace; font-size: 10px; color: #94a3b8; margin-top: 4px;">System ID: ${adjustment.id}</div>
            </div>
            <div class="info-block" style="text-align: right;">
              <h3>Issue Date</h3>
              <p>${new Date(adjustment.created_at || new Date()).toLocaleString()}</p>
            </div>
          </div>

          <div class="branches-box" style="display: grid; grid-template-cols: 1fr 1fr; gap: 20px;">
            <div>
              <h3>Branch Location</h3>
              <p>${adjustment.branches?.name || 'Unknown'}</p>
            </div>
            <div>
              <h3>Adjustment Reason</h3>
              <p style="text-transform: capitalize;">${adjustment.reason.replace('_', ' ')}</p>
            </div>
            <div style="grid-column: span 2; margin-top: 10px;">
              <h3>Remarks</h3>
              <p>${adjustment.remarks || 'No remarks provided'}</p>
            </div>
          </div>

          <table class="items-table">
            <thead>
              <tr>
                <th>Item Name</th>
                <th style="text-align: right;">Adjustment Qty</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>

          ${signaturesHtml}

          <div style="margin-top: 50px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 15px;">
            ${template.custom_footer || 'Kitchen & Stock Logistics Management'}
          </div>
        </div>
      </body>
    </html>
  `;

  printWindow.document.write(html);
  printWindow.document.close();
};
