import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { InvoiceLookupData } from '@/types/returns';

// ==========================================
// STORE CONFIGURATION & THEME CONSTANTS
// ==========================================
export interface StoreConfig {
  storeName: string;
  tagline?: string;
  addressLine1: string;
  addressLine2?: string;
  phone: string;
  email?: string;
  gstin?: string;
}

export const DEFAULT_STORE_CONFIG: StoreConfig = {
  storeName: 'Melbun Wholesale',
  tagline: 'Premium Wholesale & Retail POS',
  addressLine1: 'Shop #12, Commercial Central Market',
  addressLine2: 'MG Road, Bengaluru, Karnataka - 560001',
  phone: '+91 98765 43210',
  email: 'billing@melbunwholesale.com',
  gstin: '29ABCDE1234F1Z5',
};

// Brand Color Palette (Deep Burgundy / Crimson)
const BRAND_PRIMARY: [number, number, number] = [139, 0, 0]; // #8B0000
const BRAND_DARK: [number, number, number] = [100, 0, 0];
const TEXT_PRIMARY: [number, number, number] = [30, 41, 59]; // slate-800
const TEXT_MUTED: [number, number, number] = [100, 116, 139]; // slate-500
const BG_LIGHT: [number, number, number] = [248, 250, 252]; // slate-50
const BORDER_COLOR: [number, number, number] = [226, 232, 240]; // slate-200
const DANGER_RED: [number, number, number] = [220, 38, 38]; // red-600
const SUCCESS_GREEN: [number, number, number] = [22, 101, 52]; // green-800

// Safe currency formatter for PDF rendering (Prevents unicode encoding corruption)
export const formatCurrency = (amount: number | string | null | undefined): string => {
  const numeric = typeof amount === 'number' ? amount : parseFloat(String(amount || 0));
  const safeNum = isNaN(numeric) ? 0 : numeric;
  return `Rs. ${safeNum.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

export const cleanAscii = (text: string | null | undefined): string => {
  if (!text) return '';
  return String(text).replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim();
};

export interface GenerateInvoicePdfOptions {
  storeConfig?: Partial<StoreConfig>;
  action?: 'save' | 'open' | 'blob' | 'doc';
  fileName?: string;
}

/**
 * Enterprise-grade POS Invoice PDF Generator for MelbunPOS
 * Fully hardened against invalid payloads, null fields, voided transactions, and partial returns.
 */
export const generateInvoicePDF = (
  invoice: any,
  options: GenerateInvoicePdfOptions = {}
): jsPDF => {
  if (!invoice || !invoice.invoice_number) {
    throw new Error('Invalid invoice payload supplied to PDF Generator.');
  }

  const store: StoreConfig = { ...DEFAULT_STORE_CONFIG, ...options.storeConfig };
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;
  let currentY = margin;

  // ==========================================
  // 1. VOIDED WATERMARK & SECURITY BANNER
  // ==========================================
  if (invoice.is_voided) {
    // Red Security Warning Banner
    doc.setFillColor(254, 226, 226); // red-100
    doc.setDrawColor(...DANGER_RED);
    doc.setLineWidth(0.5);
    doc.rect(margin, currentY, contentWidth, 10, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...DANGER_RED);
    doc.text('*** VOIDED / CANCELLED INVOICE - NOT VALID FOR SALE ***', pageWidth / 2, currentY + 6.5, {
      align: 'center',
    });

    currentY += 14;

    // Diagonal Background Watermark
    doc.saveGraphicsState();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(60);
    doc.setTextColor(239, 68, 68); // light red
    doc.setGState(new (doc as any).GState({ opacity: 0.12 }));
    doc.text('VOIDED', pageWidth / 2, pageHeight / 2, {
      align: 'center',
      angle: 45,
    });
    doc.restoreGraphicsState();
  }

  // ==========================================
  // 2. STORE BRANDING & INVOICE HEADER
  // ==========================================
  const headerStartY = currentY;

  // Left Column: Store Branding
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...BRAND_PRIMARY);
  doc.text(cleanAscii(store.storeName), margin, currentY + 4);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...TEXT_MUTED);

  let brandY = currentY + 9;
  if (store.tagline) {
    doc.text(cleanAscii(store.tagline), margin, brandY);
    brandY += 4;
  }
  doc.text(cleanAscii(store.addressLine1), margin, brandY);
  brandY += 4;
  if (store.addressLine2) {
    doc.text(cleanAscii(store.addressLine2), margin, brandY);
    brandY += 4;
  }
  doc.text(`Phone: ${store.phone} | Email: ${store.email || 'N/A'}`, margin, brandY);
  brandY += 4;
  if (store.gstin) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...TEXT_PRIMARY);
    doc.text(`Store GSTIN: ${store.gstin}`, margin, brandY);
    doc.setFont('helvetica', 'normal');
  }

  // Right Column: Invoice Metadata Box
  const metaBoxWidth = 70;
  const metaBoxX = pageWidth - margin - metaBoxWidth;

  doc.setFillColor(...BG_LIGHT);
  doc.setDrawColor(...BORDER_COLOR);
  doc.setLineWidth(0.3);
  doc.roundedRect(metaBoxX, headerStartY, metaBoxWidth, 34, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...BRAND_PRIMARY);
  doc.text(invoice.gst_applied ? 'TAX INVOICE' : 'RETAIL INVOICE', metaBoxX + 4, headerStartY + 7);

  doc.setFontSize(8.5);
  doc.setTextColor(...TEXT_MUTED);
  doc.text('Invoice Number:', metaBoxX + 4, headerStartY + 14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...TEXT_PRIMARY);
  doc.text(invoice.invoice_number, metaBoxX + 4, headerStartY + 18);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...TEXT_MUTED);
  doc.text('Date & Time:', metaBoxX + 4, headerStartY + 24);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...TEXT_PRIMARY);
  const formattedDate = invoice.created_at
    ? new Date(invoice.created_at).toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : 'N/A';
  doc.text(formattedDate, metaBoxX + 4, headerStartY + 28);

  currentY = Math.max(brandY + 6, headerStartY + 38);

  // Divider line
  doc.setDrawColor(...BORDER_COLOR);
  doc.setLineWidth(0.4);
  doc.line(margin, currentY, pageWidth - margin, currentY);
  currentY += 5;

  // ==========================================
  // 3. CUSTOMER DETAILS SECTION
  // ==========================================
  doc.setFillColor(...BG_LIGHT);
  doc.roundedRect(margin, currentY, contentWidth, 18, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...BRAND_PRIMARY);
  doc.text('BILLED TO:', margin + 4, currentY + 5);

  const customer = invoice.customers;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...TEXT_PRIMARY);
  const customerName = cleanAscii(customer?.name || 'Walk-in Customer / Cash Sale');
  doc.text(customerName, margin + 4, currentY + 10.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...TEXT_MUTED);
  const customerPhone = cleanAscii(customer?.phone ? `Phone: ${customer.phone}` : 'Phone: Unregistered');
  const customerGstin = customer?.gstin ? ` | GSTIN: ${cleanAscii(customer.gstin)}` : '';
  doc.text(`${customerPhone}${customerGstin}`, margin + 4, currentY + 15);

  // Status Badge on the right
  const badgeWidth = 28;
  const badgeX = pageWidth - margin - badgeWidth - 4;
  if (invoice.is_voided) {
    doc.setFillColor(254, 226, 226);
    doc.roundedRect(badgeX, currentY + 4, badgeWidth, 8, 1, 1, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...DANGER_RED);
    doc.text('VOIDED', badgeX + badgeWidth / 2, currentY + 9, { align: 'center' });
  } else {
    doc.setFillColor(220, 252, 231);
    doc.roundedRect(badgeX, currentY + 4, badgeWidth, 8, 1, 1, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...SUCCESS_GREEN);
    doc.text('COMPLETED', badgeX + badgeWidth / 2, currentY + 9, { align: 'center' });
  }

  currentY += 23;

  // ==========================================
  // 4. LINE ITEMS TABLE (Deeply Styled)
  // ==========================================
  const tableItems = invoice.invoice_items || [];
  const tableBody = tableItems.map((item: any, index: number) => {
    const itemName = cleanAscii(item.variants?.name || 'Item');
    const barcode = item.variants?.barcode ? `\nBarcode: ${cleanAscii(item.variants.barcode)}` : '';
    
    // Check if item has returns associated
    const totalReturned = (item.returns || []).reduce((acc: number, r: any) => acc + (r.quantity || 0), 0);
    const returnNote = totalReturned > 0 ? `\n[Returned: ${totalReturned} pcs]` : '';

    const unitPrice = Number(item.selling_price_snapshot || 0);
    const qty = Number(item.quantity || 0);
    const lineTotal = unitPrice * qty;

    return [
      (index + 1).toString(),
      `${itemName}${barcode}${returnNote}`,
      formatCurrency(unitPrice),
      qty.toString(),
      formatCurrency(lineTotal),
    ];
  });

  autoTable(doc, {
    startY: currentY,
    head: [['#', 'Item Description', 'Unit Price', 'Qty', 'Total']],
    body: tableBody,
    theme: 'grid',
    headStyles: {
      fillColor: BRAND_PRIMARY,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8.5,
      halign: 'left',
      cellPadding: 2.5,
    },
    columnStyles: {
      0: { halign: 'center', cellWidth: 10 },
      1: { halign: 'left', cellWidth: 'auto' },
      2: { halign: 'right', cellWidth: 32 },
      3: { halign: 'center', cellWidth: 18 },
      4: { halign: 'right', cellWidth: 34 },
    },
    bodyStyles: {
      textColor: TEXT_PRIMARY,
      fontSize: 8,
      cellPadding: 2.2,
    },
    alternateRowStyles: {
      fillColor: BG_LIGHT,
    },
    margin: { left: margin, right: margin, bottom: 25 },
  });

  currentY = (doc as any).lastAutoTable.finalY + 6;

  // ==========================================
  // 5. RETURNS & REFUNDS SUB-TABLE (If Applicable)
  // ==========================================
  const allReturns = tableItems.flatMap((i: any) =>
    (i.returns || []).map((r: any) => ({
      ...r,
      variantName: i.variants?.name || 'Item',
    }))
  );

  if (allReturns.length > 0) {
    // Avoid page overflow
    if (currentY > pageHeight - 65) {
      doc.addPage();
      currentY = margin;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...DANGER_RED);
    doc.text('Processed Returns & Refund Ledger:', margin, currentY);
    currentY += 2;

    const returnsBody = allReturns.map((r: any, idx: number) => [
      (idx + 1).toString(),
      r.variantName,
      `${r.quantity} pcs (${r.return_type})`,
      r.refund_method,
      formatCurrency(r.total_refund_amount),
    ]);

    autoTable(doc, {
      startY: currentY,
      head: [['#', 'Returned Item', 'Qty & Type', 'Refund Method', 'Refunded Amount']],
      body: returnsBody,
      theme: 'grid',
      headStyles: {
        fillColor: [185, 28, 28], // red-700
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8,
        cellPadding: 2,
      },
      columnStyles: {
        0: { halign: 'center', cellWidth: 8 },
        1: { halign: 'left', cellWidth: 'auto' },
        2: { halign: 'left', cellWidth: 35 },
        3: { halign: 'center', cellWidth: 25 },
        4: { halign: 'right', cellWidth: 32 },
      },
      bodyStyles: {
        textColor: TEXT_PRIMARY,
        fontSize: 7.5,
        cellPadding: 1.8,
      },
      alternateRowStyles: {
        fillColor: [254, 242, 242], // red-50
      },
      margin: { left: margin, right: margin, bottom: 25 },
    });

    currentY = (doc as any).lastAutoTable.finalY + 6;
  }

  // ==========================================
  // 6. FINANCIAL TOTALS & TAX BREAKDOWN BLOCK
  // ==========================================
  // Payment status calculations
  const totalPaid = (invoice.payments || []).reduce((acc: number, p: any) => acc + (Number(p.amount) || 0), 0);
  const totalRefunds = (invoice.invoice_items || []).flatMap((i: any) => i.returns || []).reduce((acc: number, r: any) => acc + (Number(r.total_refund_amount) || 0), 0);
  const effectiveTotal = Math.max(0, Number(invoice.final_total || 0) - totalRefunds);
  const balanceDue = invoice.is_voided ? 0 : Math.max(0, effectiveTotal - totalPaid);

  // Calculate dynamic rows for summary box
  let summaryRowCount = 1; // Subtotal
  if (Number(invoice.discount_amount) > 0) summaryRowCount++;
  if (invoice.gst_applied) summaryRowCount += 2;
  if (Number(invoice.round_off) !== 0) summaryRowCount++;
  if (totalRefunds > 0) summaryRowCount += 2; // Refunded line + Effective Net Total line
  if (totalPaid > 0) summaryRowCount++;
  if (balanceDue > 0) summaryRowCount++;

  const totalsBoxHeight = Math.max(45, 10 + (summaryRowCount * 4.5) + 8.5);

  if (currentY + totalsBoxHeight > pageHeight - 20) {
    doc.addPage();
    currentY = margin;
  }

  const totalsBoxWidth = 85;
  const totalsBoxX = pageWidth - margin - totalsBoxWidth;
  const totalsStartY = currentY;
  const leftBoxHeight = totalsBoxHeight;

  // Left Note Box (Payment Terms & Remarks)
  const leftBoxWidth = contentWidth - totalsBoxWidth - 6;
  doc.setFillColor(...BG_LIGHT);
  doc.setDrawColor(...BORDER_COLOR);
  doc.roundedRect(margin, totalsStartY, leftBoxWidth, leftBoxHeight, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...BRAND_PRIMARY);
  doc.text('PAYMENT & TRANSACTION DETAILS', margin + 4, totalsStartY + 5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...TEXT_MUTED);
  
  const positivePayments = (invoice.payments || []).filter((p: any) => Number(p.amount) > 0);
  const paymentDetails = positivePayments.length > 0
    ? positivePayments.map((p: any) => `${p.method}: ${formatCurrency(p.amount)}`).join(', ')
    : Number(invoice.final_total) === 0
    ? 'COMPLIMENTARY / ₹0 SALE'
    : 'UNPAID / ON ACCOUNT (CREDIT TAB)';
  
  doc.text(`Tender Mode: ${paymentDetails}`, margin + 4, totalsStartY + 10);
  if (balanceDue > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...DANGER_RED);
    doc.text(`Outstanding Due Balance: ${formatCurrency(balanceDue)}`, margin + 4, totalsStartY + 15);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...TEXT_MUTED);
  }
  doc.text('Terms & Conditions:', margin + 4, totalsStartY + (balanceDue > 0 ? 20 : 16));
  doc.text('1. Goods once sold can only be returned within 7 days.', margin + 4, totalsStartY + (balanceDue > 0 ? 24 : 20));
  doc.text('2. Original invoice required for all returns or warranty claims.', margin + 4, totalsStartY + (balanceDue > 0 ? 28 : 24));
  doc.text('3. In case of discrepancy, jurisdiction is Bengaluru.', margin + 4, totalsStartY + (balanceDue > 0 ? 32 : 28));
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...TEXT_PRIMARY);
  doc.text('Thank you for your business with Melbun Wholesale!', margin + 4, totalsStartY + leftBoxHeight - 4);

  // Right Totals Breakdown Box
  doc.setFillColor(...BG_LIGHT);
  doc.setDrawColor(...BORDER_COLOR);
  doc.roundedRect(totalsBoxX, totalsStartY, totalsBoxWidth, totalsBoxHeight, 1.5, 1.5, 'FD');

  let summaryY = totalsStartY + 5;
  const printSummaryRow = (label: string, value: string, isBold: boolean = false, isDanger: boolean = false) => {
    doc.setFont('helvetica', isBold ? 'bold' : 'normal');
    doc.setFontSize(8);
    doc.setTextColor(isDanger ? DANGER_RED[0] : TEXT_PRIMARY[0], isDanger ? DANGER_RED[1] : TEXT_PRIMARY[1], isDanger ? DANGER_RED[2] : TEXT_PRIMARY[2]);
    doc.text(label, totalsBoxX + 4, summaryY);
    doc.text(value, pageWidth - margin - 4, summaryY, { align: 'right' });
    summaryY += 4.5;
  };

  printSummaryRow('Subtotal:', formatCurrency(invoice.subtotal));

  if (Number(invoice.discount_amount) > 0) {
    printSummaryRow('Discount Applied:', `-${formatCurrency(invoice.discount_amount)}`, false, true);
  }

  if (invoice.gst_applied) {
    const cgst = Number(invoice.cgst_amount || 0);
    const sgst = Number(invoice.sgst_amount || 0);
    printSummaryRow('CGST (2.5%):', formatCurrency(cgst));
    printSummaryRow('SGST (2.5%):', formatCurrency(sgst));
  }

  if (Number(invoice.round_off) !== 0) {
    const roundOffSign = Number(invoice.round_off) > 0 ? '+' : '';
    printSummaryRow('Round Off:', `${roundOffSign}${formatCurrency(invoice.round_off)}`);
  }

  // Grand Total Highlight Bar
  doc.setFillColor(...BRAND_PRIMARY);
  doc.rect(totalsBoxX, summaryY - 1, totalsBoxWidth, 7, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text('FINAL TOTAL:', totalsBoxX + 4, summaryY + 4);
  doc.text(formatCurrency(invoice.final_total), pageWidth - margin - 4, summaryY + 4, {
    align: 'right',
  });
  summaryY += 8.5;

  if (totalRefunds > 0) {
    printSummaryRow('Refunded (Returns):', `-${formatCurrency(totalRefunds)}`, false, true);
    printSummaryRow('Effective Net Total:', formatCurrency(effectiveTotal), true);
  }

  if (totalPaid > 0) {
    printSummaryRow('Paid Amount:', formatCurrency(totalPaid), true);
  }
  if (balanceDue > 0) {
    printSummaryRow('Balance Due:', formatCurrency(balanceDue), true, true);
  }

  // ==========================================
  // 7. FOOTER WITH RUNNING PAGE NUMBERS
  // ==========================================
  const totalPages = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...TEXT_MUTED);

    // Bottom Rule
    doc.setDrawColor(...BORDER_COLOR);
    doc.setLineWidth(0.3);
    doc.line(margin, pageHeight - 10, pageWidth - margin, pageHeight - 10);

    doc.text(
      `Generated by MelbunPOS Engine on ${new Date().toLocaleDateString('en-IN')}`,
      margin,
      pageHeight - 6
    );

    doc.text(`Page ${i} of ${totalPages}`, pageWidth - margin, pageHeight - 6, {
      align: 'right',
    });
  }

  // ==========================================
  // 8. DISPATCH ACTION
  // ==========================================
  const outputFileName = options.fileName || `Invoice_${invoice.invoice_number.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;

  switch (options.action) {
    case 'open':
      doc.output('dataurlnewwindow');
      break;
    case 'blob':
      // Caller consumes blob for print preview iframe
      break;
    case 'doc':
      return doc;
    case 'save':
    default:
      doc.save(outputFileName);
      break;
  }

  return doc;
};
