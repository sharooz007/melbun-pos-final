/**
 * Universal Formatter Utilities for MelbunPOS
 */

/**
 * Universal INR Currency Formatter
 */
export const formatINR = (amount: number | string | null | undefined): string => {
  const num = typeof amount === 'number' ? amount : parseFloat(String(amount ?? 0));
  const safeNum = isNaN(num) ? 0 : num;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(safeNum);
};

export interface FormatDualQuantityOptions {
  /** Include total pieces in parentheses, e.g. " (46 pcs)". Default: true */
  showTotalInParens?: boolean;
  /** Explicitly prefix '+' for positive numbers. Default: false */
  showSign?: boolean;
  /** Custom label when quantity is 0. Default: '0 pcs' */
  zeroLabel?: string;
}

/**
 * Universal Dual-Inventory ("Sets + Pieces") Formatter
 * 
 * Formats inventory quantities prioritizing Sets as primary, with loose pieces.
 * Examples:
 * - formatDualQuantity(46, 5) -> "9 sets + 1 pc (46 pcs)"
 * - formatDualQuantity(46, 5, { showTotalInParens: false }) -> "9 sets + 1 pc"
 * - formatDualQuantity(20, 4) -> "5 sets (20 pcs)"
 * - formatDualQuantity(3, 4) -> "3 pcs"
 * - formatDualQuantity(0, 4) -> "0 pcs"
 * - formatDualQuantity(46, 1) -> "46 pcs"
 * - formatDualQuantity(-9, 4, { showSign: true }) -> "-2 sets + 1 pc (-9 pcs)"
 */
export function formatDualQuantity(
  totalPieces: number | string | null | undefined,
  piecesPerSet: number | string | null | undefined = 1,
  options?: FormatDualQuantityOptions
): string {
  const num = typeof totalPieces === 'number' ? totalPieces : parseFloat(String(totalPieces ?? 0));
  const safeTotal = isNaN(num) ? 0 : Math.round(num);

  if (safeTotal === 0) {
    return options?.zeroLabel ?? '0 pcs';
  }

  const ppsNum = typeof piecesPerSet === 'number' ? piecesPerSet : parseFloat(String(piecesPerSet ?? 1));
  const safePps = isNaN(ppsNum) || ppsNum < 1 ? 1 : Math.floor(ppsNum);

  const isNegative = safeTotal < 0;
  const absTotal = Math.abs(safeTotal);
  const signPrefix = isNegative ? '-' : (options?.showSign && safeTotal > 0 ? '+' : '');

  // Case 1: Single item product (no set concept)
  if (safePps <= 1) {
    return `${signPrefix}${absTotal} ${absTotal === 1 ? 'pc' : 'pcs'}`;
  }

  const sets = Math.floor(absTotal / safePps);
  const loose = absTotal % safePps;

  // Case 2: Only loose pieces (sets === 0)
  if (sets === 0) {
    return `${signPrefix}${loose} ${loose === 1 ? 'pc' : 'pcs'}`;
  }

  const setLabel = `${sets} ${sets === 1 ? 'set' : 'sets'}`;
  const looseLabel = loose > 0 ? ` + ${loose} ${loose === 1 ? 'pc' : 'pcs'}` : '';
  const primary = `${setLabel}${looseLabel}`;

  if (options?.showTotalInParens === false) {
    return `${signPrefix}${primary}`;
  }

  return `${signPrefix}${primary} (${signPrefix}${absTotal} ${absTotal === 1 ? 'pc' : 'pcs'})`;
}
