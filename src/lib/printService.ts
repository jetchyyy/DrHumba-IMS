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
            <div class="flex-between">
              <span>Sale Type:</span>
              <span style="text-transform: capitalize;">${sale.sale_category || 'Dine in'}</span>
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

export const printKitchenReceipt = (sale: any, template: SalesInvoiceTemplate) => {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Please allow popups to generate the kitchen receipt.');
    return;
  }

  const itemsHtml = sale.items.map((item: any) => {
    return `
      <tr style="border-bottom: 1px dashed #cccccc;">
        <td style="padding: 6px 0; font-weight: bold; font-size: 1.2em;">${item.quantity} x ${item.item_name}</td>
      </tr>
    `;
  }).join('');

  const dateStr = new Date(sale.created_at || new Date()).toLocaleString();

  // Font sizes and widths
  const widthStyle = template.paper_width === '58mm' ? '54mm' : '76mm';
  const fontSizeStyle = template.font_size === 'small' ? '11px' : template.font_size === 'large' ? '14px' : '12px';

  const html = `
    <html>
      <head>
        <title>Kitchen - ${sale.id.substring(0, 8)}</title>
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
            KITCHEN ORDER
          </div>
          
          <div style="font-size: 0.95em; font-family: monospace;">
            <div class="flex-between">
              <span>Date:</span>
              <span>${dateStr}</span>
            </div>
            <div class="flex-between">
              <span>Invoice No:</span>
              <span class="bold">${sale.control_number || (sale.id.substring(0, 8) + '...')}</span>
            </div>
          </div>

          ${sale.sale_category ? `<div class="category-badge">${sale.sale_category}</div>` : ''}

          <div class="separator"></div>

          <!-- Items list -->
          <table style="width: 100%; border-collapse: collapse;">
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>

          <div class="separator"></div>
          
          <div class="centered" style="margin-top: 15px; font-size: 10px; color: #333; font-weight: bold;">
            * End of Kitchen Order *
          </div>
        </div>
      </body>
    </html>
  `;

  printWindow.document.write(html);
  printWindow.document.close();
};

export const printEndOfDayReport = (report: any, template: SalesInvoiceTemplate) => {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Please allow popups to generate the End of Day report.');
    return;
  }

  const formatVal = (num: number) => 
    (num || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const renderSummaryBlock = (title: string, data: any) => {
    return `
      <div class="bold uppercase" style="margin-top: 10px; font-size: 1.15em;">${title}</div>
      <div class="separator"></div>
      <table style="width: 100%; border-collapse: collapse; font-family: monospace; font-size: 11px; margin-bottom: 10px;">
        <thead>
          <tr style="border-bottom: 1px dashed #000000; font-weight: bold;">
            <th style="text-align: left; width: 45%; padding-bottom: 4px;">Category</th>
            <th style="text-align: center; width: 15%; padding-bottom: 4px;">Sign</th>
            <th style="text-align: center; width: 15%; padding-bottom: 4px;">Qty</th>
            <th style="text-align: right; width: 25%; padding-bottom: 4px;">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="text-align: left; padding: 2px 0;">Sales</td>
            <td style="text-align: center;">(+)</td>
            <td style="text-align: center;">${data.salesQty}</td>
            <td style="text-align: right;">${formatVal(data.salesAmt)}</td>
          </tr>
          <tr>
            <td style="text-align: left; padding: 2px 0;">Refunds</td>
            <td style="text-align: center;">(-)</td>
            <td style="text-align: center;">${data.refundsQty}</td>
            <td style="text-align: right;">${formatVal(data.refundsAmt)}</td>
          </tr>
          <tr class="bold" style="border-top: 1px dashed #000000;">
            <td style="text-align: left; padding: 4px 0 2px 0;">Net</td>
            <td style="text-align: center; padding: 4px 0 2px 0;">(=)</td>
            <td style="text-align: center; padding: 4px 0 2px 0;">${data.netQty}</td>
            <td style="text-align: right; padding: 4px 0 2px 0;">${formatVal(data.netAmt)}</td>
          </tr>
        </tbody>
      </table>
    `;
  };

  const widthStyle = template.paper_width === '58mm' ? '54mm' : '76mm';
  const fontSizeStyle = template.font_size === 'small' ? '11px' : template.font_size === 'large' ? '14px' : '12px';

  const logoHtml = template.logo_url
    ? `<div class="centered" style="margin-bottom: 10px;">
         <img src="${template.logo_url}" style="max-height: 60px; max-width: 100%; object-fit: contain;" />
       </div>`
    : '';

  const html = `
    <html>
      <head>
        <title>Z-Report - ${report.reportDate.split(' ')[0]}</title>
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
        <button class="print-btn" onclick="window.print()">Print Z Shift Report</button>
        <div class="thermal-receipt">
          ${logoHtml}
          
          <div class="centered bold" style="font-size: 1.15em; text-transform: uppercase;">
            ${template.merchant_name || report.branchName}
          </div>
          <div class="centered" style="font-size: 0.9em; margin-top: 2px;">
            ${template.merchant_address || report.branchLocation || '123 Main St, Metro Manila'}
          </div>
          ${template.merchant_contact ? `
            <div class="centered" style="font-size: 0.9em;">
              ${template.merchant_contact}
            </div>
          ` : ''}
          ${template.merchant_tin ? `
            <div class="centered" style="font-size: 0.9em; margin-bottom: 4px;">
              ${template.merchant_tin}
            </div>
          ` : ''}

          <div class="separator"></div>

          <div class="centered bold" style="font-size: 1.1em; border: 1px solid #000000; padding: 3px; margin: 8px 0; text-transform: uppercase;">
            Z Sales Shift Report
          </div>
          
          <div style="font-size: 0.95em; font-family: monospace; line-height: 1.4;">
            <div class="flex-between">
              <span>Shift Open Time:</span>
              <span>${report.shiftOpenTime}</span>
            </div>
            <div class="flex-between">
              <span>Shift Close Time:</span>
              <span>${report.shiftCloseTime}</span>
            </div>
            <div class="flex-between">
              <span>Register:</span>
              <span>${report.register}</span>
            </div>
            <div class="flex-between">
              <span>Report Date:</span>
              <span>${report.reportDate}</span>
            </div>
            <div class="flex-between">
              <span>Manager:</span>
              <span>${report.managerName}</span>
            </div>
          </div>

          <div class="separator"></div>

          ${renderSummaryBlock('Cash Summary', report.cashSummary)}
          ${renderSummaryBlock('CreditCard Summary', report.cardSummary)}
          ${renderSummaryBlock('GCASH Summary', report.gcashSummary)}
          ${renderSummaryBlock('Maya Summary', report.mayaSummary)}
          ${renderSummaryBlock('Other Summary', report.otherSummary)}
          ${renderSummaryBlock('Sales Summary', report.salesSummary)}

          <!-- Deposits Summary -->
          <div class="bold uppercase" style="margin-top: 10px; font-size: 1.15em;">Deposits Summary</div>
          <div class="separator"></div>
          <table style="width: 100%; border-collapse: collapse; font-family: monospace; font-size: 11px; margin-bottom: 10px;">
            <thead>
              <tr style="border-bottom: 1px dashed #000000; font-weight: bold;">
                <th style="text-align: left; width: 60%; padding-bottom: 4px;">Type</th>
                <th style="text-align: center; width: 15%; padding-bottom: 4px;">Qty</th>
                <th style="text-align: right; width: 25%; padding-bottom: 4px;">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr><td style="padding: 2px 0;">Cash deposits</td><td style="text-align: center;">0</td><td style="text-align: right;">0.00</td></tr>
              <tr><td style="padding: 2px 0;">CreditCard deposits</td><td style="text-align: center;">0</td><td style="text-align: right;">0.00</td></tr>
              <tr><td style="padding: 2px 0;">DebitCard deposits</td><td style="text-align: center;">0</td><td style="text-align: right;">0.00</td></tr>
              <tr><td style="padding: 2px 0;">GCASH deposits</td><td style="text-align: center;">0</td><td style="text-align: right;">0.00</td></tr>
              <tr class="bold" style="border-top: 1px dashed #000000;">
                <td style="padding: 4px 0 2px 0;">Total deposits</td>
                <td style="text-align: center; padding: 4px 0 2px 0;">0</td>
                <td style="text-align: right; padding: 4px 0 2px 0;">0.00</td>
              </tr>
            </tbody>
          </table>

          <!-- Store Credit Summary -->
          <div class="bold uppercase" style="margin-top: 10px; font-size: 1.15em;">Store Credit Summary</div>
          <div class="separator"></div>
          <table style="width: 100%; border-collapse: collapse; font-family: monospace; font-size: 11px; margin-bottom: 10px;">
            <thead>
              <tr style="border-bottom: 1px dashed #000000; font-weight: bold;">
                <th style="text-align: left; width: 60%; padding-bottom: 4px;">Category</th>
                <th style="text-align: center; width: 15%; padding-bottom: 4px;">Qty</th>
                <th style="text-align: right; width: 25%; padding-bottom: 4px;">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr><td style="padding: 2px 0;">Discount (+)</td><td style="text-align: center;">0</td><td style="text-align: right;">0.00</td></tr>
            </tbody>
          </table>

          <!-- Cancels/Dis Summary -->
          <div class="bold uppercase" style="margin-top: 10px; font-size: 1.15em;">Cancels/Dis Summary</div>
          <div class="separator"></div>
          <table style="width: 100%; border-collapse: collapse; font-family: monospace; font-size: 11px; margin-bottom: 10px;">
            <thead>
              <tr style="border-bottom: 1px dashed #000000; font-weight: bold;">
                <th style="text-align: left; width: 60%; padding-bottom: 4px;">Category</th>
                <th style="text-align: center; width: 15%; padding-bottom: 4px;">Qty</th>
                <th style="text-align: right; width: 25%; padding-bottom: 4px;">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr><td style="padding: 2px 0;">Discount</td><td style="text-align: center;">0</td><td style="text-align: right;">0.00</td></tr>
              <tr><td style="padding: 2px 0;">Cancel Txns</td><td style="text-align: center;">${report.cancelledCount}</td><td style="text-align: right;">${formatVal(report.cancelledAmount)}</td></tr>
            </tbody>
          </table>

          <!-- Service Charge Summary -->
          <div class="bold uppercase" style="margin-top: 10px; font-size: 1.15em;">Service Charge Summary</div>
          <div class="separator"></div>
          <table style="width: 100%; border-collapse: collapse; font-family: monospace; font-size: 11px; margin-bottom: 10px;">
            <thead>
              <tr style="border-bottom: 1px dashed #000000; font-weight: bold;">
                <th style="text-align: left; width: 60%; padding-bottom: 4px;">Category</th>
                <th style="text-align: center; width: 15%; padding-bottom: 4px;">Qty</th>
                <th style="text-align: right; width: 25%; padding-bottom: 4px;">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr><td style="padding: 2px 0;">Sales</td><td style="text-align: center;">0</td><td style="text-align: right;">0.00</td></tr>
              <tr><td style="padding: 2px 0;">Refunds</td><td style="text-align: center;">0</td><td style="text-align: right;">0.00</td></tr>
            </tbody>
          </table>

          <!-- Tax Summary -->
          <div class="bold uppercase" style="margin-top: 10px; font-size: 1.15em;">Tax Summary</div>
          <div class="separator"></div>
          <table style="width: 100%; border-collapse: collapse; font-family: monospace; font-size: 11px; margin-bottom: 10px;">
            <thead>
              <tr style="border-bottom: 1px dashed #000000; font-weight: bold;">
                <th style="text-align: left; width: 50%; padding-bottom: 4px;">Tax Rate</th>
                <th style="text-align: right; width: 50%; padding-bottom: 4px;">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr><td style="padding: 2px 0;">VAT 12.0%</td><td style="text-align: right;">${formatVal(report.vatAmount)}</td></tr>
            </tbody>
          </table>

          <!-- Cash Drawer Summary -->
          <div class="bold uppercase" style="margin-top: 10px; font-size: 1.15em;">Cash Drawer Summary</div>
          <div class="separator"></div>
          <table style="width: 100%; border-collapse: collapse; font-family: monospace; font-size: 11px; margin-bottom: 15px;">
            <thead>
              <tr style="border-bottom: 1px dashed #000000; font-weight: bold;">
                <th style="text-align: left; width: 45%; padding-bottom: 4px;">Category</th>
                <th style="text-align: center; width: 15%; padding-bottom: 4px;">Sign</th>
                <th style="text-align: center; width: 15%; padding-bottom: 4px;">Qty</th>
                <th style="text-align: right; width: 25%; padding-bottom: 4px;">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="text-align: left; padding: 2px 0;">Opening Amount</td>
                <td style="text-align: center;"></td>
                <td style="text-align: center;"></td>
                <td style="text-align: right;">${formatVal(report.openingCash)}</td>
              </tr>
              <tr>
                <td style="text-align: left; padding: 2px 0;">Cash Sales</td>
                <td style="text-align: center;">(+)</td>
                <td style="text-align: center;">${report.cashSummary.salesQty}</td>
                <td style="text-align: right;">${formatVal(report.cashSales)}</td>
              </tr>
              <tr>
                <td style="text-align: left; padding: 2px 0;">Cash Deposits</td>
                <td style="text-align: center;">(+)</td>
                <td style="text-align: center;">0</td>
                <td style="text-align: right;">0.00</td>
              </tr>
              <tr>
                <td style="text-align: left; padding: 2px 0;">Cash Refunds</td>
                <td style="text-align: center;">(-)</td>
                <td style="text-align: center;">${report.cashSummary.refundsQty}</td>
                <td style="text-align: right;">${formatVal(report.cashRefunds)}</td>
              </tr>
              <tr>
                <td style="text-align: left; padding: 2px 0;">Pay out</td>
                <td style="text-align: center;">(-)</td>
                <td style="text-align: center;">0</td>
                <td style="text-align: right;">0.00</td>
              </tr>
              <tr>
                <td style="text-align: left; padding: 2px 0;">Pay In</td>
                <td style="text-align: center;">(+)</td>
                <td style="text-align: center;">0</td>
                <td style="text-align: right;">0.00</td>
              </tr>
              <tr class="bold" style="border-top: 1px dashed #000000;">
                <td colspan="3" style="text-align: left; padding: 6px 0 2px 0;">Expected Drawer</td>
                <td style="text-align: right; padding: 6px 0 2px 0;">${formatVal(report.expectedDrawer)}</td>
              </tr>
              <tr class="bold">
                <td colspan="3" style="text-align: left; padding: 2px 0;">Actual Drawer</td>
                <td style="text-align: right; padding: 2px 0;">${formatVal(report.actualDrawer)}</td>
              </tr>
              <tr class="bold" style="border-top: 1px dashed #000000; border-bottom: 2px solid #000000;">
                <td colspan="3" style="text-align: left; padding: 4px 0 4px 0;">Over/Short</td>
                <td style="text-align: right; padding: 4px 0 4px 0; color: ${report.overShort < 0 ? '#ef4444' : '#10b981'}">${formatVal(report.overShort)}</td>
              </tr>
            </tbody>
          </table>

          <div class="centered" style="margin-top: 25px; font-size: 10px; font-weight: bold; text-transform: uppercase;">
            * End of Z Shift Report *
          </div>
          ${template.footer_text ? `
            <div class="centered footer-text">
              ${template.footer_text}
            </div>
          ` : ''}
        </div>
      </body>
    </html>
  `;

  printWindow.document.write(html);
  printWindow.document.close();
};

export const printEndOfDayPDFReport = (report: any, template: TransferSlipTemplate) => {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Please allow popups to generate the PDF report.');
    return;
  }

  const formatVal = (num: number) => 
    (num || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const renderSummaryRow = (title: string, data: any) => {
    return `
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 10px; font-weight: 600; text-align: left;">${title}</td>
        <td style="padding: 10px; text-align: center;">${data.salesQty}</td>
        <td style="padding: 10px; text-align: right;">₱${formatVal(data.salesAmt)}</td>
        <td style="padding: 10px; text-align: center;">${data.refundsQty}</td>
        <td style="padding: 10px; text-align: right; color: #ef4444;">₱${formatVal(data.refundsAmt)}</td>
        <td style="padding: 10px; text-align: right; font-weight: 700; color: #4f46e5;">₱${formatVal(data.netAmt)}</td>
      </tr>
    `;
  };

  const logoHtml = template?.logo_url
    ? `<img src="${template.logo_url}" style="max-height: 56px; max-width: 120px; object-fit: contain; border-radius: 4px;" />`
    : '';

  const signaturesHtml = (template?.show_signatures !== false)
    ? `<div class="signatures">
        <div class="sig-box">
          <div class="sig-title">${template?.sender_label || 'Prepared By (Cashier/Staff Signature)'}</div>
          <div style="margin-top: 50px; font-size: 11px; color: #64748b;">Name: ______________________</div>
        </div>
        <div class="sig-box">
          <div class="sig-title">${template?.receiver_label || 'Verified By (Manager/Auditor Signature)'}</div>
          <div style="margin-top: 50px; font-size: 11px; color: #64748b;">Name: ______________________</div>
        </div>
      </div>`
    : '';

  const footerHtml = template?.custom_footer
    ? `<div style="margin-top: 40px; text-align: center; font-size: 11px; color: #64748b; border-top: 1px dashed #cbd5e1; padding-top: 15px;">
        ${template.custom_footer}
      </div>`
    : '';

  const html = `
    <html>
      <head>
        <title>Z-Report - ${report.controlNumber || report.reportDate.split(' ')[0]}</title>
        <style>
          body {
            font-family: 'Inter', -apple-system, sans-serif;
            color: #1e293b;
            padding: 40px;
            background-color: #ffffff;
            margin: 0;
          }
          .report-container {
            max-width: 900px;
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
          .brand {
            font-size: 24px;
            font-weight: 800;
            color: #4f46e5;
            text-transform: uppercase;
            letter-spacing: -0.025em;
          }
          .title {
            font-size: 16px;
            font-weight: 700;
            text-transform: uppercase;
            color: #64748b;
            letter-spacing: 0.05em;
          }
          .meta-grid {
            display: grid;
            grid-template-cols: repeat(3, 1fr);
            gap: 20px;
            margin-bottom: 30px;
            background-color: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 20px;
          }
          .meta-item h3 {
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            color: #64748b;
            margin: 0 0 6px 0;
            letter-spacing: 0.05em;
          }
          .meta-item p {
            font-size: 14px;
            font-weight: 600;
            margin: 0;
            color: #0f172a;
          }
          .section-title {
            font-size: 14px;
            font-weight: 700;
            text-transform: uppercase;
            color: #334155;
            margin-bottom: 12px;
            margin-top: 30px;
            letter-spacing: 0.05em;
            border-left: 4px solid #4f46e5;
            padding-left: 8px;
          }
          .report-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
            margin-bottom: 25px;
          }
          .report-table th {
            background-color: #f1f5f9;
            font-weight: 700;
            color: #475569;
            padding: 10px;
            text-align: left;
            border-bottom: 2px solid #cbd5e1;
          }
          .report-table td {
            padding: 10px;
            border-bottom: 1px solid #e2e8f0;
          }
          .grid-2 {
            display: grid;
            grid-template-cols: 1.2fr 1fr;
            gap: 30px;
          }
          .drawer-box {
            background-color: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 20px;
          }
          .drawer-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px dashed #e2e8f0;
            font-size: 13px;
          }
          .drawer-row:last-child {
            border-bottom: none;
          }
          .drawer-total {
            font-size: 15px;
            font-weight: 800;
            border-top: 2px solid #cbd5e1;
            padding-top: 10px;
            margin-top: 6px;
          }
          .signatures {
            display: flex;
            justify-content: space-between;
            margin-top: 60px;
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
          }
          .print-btn {
            background-color: #4f46e5;
            color: white;
            border: none;
            padding: 10px 20px;
            font-size: 14px;
            border-radius: 6px;
            cursor: pointer;
            margin-bottom: 25px;
            font-weight: 700;
          }
          @media print {
            .print-btn { display: none; }
            body { padding: 0; }
          }
        </style>
      </head>
      <body>
        <div class="report-container">
          <button class="print-btn" onclick="window.print()">Print PDF Report</button>
          
          <div class="header">
            <div style="display: flex; align-items: center; gap: 16px;">
              ${logoHtml}
              <div>
                <div class="brand">${template?.header_title || 'Dr Humba IMS'}</div>
                <div style="font-size: 12px; color: #64748b; font-weight: 500; margin-top: 2px;">
                  ${template?.header_subtitle || report.branchName} ${report.branchLocation && !template?.header_subtitle ? ` | ${report.branchLocation}` : ''}
                </div>
              </div>
            </div>
            <div style="text-align: right;">
              <div class="title">Z-Report Shift Summary</div>
              <div style="font-size: 12px; color: #4f46e5; font-weight: 700; font-family: monospace; margin-top: 2px;">
                Control No: ${report.controlNumber || 'N/A'}
              </div>
            </div>
          </div>

          <div class="meta-grid">
            <div class="meta-item">
              <h3>Shift Open Time</h3>
              <p>${report.shiftOpenTime}</p>
            </div>
            <div class="meta-item">
              <h3>Shift Close Time</h3>
              <p>${report.shiftCloseTime}</p>
            </div>
            <div class="meta-item">
              <h3>Register / Cashier</h3>
              <p>${report.managerName}</p>
            </div>
            <div class="meta-item">
              <h3>Report Generated At</h3>
              <p>${report.reportDate}</p>
            </div>
            <div class="meta-item">
              <h3>Branch Location</h3>
              <p>${report.branchName}</p>
            </div>
            <div class="meta-item">
              <h3>Register Number</h3>
              <p>Register #${report.register}</p>
            </div>
          </div>

          <div class="section-title">Sales Summary by Payment Type</div>
          <table class="report-table">
            <thead>
              <tr>
                <th style="text-align: left;">Payment Method</th>
                <th style="text-align: center;">Sales Qty</th>
                <th style="text-align: right;">Sales Amount</th>
                <th style="text-align: center;">Refund Qty</th>
                <th style="text-align: right;">Refund Amount</th>
                <th style="text-align: right;">Net Amount</th>
              </tr>
            </thead>
            <tbody>
              ${renderSummaryRow('Cash Summary', report.cashSummary)}
              ${renderSummaryRow('CreditCard Summary', report.cardSummary)}
              ${renderSummaryRow('GCASH Summary', report.gcashSummary)}
              ${renderSummaryRow('Maya Summary', report.mayaSummary)}
              ${renderSummaryRow('Other Summary', report.otherSummary)}
              <tr style="background-color: #f8fafc; font-weight: bold; border-top: 2px solid #cbd5e1; border-bottom: 2px solid #cbd5e1;">
                <td style="padding: 10px; text-align: left;">Total Sales Net</td>
                <td style="padding: 10px; text-align: center;">${report.salesSummary.netQty}</td>
                <td style="padding: 10px; text-align: right;">₱${formatVal(report.salesSummary.salesAmt)}</td>
                <td style="padding: 10px; text-align: center;">${report.salesSummary.refundsQty}</td>
                <td style="padding: 10px; text-align: right; color: #ef4444;">₱${formatVal(report.salesSummary.refundsAmt)}</td>
                <td style="padding: 10px; text-align: right; color: #4f46e5; font-size: 1.1em;">₱${formatVal(report.salesSummary.netAmt)}</td>
              </tr>
            </tbody>
          </table>

          <div class="grid-2">
            <div>
              <div class="section-title">Cash Drawer Balancing</div>
              <div class="drawer-box">
                <div class="drawer-row">
                  <span>Opening Cash Float</span>
                  <span class="font-semibold">₱${formatVal(report.openingCash)}</span>
                </div>
                <div class="drawer-row">
                  <span>Cash Sales (+)</span>
                  <span class="font-semibold">₱${formatVal(report.cashSales)}</span>
                </div>
                <div class="drawer-row text-rose-600" style="color: #ef4444;">
                  <span>Cash Refunds (-)</span>
                  <span class="font-semibold">₱${formatVal(report.cashRefunds)}</span>
                </div>
                <div class="drawer-row">
                  <span>Cash Deposits (+)</span>
                  <span class="font-semibold">₱0.00</span>
                </div>
                <div class="drawer-row">
                  <span>Pay Out / Payout (-)</span>
                  <span class="font-semibold">₱0.00</span>
                </div>
                <div class="drawer-row drawer-total">
                  <span>Expected Drawer Cash</span>
                  <span class="font-bold text-slate-800">₱${formatVal(report.expectedDrawer)}</span>
                </div>
                <div class="drawer-row drawer-total">
                  <span>Actual Drawer Cash Counted</span>
                  <span class="font-bold text-indigo-700" style="color: #4f46e5;">₱${formatVal(report.actualDrawer)}</span>
                </div>
                <div class="drawer-row drawer-total" style="border-top: 2px solid #4f46e5; padding-top: 10px; margin-top: 6px;">
                  <span>Over / Short Balance</span>
                  <span class="font-extrabold ${report.overShort < 0 ? 'text-rose-600' : 'text-emerald-600'}" style="color: ${report.overShort < 0 ? '#ef4444' : '#10b981'}; font-weight: 800;">
                    ₱${formatVal(report.overShort)}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <div class="section-title">Taxation & Transaction Summary</div>
              <div class="drawer-box" style="height: calc(100% - 34px); box-sizing: border-box; display: flex; flex-direction: column; justify-content: space-between;">
                <div>
                  <div class="drawer-row">
                    <span>12% VAT Rate Summary</span>
                    <span class="font-semibold">12.0%</span>
                  </div>
                  <div class="drawer-row">
                    <span>VAT Component Collected</span>
                    <span class="font-semibold">₱${formatVal(report.vatAmount)}</span>
                  </div>
                  <div class="drawer-row">
                    <span>Canceled Transactions</span>
                    <span class="font-semibold">${report.cancelledCount} Void Txns</span>
                  </div>
                  <div class="drawer-row">
                    <span>Total Voided Amount</span>
                    <span class="font-semibold text-rose-600" style="color: #ef4444;">₱${formatVal(report.cancelledAmount)}</span>
                  </div>
                </div>
                
                <div style="font-size: 11px; color: #64748b; line-height: 1.4; padding-top: 15px; border-top: 1px dashed #cbd5e1; margin-top: 15px;">
                  <strong>Notice:</strong> This Z-Report aggregates all transactions processed within the shift bounds. Any manual adjustments or voids have reversed inventory ingredient deductions.
                </div>
              </div>
            </div>
          </div>

          ${signaturesHtml}
          ${footerHtml}
        </div>
      </body>
    </html>
  `;

  printWindow.document.write(html);
  printWindow.document.close();
};

export const printXZReport = (report: any, isZRead: boolean, merchantName: string = 'BIKETOPIA') => {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Please allow popups to generate the report.');
    return;
  }

  const dateStr = new Date().toLocaleString();
  const openedDateStr = new Date(report.openedAt).toLocaleString();
  const closedDateStr = report.closedAt ? new Date(report.closedAt).toLocaleString() : 'N/A';

  const html = `
    <html>
      <head>
        <title>${isZRead ? 'Z-READ' : 'X-READ'} REPORT</title>
        <style>
          @page { margin: 0; }
          body {
            font-family: 'Courier New', Courier, monospace;
            font-size: 12px;
            line-height: 1.3;
            color: #000000;
            background-color: #ffffff;
            margin: 0;
            padding: 8px;
            width: 76mm;
          }
          .centered { text-align: center; }
          .bold { font-weight: bold; }
          .separator { border-top: 1px dashed #000000; margin: 8px 0; }
          .flex-between { display: flex; justify-content: space-between; }
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
            .print-btn { display: none; }
            body { width: 100%; padding: 0; }
          }
        </style>
      </head>
      <body>
        <button class="print-btn" onclick="window.print()">Print ${isZRead ? 'Z-Read' : 'X-Read'} Report</button>
        <div style="width: 100%;">
          <div class="centered bold" style="font-size: 1.2em; text-transform: uppercase;">
            ${merchantName}
          </div>
          <div class="centered bold" style="margin-top: 4px;">
            ${isZRead ? 'Z-READ END-OF-DAY' : 'X-READ STATUS REPORT'}
          </div>
          <div class="separator"></div>
          
          <div style="font-family: monospace;">
            <div class="flex-between">
              <span>Status:</span>
              <span>${(report.status || '').toUpperCase()}</span>
            </div>
            ${report.controlNumber ? `
            <div class="flex-between">
              <span>Control No:</span>
              <span>${report.controlNumber}</span>
            </div>
            ` : ''}
            <div class="flex-between">
              <span>Z-Counter:</span>
              <span>#${String(report.zCounter || 0).padStart(5, '0')}</span>
            </div>
            <div class="flex-between">
              <span>Opened At:</span>
              <span>${openedDateStr}</span>
            </div>
            <div class="flex-between">
              <span>Closed At:</span>
              <span>${closedDateStr}</span>
            </div>
            <div class="flex-between">
              <span>Printed At:</span>
              <span>${dateStr}</span>
            </div>
          </div>

          <div class="separator"></div>

          <div style="font-family: monospace;">
            <div class="flex-between bold">
              <span>LIFETIME GRAND TOTALS:</span>
            </div>
            <div class="flex-between">
              <span>Start:</span>
              <span>₱${Number(report.grandTotalStart || 0).toFixed(2)}</span>
            </div>
            <div class="flex-between">
              <span>End:</span>
              <span>₱${Number(report.grandTotalEnd || 0).toFixed(2)}</span>
            </div>
          </div>

          <div class="separator"></div>

          <div style="font-family: monospace;">
            <div class="flex-between bold">
              <span>SALES TRANSACTION DATA:</span>
            </div>
            <div class="flex-between">
              <span>Gross Sales:</span>
              <span>₱${Number(report.grossSales || 0).toFixed(2)}</span>
            </div>
            <div class="flex-between">
              <span>Net Sales (VAT-Ex):</span>
              <span>₱${Number(report.netSales || 0).toFixed(2)}</span>
            </div>
            <div class="flex-between">
              <span>VAT Amount (12%):</span>
              <span>₱${Number(report.vatAmount || 0).toFixed(2)}</span>
            </div>
            <div class="flex-between">
              <span>Transaction Count:</span>
              <span>${report.transactionCount || 0}</span>
            </div>
          </div>

          <div class="separator"></div>

          <div style="font-family: monospace;">
            <div class="flex-between bold">
              <span>PAYMENT MODE SUMMARY:</span>
            </div>
            <div class="flex-between">
              <span>Cash Sales:</span>
              <span>₱${Number(report.cashSales || 0).toFixed(2)}</span>
            </div>
            <div class="flex-between">
              <span>GCash Sales:</span>
              <span>₱${Number(report.gcashSales || 0).toFixed(2)}</span>
            </div>
            <div class="flex-between">
              <span>Maya Sales:</span>
              <span>₱${Number(report.mayaSales || 0).toFixed(2)}</span>
            </div>
            <div class="flex-between">
              <span>Card Sales:</span>
              <span>₱${Number(report.cardSales || 0).toFixed(2)}</span>
            </div>
            <div class="flex-between">
              <span>Other Sales:</span>
              <span>₱${Number(report.otherSales || 0).toFixed(2)}</span>
            </div>
          </div>

          <div class="separator"></div>

          <div style="font-family: monospace;">
            <div class="flex-between bold">
              <span>REFUNDS & VOIDS:</span>
            </div>
            <div class="flex-between">
              <span>Void Count:</span>
              <span>${report.voidCount || 0}</span>
            </div>
            <div class="flex-between">
              <span>Void Amount:</span>
              <span>₱${Number(report.voidAmount || 0).toFixed(2)}</span>
            </div>
          </div>

          <div class="separator"></div>

          <div style="font-family: monospace;">
            <div class="flex-between bold">
              <span>DRAWER ACCOUNTABILITY:</span>
            </div>
            <div class="flex-between">
              <span>Opening Cash:</span>
              <span>₱${Number(report.openingBalance || 0).toFixed(2)}</span>
            </div>
            <div class="flex-between">
              <span>Expected Cash:</span>
              <span>₱${Number(report.expectedCash || 0).toFixed(2)}</span>
            </div>
            <div class="flex-between">
              <span>Actual Drawer:</span>
              <span>₱${Number(report.actualCash || 0).toFixed(2)}</span>
            </div>
            <div class="flex-between bold">
              <span>Discrepancy:</span>
              <span>₱${Number(report.discrepancy || 0).toFixed(2)}</span>
            </div>
          </div>

          <div class="separator"></div>
          <div class="centered footer-text">
            *** END OF REPORT ***
          </div>
        </div>
      </body>
    </html>
  `;

  printWindow.document.write(html);
  printWindow.document.close();
};
