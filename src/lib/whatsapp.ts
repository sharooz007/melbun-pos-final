import { formatINR } from './formatters';

export const DEFAULT_WHATSAPP_INVOICE_TEMPLATE = `Hello {customer_name},

Thank you for your purchase at *{store_name}*!

📄 *Invoice Details*
• *Invoice #:* {invoice_number}
• *Date:* {date}
• *Items:* {item_count}
• *Total Amount:* {total_amount}
• *Paid Amount:* {paid_amount}
• *Payment Status:* {status}

Thank you for shopping with us! Please visit us again.`;

export const DEFAULT_WHATSAPP_DUE_REMINDER_TEMPLATE = `Hello {customer_name},

This is a gentle payment reminder from *{store_name}* regarding *Invoice #{invoice_number}*.

💰 *Payment Due Summary*
• *Invoice #:* {invoice_number}
• *Invoice Date:* {date}
• *Total Amount:* {total_amount}
• *Amount Paid:* {paid_amount}
• *Pending Due Balance:* *{due_amount}*

Please settle the pending balance at your earliest convenience.

Thank you,
*{store_name}*`;

export interface WhatsAppTemplateData {
  customer_name?: string | null;
  customer_phone?: string | null;
  store_name?: string | null;
  store_phone?: string | null;
  store_address?: string | null;
  invoice_number?: string | null;
  date?: string | null;
  item_count?: string | number | null;
  total_amount?: number | string | null;
  paid_amount?: number | string | null;
  due_amount?: number | string | null;
  status?: string | null;
}

/**
 * Normalizes phone numbers for WhatsApp wa.me links:
 * - Strips non-digits
 * - Strips leading '+' and '0'
 * - Converts 10-digit Indian numbers to '91<number>'
 * - Preserves valid international numbers (10-15 digits)
 */
export function cleanWhatsAppPhone(phone?: string | null): string | null {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (!digits) return null;

  // If 10 digits (Standard Indian Mobile), prepend 91
  if (digits.length === 10) {
    return `91${digits}`;
  }
  // If 11 digits starting with 0, replace 0 with 91
  if (digits.length === 11 && digits.startsWith('0')) {
    return `91${digits.slice(1)}`;
  }
  // If 12 digits starting with 91, or valid international number (11-15 digits)
  if (digits.length >= 10 && digits.length <= 15) {
    return digits;
  }
  return null;
}

/**
 * Replaces template placeholders with sanitized data
 */
export function formatWhatsAppMessage(template: string, data: WhatsAppTemplateData): string {
  const customerName = data.customer_name?.trim() || 'Valued Customer';
  const storeName = data.store_name?.trim() || 'Melbun Wholesale';
  const invoiceNum = data.invoice_number?.trim() || 'N/A';
  const dateStr = data.date?.trim() || new Date().toLocaleDateString('en-IN', { dateStyle: 'medium' });
  const totalAmt = typeof data.total_amount === 'number' ? formatINR(data.total_amount) : (data.total_amount || '₹0.00');
  const paidAmt = typeof data.paid_amount === 'number' ? formatINR(data.paid_amount) : (data.paid_amount || '₹0.00');
  const dueAmt = typeof data.due_amount === 'number' ? formatINR(data.due_amount) : (data.due_amount || '₹0.00');
  const statusStr = data.status?.trim() || 'Paid';
  const itemCountStr = data.item_count !== undefined && data.item_count !== null ? `${data.item_count} item(s)` : '1 item';
  const customerPhone = data.customer_phone?.trim() || '';
  const storePhone = data.store_phone?.trim() || '';
  const storeAddress = data.store_address?.trim() || '';

  return (template || DEFAULT_WHATSAPP_INVOICE_TEMPLATE)
    .replace(/\{customer_name\}/g, customerName)
    .replace(/\{customer_phone\}/g, customerPhone)
    .replace(/\{store_name\}/g, storeName)
    .replace(/\{invoice_number\}/g, invoiceNum)
    .replace(/\{date\}/g, dateStr)
    .replace(/\{total_amount\}/g, totalAmt)
    .replace(/\{paid_amount\}/g, paidAmt)
    .replace(/\{due_amount\}/g, dueAmt)
    .replace(/\{status\}/g, statusStr)
    .replace(/\{item_count\}/g, itemCountStr)
    .replace(/\{store_phone\}/g, storePhone)
    .replace(/\{store_address\}/g, storeAddress);
}

/**
 * Generates direct wa.me WhatsApp URL
 */
export function getWhatsAppUrl(phone: string | null | undefined, message: string): string {
  const cleanPhone = cleanWhatsAppPhone(phone);
  const encodedText = encodeURIComponent(message);
  if (cleanPhone) {
    return `https://wa.me/${cleanPhone}?text=${encodedText}`;
  }
  return `https://wa.me/?text=${encodedText}`;
}

/**
 * Opens WhatsApp chat in a new tab
 */
export function openWhatsAppChat({ phone, message }: { phone?: string | null; message: string }) {
  const url = getWhatsAppUrl(phone, message);
  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
