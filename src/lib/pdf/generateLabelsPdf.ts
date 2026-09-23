import jsPDF from 'jspdf';
import { LabelVariantItem, LabelConfig, LabelLayoutMode, SHEET_COLUMN_PRESETS } from '@/types/labels';

// Code 128 Pattern Table (Symbols 0 to 106)
const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112"
];

const START_B = 104;
const STOP = 106;

function encodeCode128B(value: string): { bars: { x: number; width: number }[]; totalWidth: number } | null {
  const trimmed = (value || '').trim();
  if (!trimmed || /[^\x20-\x7E]/.test(trimmed)) {
    return null;
  }

  const codes: number[] = [START_B];
  let checksum = START_B;

  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i) - 32;
    codes.push(code);
    checksum += (i + 1) * code;
  }

  codes.push(checksum % 103);
  codes.push(STOP);

  let currentX = 0;
  const bars: { x: number; width: number }[] = [];

  for (const code of codes) {
    const pattern = CODE128_PATTERNS[code];
    if (!pattern) continue;

    for (let p = 0; p < pattern.length; p++) {
      const moduleWidth = parseInt(pattern[p], 10);
      const isBar = p % 2 === 0;
      if (isBar) {
        bars.push({ x: currentX, width: moduleWidth });
      }
      currentX += moduleWidth;
    }
  }

  return { bars, totalWidth: currentX };
}

const formatINR = (amount: number | string | null | undefined) => {
  const num = typeof amount === 'number' ? amount : parseFloat(String(amount || 0));
  const safeNum = isNaN(num) ? 0 : num;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(safeNum);
};

export function generateLabelsPDF(
  labels: LabelVariantItem[],
  config: LabelConfig,
  storeName: string = 'MELBUN',
  layoutMode: LabelLayoutMode = 'a4-sheet'
): jsPDF {
  if (layoutMode === 'thermal-1col') {
    // 50mm x 30mm single label roll
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: [50, 30]
    });

    labels.forEach((label, idx) => {
      if (idx > 0) doc.addPage([50, 30], 'portrait');
      drawSingleLabel(doc, label, config, storeName, 0, 0, 50, 30);
    });

    return doc;
  }

  if (layoutMode === 'thermal-2col') {
    // 100mm x 30mm two-label roll
    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: [30, 100]
    });

    for (let i = 0; i < labels.length; i += 2) {
      if (i > 0) doc.addPage([30, 100], 'landscape');
      const label1 = labels[i];
      const label2 = labels[i + 1];

      drawSingleLabel(doc, label1, config, storeName, 1, 0, 48, 30);
      if (label2) {
        drawSingleLabel(doc, label2, config, storeName, 51, 0, 48, 30);
      }
    }

    return doc;
  }

  // A4 Sheet Mode (Multi-page with dynamic columns)
  const columns = config.columns && SHEET_COLUMN_PRESETS[config.columns] ? config.columns : 3;
  const preset = SHEET_COLUMN_PRESETS[columns];

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = 210;
  const pageHeight = 297;

  const totalGridWidth = preset.columns * preset.colWidthMm + (preset.columns - 1) * preset.colGapMm;
  const totalGridHeight = preset.rows * preset.rowHeightMm + (preset.rows - 1) * preset.rowGapMm;

  const marginX = Math.max(5, (pageWidth - totalGridWidth) / 2);
  const marginY = Math.max(6, (pageHeight - totalGridHeight) / 2);

  labels.forEach((label, idx) => {
    const pageIndex = Math.floor(idx / preset.labelsPerPage);
    const itemInPage = idx % preset.labelsPerPage;

    if (idx > 0 && itemInPage === 0) {
      doc.addPage('a4', 'portrait');
    }

    const col = itemInPage % preset.columns;
    const row = Math.floor(itemInPage / preset.columns);

    const x = marginX + col * (preset.colWidthMm + preset.colGapMm);
    const y = marginY + row * (preset.rowHeightMm + preset.rowGapMm);

    drawSingleLabel(doc, label, config, storeName, x, y, preset.colWidthMm, preset.rowHeightMm);
  });

  return doc;
}

function drawSingleLabel(
  doc: jsPDF,
  label: LabelVariantItem,
  config: LabelConfig,
  storeName: string,
  x: number,
  y: number,
  width: number,
  height: number
) {
  // Border (subtle cutting guideline)
  doc.setDrawColor(215, 215, 215);
  doc.setLineWidth(0.15);
  doc.roundedRect(x, y, width, height, 1, 1, 'S');

  let currentY = y + 2.8;
  const centerX = x + width / 2;
  const maxTextWidth = width - 4;

  // 1. Store Header
  if (config.showStoreName) {
    const headerText = ((config.customHeader || '').trim() || storeName || 'MELBUN').toUpperCase();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(width < 40 ? 5.5 : 6.5);
    doc.setTextColor(50, 50, 50);
    const text = doc.splitTextToSize(headerText, maxTextWidth)[0] || headerText;
    doc.text(text, centerX, currentY, { align: 'center' });
    currentY += width < 40 ? 2.5 : 3.0;
  }

  // 2. Product Name
  if (config.showProductName) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(width < 40 ? 6.5 : 7.5);
    doc.setTextColor(0, 0, 0);
    const productName = label.product_name || 'Product';
    const text = doc.splitTextToSize(productName, maxTextWidth)[0] || productName;
    doc.text(text, centerX, currentY, { align: 'center' });
    currentY += width < 40 ? 2.5 : 3.0;
  }

  // 3. Variant / Size Name
  if (config.showVariantName && label.variant_name) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(width < 40 ? 5.5 : 6.5);
    doc.setTextColor(70, 70, 70);
    const text = doc.splitTextToSize(label.variant_name, maxTextWidth)[0] || label.variant_name;
    doc.text(text, centerX, currentY, { align: 'center' });
    currentY += width < 40 ? 2.4 : 2.8;
  }

  // 4. Code 128 Barcode (Vector Rendered)
  const encoded = encodeCode128B(label.barcode);
  if (encoded && encoded.bars.length > 0) {
    // Dynamic barcode height based on available label height
    const availableBarHeight = Math.max(5, Math.min(10, (height - (currentY - y) - 6)));
    const targetBarWidthMm = Math.min(0.35, (width - 6) / encoded.totalWidth);
    const totalRenderWidth = encoded.totalWidth * targetBarWidthMm;
    const barcodeStartX = centerX - totalRenderWidth / 2;

    doc.setFillColor(0, 0, 0);
    encoded.bars.forEach((bar) => {
      doc.rect(
        barcodeStartX + bar.x * targetBarWidthMm,
        currentY,
        bar.width * targetBarWidthMm,
        availableBarHeight,
        'F'
      );
    });

    currentY += availableBarHeight + 1.2;

    // Barcode Text underneath
    if (config.showBarcodeText) {
      doc.setFont('courier', 'bold');
      doc.setFontSize(width < 40 ? 5.5 : 6.5);
      doc.setTextColor(0, 0, 0);
      doc.text(label.barcode, centerX, currentY, { align: 'center' });
      currentY += width < 40 ? 2.2 : 2.6;
    }
  } else {
    // Fallback if no barcode or invalid
    doc.setFont('courier', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(150, 150, 150);
    doc.text(label.barcode || 'NO BARCODE', centerX, currentY + 3, { align: 'center' });
    currentY += 5;
  }

  // 5. Price & Pack Size
  if (config.showPrice || config.showPackSize) {
    let priceLine = '';
    if (config.showPrice) {
      priceLine += `MRP: ${formatINR(label.selling_price)}`;
    }
    if (config.showPackSize && label.pieces_per_set > 1) {
      priceLine += ` (Pack of ${label.pieces_per_set})`;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(width < 40 ? 6.5 : 8.0);
    doc.setTextColor(0, 0, 0);
    doc.text(priceLine, centerX, currentY, { align: 'center' });
  }
}
