export type LabelLayoutMode = 'thermal-1col' | 'thermal-2col' | 'a4-sheet';

export interface LabelVariantItem {
  variant_id: string;
  product_id: string;
  product_name: string;
  variant_name: string;
  barcode: string;
  selling_price: number;
  cost_price: number;
  stock_quantity: number;
  pieces_per_set: number;
}

export interface PrintQueueItem {
  variant: LabelVariantItem;
  quantity: number;
}

export interface LabelConfig {
  showStoreName: boolean;
  showProductName: boolean;
  showVariantName: boolean;
  showPrice: boolean;
  showPackSize?: boolean;
  showBarcodeText: boolean;
  barcodeHeight: number; // in pixels (24 to 48)
  customHeader: string;
  columns?: number; // 1 to 5 columns for sheet layout
}

export interface SheetGridConfig {
  columns: number;
  rows: number;
  labelsPerPage: number;
  colWidthMm: number;
  rowHeightMm: number;
  colGapMm: number;
  rowGapMm: number;
  label: string;
}

export const SHEET_COLUMN_PRESETS: Record<number, SheetGridConfig> = {
  1: { columns: 1, rows: 7, labelsPerPage: 7, colWidthMm: 120, rowHeightMm: 36, colGapMm: 0, rowGapMm: 3, label: '1 Column (7-up Large)' },
  2: { columns: 2, rows: 7, labelsPerPage: 14, colWidthMm: 92, rowHeightMm: 36, colGapMm: 6, rowGapMm: 3, label: '2 Columns (14-up)' },
  3: { columns: 3, rows: 8, labelsPerPage: 24, colWidthMm: 60, rowHeightMm: 30, colGapMm: 5, rowGapMm: 2.5, label: '3 Columns (24-up Standard)' },
  4: { columns: 4, rows: 10, labelsPerPage: 40, colWidthMm: 45, rowHeightMm: 25, colGapMm: 3.3, rowGapMm: 2, label: '4 Columns (40-up Compact)' },
  5: { columns: 5, rows: 12, labelsPerPage: 60, colWidthMm: 36, rowHeightMm: 21, colGapMm: 2.5, rowGapMm: 1.5, label: '5 Columns (60-up Mini)' },
};
