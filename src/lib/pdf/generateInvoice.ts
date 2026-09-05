import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { numberToIndianWords } from '@/lib/numberToWords';
import { BRAND_ASSETS } from '@/lib/pdf/brandAssets';

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
  state?: string;
}

export const DEFAULT_STORE_CONFIG: StoreConfig = {
  storeName: 'MELBUN CLOTHING',
  tagline: 'SIGN OF RICH',
  addressLine1: 'SMS CENTRE, BANK ROAD, KASARAGOD 671121',
  addressLine2: '',
  phone: '9440028819',
  email: 'melbunindia@gmail.com',
  gstin: '32CHLPA3518R2Z8',
  state: '32-Kerala',
};

// Luxury Terracotta Brand Palette (Matching reference design)
const BRAND_PRIMARY: [number, number, number] = [139, 37, 21]; // #8B2515 Deep Terracotta Rust
const BRAND_DARK: [number, number, number] = [112, 28, 15]; // #701C0F Dark Rust
const TEXT_PRIMARY: [number, number, number] = [30, 41, 59]; // slate-800
const TEXT_MUTED: [number, number, number] = [100, 116, 139]; // slate-500
const BG_LIGHT: [number, number, number] = [252, 251, 249]; // #FCFBF9 Warm Ivory
const BORDER_COLOR: [number, number, number] = [226, 232, 240]; // slate-200
const BORDER_TERRACOTTA: [number, number, number] = [217, 185, 178];
const DANGER_RED: [number, number, number] = [185, 28, 28]; // red-700
const SUCCESS_GREEN: [number, number, number] = [22, 101, 52]; // green-800

// Safe currency formatter for PDF rendering (Prevents unicode encoding corruption in PDF engines)
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
 * Enterprise Luxury Apparel Tax/Retail Invoice PDF Generator for MelbunPOS
 * 1-to-1 matching the reference design layout with authentic SVG Terracotta branding,
 * 10% opacity watermark, product name - variant name formatting, and HSN tax breakdown.
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
  const margin = 12;
  const contentWidth = pageWidth - margin * 2;
  let currentY = margin;

  // ==========================================
  // 1 & 2. VOIDED BANNER (If Voided)
  // Watermarks moved to end of document to print on all pages
  // ==========================================
  if (invoice.is_voided) {
    doc.setFillColor(254, 226, 226);
    doc.setDrawColor(...DANGER_RED);
    doc.setLineWidth(0.5);
    doc.rect(margin, currentY, contentWidth, 8, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...DANGER_RED);
    doc.text('*** VOIDED / CANCELLED INVOICE - NOT VALID FOR SALE ***', pageWidth / 2, currentY + 5.5, {
      align: 'center',
    });

    currentY += 11;
  }

  // ==========================================
  // 3. LUXURY STORE BRANDING & HEADER
  // ==========================================
  const headerStartY = currentY;
  const logoBoxWidth = 36;
  const logoBoxHeight = 36;

  // 3A. Left Terracotta Logo Block (Using authentic Base64 PNG derived from user SVGs)
  doc.setFillColor(...BRAND_PRIMARY);
  doc.roundedRect(margin, headerStartY, logoBoxWidth, logoBoxHeight, 2, 2, 'F');

  try {
    // Exact authentic brand logo from text.svg (Helmet Crest + MELBUN + SIGN OF RICH)
    const imgPadding = 3.5;
    const imgW = logoBoxWidth - (imgPadding * 2);
    const imgH = logoBoxHeight - (imgPadding * 2);
    doc.addImage(
      BRAND_ASSETS.fullBrandBase64,
      'PNG',
      margin + imgPadding,
      headerStartY + imgPadding,
      imgW,
      imgH
    );
  } catch (e) {
    console.error('Failed to embed brand logo image:', e);
  }

  // 3B. Center Column: Store Profile & Legal Info
  const centerStartX = margin + logoBoxWidth + 4.5;
  const centerAvailableWidth = 84;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13.5);
  doc.setTextColor(...BRAND_PRIMARY);
  doc.text(store.storeName, centerStartX, headerStartY + 5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...TEXT_PRIMARY);

  let profileY = headerStartY + 10;
  
  // Format Address cleanly with splitTextToSize to avoid horizontal collision
  const fullAddress = [store.addressLine1, store.addressLine2].filter(Boolean).join(', ');
  const splitStoreAddr = doc.splitTextToSize(`Loc: ${fullAddress}`, centerAvailableWidth);
  doc.text(splitStoreAddr.slice(0, 2), centerStartX, profileY);
  profileY += (splitStoreAddr.slice(0, 2).length * 3.6) + 0.8;

  doc.text(`Phone: ${store.phone}`, centerStartX, profileY);
  profileY += 3.6;
  doc.text(`Email: ${store.email || 'melbunindia@gmail.com'}`, centerStartX, profileY);
  profileY += 3.6;
  
  // GSTIN & State Badge
  doc.setFont('helvetica', 'bold');
  doc.text(`GSTIN: ${store.gstin || 'N/A'}`, centerStartX, profileY);
  doc.setFont('helvetica', 'normal');

  const stateBadgeX = centerStartX + 46;
  const stateBadgeY = profileY - 3.2;
  doc.setFillColor(...BG_LIGHT);
  doc.setDrawColor(...BORDER_TERRACOTTA);
  doc.setLineWidth(0.3);
  doc.roundedRect(stateBadgeX, stateBadgeY, 26, 4.5, 1, 1, 'FD');
  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BRAND_PRIMARY);
  doc.text(`State: ${store.state || ''}`, stateBadgeX + 13, stateBadgeY + 3.2, { align: 'center' });

  // 3C. Right Column: Document Title & Geometric Line
  const isProforma = Boolean(invoice.is_proforma || invoice.invoice_number?.startsWith('LINE/') || options.fileName?.includes('Proforma'));
  const rightWidth = isProforma ? 80 : 55;
  const rightX = pageWidth - margin - rightWidth;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(isProforma ? 13.5 : 15.5);
  doc.setTextColor(...BRAND_PRIMARY);
  const docTitle = isProforma ? 'ROAD PROFORMA' : (invoice.gst_applied ? 'TAX INVOICE' : 'RETAIL INVOICE');
  doc.text(docTitle, pageWidth - margin, headerStartY + 6.5, { align: 'right' });

  // Clean geometric line under title
  doc.setDrawColor(...BRAND_PRIMARY);
  doc.setLineWidth(0.4);
  doc.line(rightX + 5, headerStartY + 10, pageWidth - margin, headerStartY + 10);

  currentY = headerStartY + logoBoxHeight + 3.5;

  // ==========================================
  // 4. DUAL-CARD METADATA: BILL TO & INVOICE DETAILS
  // ==========================================
  const cardGap = 3.5;
  const cardWidth = (contentWidth - cardGap) / 2;
  const cardHeight = 26;
  const cardHeaderHeight = 5.5;

  const customer = invoice.customers;
  const isRegistered = Boolean(invoice.customer_id);
  const customerName = invoice.shop_name || customer?.name || (isRegistered ? 'Registered Customer' : 'Walk-in Customer / Cash Sale');
  const customerPhone = invoice.shop_phone ? `+91 ${invoice.shop_phone}` : (customer?.phone ? `+91 ${customer.phone}` : 'Unregistered');
  const customerAddress = customer?.address || 'N/A';
  const customerGstin = customer?.gstin || 'N/A';
  const customerState = customer?.state || store.state || '';
  const placeOfSupply = invoice.place_of_supply || customerState || 'N/A';

  // 4A. Left Card: BILL TO
  const leftCardX = margin;
  doc.setFillColor(...BG_LIGHT);
  doc.setDrawColor(...BORDER_TERRACOTTA);
  doc.setLineWidth(0.3);
  doc.roundedRect(leftCardX, currentY, cardWidth, cardHeight, 1.5, 1.5, 'FD');

  // Title Ribbon
  doc.setFillColor(...BRAND_PRIMARY);
  doc.rect(leftCardX, currentY, cardWidth, cardHeaderHeight, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(255, 255, 255);
  doc.text(isProforma ? 'CONSIGNEE / SHOP DETAILS:' : 'BILL TO:', leftCardX + 3.5, currentY + 3.8);

  // Customer Body
  let custBodyY = currentY + cardHeaderHeight + 3.5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...TEXT_PRIMARY);
  doc.text(customerName, leftCardX + 3.5, custBodyY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...TEXT_MUTED);
  custBodyY += 3.5;
  const splitAddr = doc.splitTextToSize(customerAddress, cardWidth - 7);
  doc.text(splitAddr.slice(0, 1), leftCardX + 3.5, custBodyY);

  custBodyY += 3.5;
  doc.text(`Contact No: ${customerPhone}`, leftCardX + 3.5, custBodyY);

  custBodyY += 3.5;
  doc.text(`State: ${cleanAscii(customerState)}`, leftCardX + 3.5, custBodyY);
  doc.setFont('helvetica', 'bold');
  doc.text(`GSTIN: ${customerGstin}`, leftCardX + cardWidth - 3.5, custBodyY, { align: 'right' });

  // 4B. Right Card: INVOICE DETAILS
  const rightCardX = margin + cardWidth + cardGap;
  doc.setFillColor(...BG_LIGHT);
  doc.setDrawColor(...BORDER_TERRACOTTA);
  doc.setLineWidth(0.3);
  doc.roundedRect(rightCardX, currentY, cardWidth, cardHeight, 1.5, 1.5, 'FD');

  // Title Ribbon
  doc.setFillColor(...BRAND_PRIMARY);
  doc.rect(rightCardX, currentY, cardWidth, cardHeaderHeight, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(255, 255, 255);
  doc.text(isProforma ? 'PROFORMA DETAILS:' : 'INVOICE DETAILS:', rightCardX + 3.5, currentY + 3.8);

  // Details Body
  let invBodyY = currentY + cardHeaderHeight + 4;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...TEXT_MUTED);
  doc.text('No:', rightCardX + 3.5, invBodyY);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...TEXT_PRIMARY);
  doc.text(invoice.invoice_number, rightCardX + 16, invBodyY);

  invBodyY += 4.8;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...TEXT_MUTED);
  doc.text('Date:', rightCardX + 3.5, invBodyY);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...TEXT_PRIMARY);
  const formattedDate = invoice.created_at
    ? new Date(invoice.created_at).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    : 'N/A';
  doc.text(formattedDate, rightCardX + 16, invBodyY);

  invBodyY += 4.8;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...TEXT_MUTED);
  doc.text('Place of Supply:', rightCardX + 3.5, invBodyY);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...TEXT_PRIMARY);
  doc.text(cleanAscii(placeOfSupply), rightCardX + 28, invBodyY);

  currentY += cardHeight + 3.5;

  // ==========================================
  // 5. LINE ITEMS TABLE (Product Name - Variant Name)
  // ==========================================
  const tableItems = invoice.invoice_items || invoice.items || [];
  let totalPiecesCount = 0;
  let subtotalSum = 0;

  const tableHead = invoice.gst_applied
    ? [['#', 'Item Name', 'HSN / SAC', 'Quantity', 'Unit', 'Price / Unit (Rs.)', 'Amount (Rs.)']]
    : [['#', 'Item Name', 'Quantity', 'Unit', 'Price / Unit (Rs.)', 'Amount (Rs.)']];

  const tableBody = tableItems.map((item: any, index: number) => {
    const pName = item.variants?.products?.name || item.product_name || '';
    const vName = item.variants?.name || item.variant_name || item.name || '';
    
    // Format as Product Name - Variant Name (e.g. "5800 - 1-5" or "Shirt 015 - White")
    let itemName = 'Item';
    if (pName && vName && pName.trim().toLowerCase() !== vName.trim().toLowerCase()) {
      itemName = `${pName.trim()} - ${vName.trim()}`;
    } else {
      itemName = pName.trim() || vName.trim() || item.name || 'Item';
    }

    const hsn = item.variants?.products?.categories?.hsn_code || item.hsn_code || '6109';
    const unitPrice = Number(item.selling_price_snapshot ?? item.selling_price ?? item.price ?? 0);
    const qty = Number(item.quantity ?? item.total_pieces ?? ((Number(item.sets_quantity || 0) * Number(item.pieces_per_set || 1)) + Number(item.loose_quantity || 0)));
    const lineTotal = unitPrice * qty;

    totalPiecesCount += qty;
    subtotalSum += lineTotal;

    if (invoice.gst_applied) {
      return [
        (index + 1).toString(),
        itemName,
        hsn,
        qty.toString(),
        'Pcs',
        unitPrice.toFixed(2),
        lineTotal.toFixed(2),
      ];
    } else {
      return [
        (index + 1).toString(),
        itemName,
        qty.toString(),
        'Pcs',
        unitPrice.toFixed(2),
        lineTotal.toFixed(2),
      ];
    }
  });

  // Table summary row
  const tableFooter = invoice.gst_applied
    ? [['', 'Total', '', totalPiecesCount.toString(), '', '', subtotalSum.toFixed(2)]]
    : [['', 'Total', totalPiecesCount.toString(), '', '', subtotalSum.toFixed(2)]];

  autoTable(doc, {
    startY: currentY,
    head: tableHead,
    body: tableBody,
    foot: tableFooter,
    theme: 'grid',
    headStyles: {
      fillColor: BRAND_PRIMARY,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7.5,
      halign: 'center',
      cellPadding: 2.2,
    },
    footStyles: {
      fillColor: BRAND_DARK,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
      halign: 'right',
      cellPadding: 2.2,
    },
    columnStyles: invoice.gst_applied
      ? {
          0: { halign: 'center', cellWidth: 8 },
          1: { halign: 'left', cellWidth: 'auto' },
          2: { halign: 'center', cellWidth: 20 },
          3: { halign: 'center', cellWidth: 16 },
          4: { halign: 'center', cellWidth: 14 },
          5: { halign: 'right', cellWidth: 28 },
          6: { halign: 'right', cellWidth: 28 },
        }
      : {
          0: { halign: 'center', cellWidth: 8 },
          1: { halign: 'left', cellWidth: 'auto' },
          2: { halign: 'center', cellWidth: 20 },
          3: { halign: 'center', cellWidth: 16 },
          4: { halign: 'right', cellWidth: 32 },
          5: { halign: 'right', cellWidth: 32 },
        },
    bodyStyles: {
      textColor: TEXT_PRIMARY,
      fontSize: 7.5,
      cellPadding: 2,
    },
    alternateRowStyles: {
      fillColor: BG_LIGHT,
    },
    margin: { left: margin, right: margin, bottom: 25 },
  });

  currentY = (doc as any).lastAutoTable.finalY + 3.5;

  // ==========================================
  // 6. MID-BOTTOM SECTION: TAX SUMMARY & TOTALS
  // ==========================================
  const totalPaid = (invoice.payments || []).reduce((acc: number, p: any) => acc + (Number(p.amount) || 0), 0);
  const finalTotalNum = Number(invoice.final_total || 0);
  const totalRefunds = (invoice.returns || []).reduce((acc: number, r: any) => acc + (Number(r.total_refund_amount) || 0), 0);
  const returnedAmount = Number(invoice.returned_amount ?? invoice.total_refunds ?? totalRefunds ?? 0);
  const effectiveTotal = Math.max(0, finalTotalNum - returnedAmount);
  const discountNum = Number(invoice.discount_amount || 0);
  const balanceDue = invoice.is_voided ? 0 : Math.max(0, effectiveTotal - totalPaid);
  const youSaved = discountNum;

  const splitSectionWidth = (contentWidth - 4) / 2;
  const leftColX = margin;
  const rightColX = margin + splitSectionWidth + 4;

  // High 2: Page overflow check before rendering Section 6 (Totals & Tax Summary)
  // Dynamically calculate totals box height (accounts for returns deducted lines)
  const rightTotalsHeight = returnedAmount > 0 ? 62 : 52;
  const estimatedTaxHeight = invoice.gst_applied ? 46 : 38;
  const totalsBoxHeight = Math.max(rightTotalsHeight, estimatedTaxHeight);
  if (currentY + totalsBoxHeight > pageHeight - margin) {
    doc.addPage();
    currentY = margin;
  }

  const midSectionStartY = currentY;

  // 6A. LEFT COLUMN: TAX SUMMARY (When GST Enabled)
  if (invoice.gst_applied) {
    const hsnMap: Record<string, { taxable: number; cgst: number; sgst: number; totalTax: number }> = {};
    const discountRatio = subtotalSum > 0 ? Math.max(0, subtotalSum - discountNum) / subtotalSum : 1;

    tableItems.forEach((item: any) => {
      const hsn = item.variants?.products?.categories?.hsn_code || item.hsn_code || '6109';
      const rawSubtotal = Number(item.selling_price_snapshot ?? item.selling_price ?? item.price ?? 0) * Number(item.quantity ?? item.total_pieces ?? ((Number(item.sets_quantity || 0) * Number(item.pieces_per_set || 1)) + Number(item.loose_quantity || 0)));
      
      const itemSubtotal = rawSubtotal * discountRatio;
      const cgst = itemSubtotal * 0.025;
      const sgst = itemSubtotal * 0.025;
      const tax = cgst + sgst;

      if (!hsnMap[hsn]) {
        hsnMap[hsn] = { taxable: 0, cgst: 0, sgst: 0, totalTax: 0 };
      }
      hsnMap[hsn].taxable += itemSubtotal;
      hsnMap[hsn].cgst += cgst;
      hsnMap[hsn].sgst += sgst;
      hsnMap[hsn].totalTax += tax;
    });

    const taxHead = [['HSN / SAC', 'Taxable Amt', 'CGST %', 'CGST Rs', 'SGST %', 'SGST Rs', 'Total Tax']];
    let totalTaxableSum = 0;
    let totalCgstSum = 0;
    let totalSgstSum = 0;
    let totalTaxSum = 0;

    const taxBody = Object.keys(hsnMap).map((hsn) => {
      const row = hsnMap[hsn];
      totalTaxableSum += row.taxable;
      totalCgstSum += row.cgst;
      totalSgstSum += row.sgst;
      totalTaxSum += row.totalTax;

      return [
        hsn,
        row.taxable.toFixed(2),
        '2.5',
        row.cgst.toFixed(2),
        '2.5',
        row.sgst.toFixed(2),
        row.totalTax.toFixed(2),
      ];
    });

    const taxFoot = [[
      'TOTAL',
      totalTaxableSum.toFixed(2),
      '',
      totalCgstSum.toFixed(2),
      '',
      totalSgstSum.toFixed(2),
      totalTaxSum.toFixed(2),
    ]];

    // Tax Summary Header Bar
    doc.setFillColor(...BG_LIGHT);
    doc.setDrawColor(...BORDER_TERRACOTTA);
    doc.rect(leftColX, midSectionStartY, splitSectionWidth, 4, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...BRAND_PRIMARY);
    doc.text('TAX SUMMARY:', leftColX + 2, midSectionStartY + 3);

    autoTable(doc, {
      startY: midSectionStartY + 4,
      head: taxHead,
      body: taxBody,
      foot: taxFoot,
      theme: 'grid',
      headStyles: {
        fillColor: [240, 235, 230],
        textColor: BRAND_PRIMARY,
        fontStyle: 'bold',
        fontSize: 6.5,
        halign: 'center',
        cellPadding: 1.5,
      },
      footStyles: {
        fillColor: BRAND_PRIMARY,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 6.8,
        halign: 'right',
        cellPadding: 1.5,
      },
      columnStyles: {
        0: { halign: 'center', cellWidth: 14 },
        1: { halign: 'right', cellWidth: 15 },
        2: { halign: 'center', cellWidth: 10 },
        3: { halign: 'right', cellWidth: 13 },
        4: { halign: 'center', cellWidth: 10 },
        5: { halign: 'right', cellWidth: 13 },
        6: { halign: 'right', cellWidth: 14 },
      },
      bodyStyles: {
        textColor: TEXT_PRIMARY,
        fontSize: 6.5,
        cellPadding: 1.2,
      },
      margin: { left: leftColX, right: pageWidth - leftColX - splitSectionWidth },
    });
  } else {
    // Non-GST Clean Note Box
    doc.setFillColor(...BG_LIGHT);
    doc.setDrawColor(...BORDER_TERRACOTTA);
    doc.roundedRect(leftColX, midSectionStartY, splitSectionWidth, 38, 1.5, 1.5, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...BRAND_PRIMARY);
    doc.text('PAYMENT DETAILS:', leftColX + 3.5, midSectionStartY + 5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...TEXT_MUTED);
    const posPayments = (invoice.payments || []).filter((p: any) => Number(p.amount) > 0);
    const payStr = posPayments.length > 0
      ? posPayments.map((p: any) => `${p.method}: ${formatCurrency(p.amount)}`).join(' | ')
      : 'CASH SALE';
    doc.text(`Tender Mode: ${payStr}`, leftColX + 3.5, midSectionStartY + 10);
  }

  // 6B. RIGHT COLUMN: FINANCIAL TOTALS, WORDS, & RECEIVED
  doc.setFillColor(...BG_LIGHT);
  doc.setDrawColor(...BORDER_TERRACOTTA);
  doc.setLineWidth(0.3);
  doc.roundedRect(rightColX, midSectionStartY, splitSectionWidth, rightTotalsHeight, 1.5, 1.5, 'FD');

  let rY = midSectionStartY + 4.5;
  const printRightRow = (label: string, value: string, isBold: boolean = false, color: [number, number, number] = TEXT_PRIMARY) => {
    doc.setFont('helvetica', isBold ? 'bold' : 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(...TEXT_MUTED);
    doc.text(label, rightColX + 3.5, rY);
    doc.text(':', rightColX + splitSectionWidth - 32, rY);
    doc.setTextColor(...color);
    doc.setFont('helvetica', isBold ? 'bold' : 'normal');
    doc.text(value, rightColX + splitSectionWidth - 3.5, rY, { align: 'right' });
    rY += 3.8;
  };

  printRightRow('Sub Total', formatCurrency(invoice.subtotal));

  if (discountNum > 0) {
    const pct = invoice.subtotal ? ((discountNum / Number(invoice.subtotal)) * 100).toFixed(2) : '0';
    printRightRow(`Discount (${pct}%)`, formatCurrency(discountNum), false, DANGER_RED);
  }

  if (invoice.gst_applied) {
    const totalTaxAmt = Number(invoice.cgst_amount || 0) + Number(invoice.sgst_amount || 0);
    printRightRow('Tax (5.0%)', formatCurrency(totalTaxAmt));
  }

  if ((Number(invoice.round_off) || 0) !== 0) {
    const sign = Number(invoice.round_off) > 0 ? '+' : '';
    printRightRow('Round Off', `${sign}${formatCurrency(invoice.round_off)}`);
  }

  // Grand Total Highlight Bar
  doc.setFillColor(...BRAND_PRIMARY);
  doc.rect(rightColX, rY - 0.8, splitSectionWidth, 5.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  doc.text('Total', rightColX + 3.5, rY + 3);
  doc.text(':', rightColX + splitSectionWidth - 32, rY + 3);
  doc.text(formatCurrency(invoice.final_total), rightColX + splitSectionWidth - 3.5, rY + 3, { align: 'right' });
  rY += 7.5;

  // High 1: Returns Deducted & Net Payable Reconciliation
  if (returnedAmount > 0) {
    printRightRow('Returns Deducted', `-${formatCurrency(returnedAmount)}`, true, DANGER_RED);
    printRightRow('Net Payable', formatCurrency(effectiveTotal), true, BRAND_PRIMARY);
  }

  // Invoice Amount in Words
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.2);
  doc.setTextColor(...BRAND_PRIMARY);
  doc.text('INVOICE AMOUNT IN WORDS:', rightColX + 3.5, rY);
  rY += 3.2;

  const words = numberToIndianWords(returnedAmount > 0 ? effectiveTotal : invoice.final_total);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.2);
  doc.setTextColor(...TEXT_PRIMARY);
  const splitWords = doc.splitTextToSize(words, splitSectionWidth - 7);
  doc.text(splitWords, rightColX + 3.5, rY);
  rY += (splitWords.length * 3) + 2;

  // Payment Breakdown
  printRightRow('Received', formatCurrency(totalPaid), true, SUCCESS_GREEN);
  if (balanceDue > 0) {
    printRightRow('Balance', formatCurrency(balanceDue), true, DANGER_RED);
  }
  if (youSaved > 0) {
    printRightRow('You Saved', formatCurrency(youSaved), false, BRAND_PRIMARY);
  }

  currentY = Math.max(rY + 2, midSectionStartY + (invoice.gst_applied ? 42 : 38)) + 3.5;

  // ==========================================
  // 7. TERMS & CONDITIONS CARD
  // ==========================================
  const termsBoxHeight = 19;
  if (currentY + termsBoxHeight > pageHeight - 16) {
    doc.addPage();
    currentY = margin;
  }

  doc.setFillColor(...BG_LIGHT);
  doc.setDrawColor(...BORDER_TERRACOTTA);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, currentY, contentWidth, termsBoxHeight, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...BRAND_PRIMARY);
  doc.text(isProforma ? 'TERMS AND TRANSIT NOTES:' : 'TERMS AND CONDITIONS:', margin + 3.5, currentY + 3.8);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.2);
  doc.setTextColor(...TEXT_MUTED);
  if (isProforma) {
    doc.text('1. Road transit gate pass & proforma estimate for delivery van.', margin + 3.5, currentY + 7.5);
    doc.text('2. Goods entrusted to authorized linesman for field distribution.', margin + 3.5, currentY + 11);
    doc.text('3. Official tax invoice is issued upon customer delivery & payment confirmation.', margin + 3.5, currentY + 14.5);
    doc.text('4. Unsold goods are returned to warehouse inventory upon route completion.', margin + 3.5, currentY + 18);
  } else {
    doc.text('1. Returns will be accepted only in case of manufacturing defects.', margin + 3.5, currentY + 7.5);
    doc.text('2. Any return request must be reported within 7 days from the billing date.', margin + 3.5, currentY + 11);
    doc.text('3. Products must be returned with all original tags intact.', margin + 3.5, currentY + 14.5);
    doc.text('4. Returned products must be in fresh and unused condition.', margin + 3.5, currentY + 18);
  }

  currentY += termsBoxHeight + 3.5;

  // ==========================================
  // 8. ORNAMENTAL BOTTOM RIBBON
  // ==========================================
  const footerHeight = 8;
  const footerY = pageHeight - margin - footerHeight;

  doc.setFillColor(...BRAND_PRIMARY);
  doc.roundedRect(margin, footerY, contentWidth, footerHeight, 1.5, 1.5, 'F');

  doc.setFont('times', 'italic');
  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255);
  doc.text('Thank you for your business!', pageWidth / 2, footerY + 5.2, { align: 'center' });

  // ==========================================
  // 9. WATERMARKS ON ALL PAGES
  // ==========================================
  const totalPages = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    
    // Background watermark
    doc.saveGraphicsState();
    (doc as any).setGState(new (doc as any).GState({ opacity: 0.10 }));
    const wmWidth = 90;
    const wmHeight = 106;
    const wmX = (pageWidth - wmWidth) / 2;
    const wmY = (pageHeight - wmHeight) / 2 + 10;
    try {
      doc.addImage(BRAND_ASSETS.watermarkBase64, 'PNG', wmX, wmY, wmWidth, wmHeight);
    } catch (e) {
      console.error('Failed to render background watermark image:', e);
    }
    doc.restoreGraphicsState();

    // Diagonal Background Warning for Voided
    if (invoice.is_voided) {
      doc.saveGraphicsState();
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(55);
      doc.setTextColor(239, 68, 68);
      (doc as any).setGState(new (doc as any).GState({ opacity: 0.14 }));
      doc.text('VOIDED', pageWidth / 2, pageHeight / 2, {
        align: 'center',
        angle: 45,
      });
      doc.restoreGraphicsState();
    }
  }

  // ==========================================
  // 10. DISPATCH ACTION
  // ==========================================
  const outputFileName = options.fileName || `Invoice_${invoice.invoice_number.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;

  switch (options.action) {
    case 'open':
      doc.output('dataurlnewwindow');
      break;
    case 'blob':
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
