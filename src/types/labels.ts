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
}
