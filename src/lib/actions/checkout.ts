'use server'

import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const round2 = (num: number): number => Math.round((num + Number.EPSILON) * 100) / 100;

const checkoutItemSchema = z.object({
  variant_id: z.string().uuid('Invalid variant ID'),
  sets_quantity: z.number().int().min(0).default(0),
  loose_quantity: z.number().int().min(0).default(0),
  selling_price_snapshot: z.coerce.number().min(0, 'Selling price cannot be negative')
});

const paymentItemSchema = z.object({
  amount: z.coerce.number().positive('Payment amount must be greater than 0'),
  method: z.enum(['CASH', 'UPI', 'STORE_CREDIT'])
});

const baseCheckoutObjectSchema = z.object({
  customer_id: z
    .preprocess((val) => (val === '' || val === undefined ? null : val), z.string().uuid().nullable().optional())
    .default(null),
  subtotal: z.coerce.number().min(0),
  discount_amount: z.coerce.number().min(0).default(0),
  round_off: z.coerce.number().min(-50, 'Round-off cannot be less than -50').max(50, 'Round-off cannot exceed 50').default(0),
  gst_applied: z.boolean().default(false),
  cgst_amount: z.coerce.number().min(0).default(0),
  sgst_amount: z.coerce.number().min(0).default(0),
  final_total: z.coerce.number().min(0),
  items: z.array(checkoutItemSchema).min(1, 'Cart cannot be empty'),
  payments: z.array(paymentItemSchema).default([]),
  created_at: z.string().datetime({ offset: true }).optional().nullable()
});

const refineCheckoutData = (data: z.infer<typeof baseCheckoutObjectSchema>, ctx: z.RefinementCtx) => {
  // 1. Prevent discount > subtotal
  if (data.discount_amount > data.subtotal) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Discount amount cannot exceed subtotal.',
      path: ['discount_amount']
    });
  }

  // 2. Validate Taxes and Final Total Mathematical Integrity
  const preGst = Math.max(0, round2(data.subtotal - data.discount_amount));
  const expectedCgst = data.gst_applied ? round2(preGst * 0.025) : 0;
  const expectedSgst = data.gst_applied ? round2(preGst * 0.025) : 0;
  const calcFinal = round2(preGst + expectedCgst + expectedSgst + data.round_off);

  if (calcFinal < 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Round-off cannot reduce invoice total below zero.',
      path: ['round_off']
    });
  }

  if (Math.abs(data.final_total - calcFinal) > 0.05) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Final total (₹${data.final_total}) does not match computed total (₹${calcFinal}).`,
      path: ['final_total']
    });
  }

  // 3. Prevent duplicate variant IDs in payload
  const variantIds = new Set<string>();
  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i];
    if (variantIds.has(item.variant_id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate variant ID "${item.variant_id}" detected. Items must be consolidated.`,
        path: ['items', i, 'variant_id']
      });
    }
    variantIds.add(item.variant_id);
  }

  // 4. Anonymous Walk-in Customer Credit Protection
  const totalPaid = round2(data.payments.reduce((acc, p) => acc + p.amount, 0));
  if (totalPaid < round2(data.final_total) && !data.customer_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Anonymous walk-in customer cannot have an unpaid credit balance.',
      path: ['customer_id']
    });
  }

  // 5. Overpayment Guard
  if (totalPaid > round2(data.final_total)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Total payment (₹${totalPaid.toFixed(2)}) cannot exceed final invoice total (₹${data.final_total.toFixed(2)}).`,
      path: ['payments']
    });
  }
};

export const checkoutSchema = baseCheckoutObjectSchema.superRefine(refineCheckoutData);

export type CheckoutInput = z.input<typeof checkoutSchema>;

function formatHumanReadableError(errorMsg: string): string {
  const clean = errorMsg.toLowerCase();
  
  if (clean.includes('unauthorized') || clean.includes('jwt') || clean.includes('auth.uid')) {
    return 'Your login session has expired. Please log out and sign in again.';
  }
  if (clean.includes('insufficient stock') || clean.includes('packaged sets')) {
    return 'One or more items in the cart exceed available inventory on hand.';
  }
  if (clean.includes('store credit') || clean.includes('wallet')) {
    return `Store credit error: ${errorMsg}`;
  }
  if (clean.includes('customer is required') || clean.includes('walk-in')) {
    return 'A customer must be linked to complete a credit or partial-payment sale.';
  }
  if (clean.includes('duplicate key') || clean.includes('unique constraint')) {
    return 'A record with this number already exists. Please try again.';
  }
  if (clean.includes('foreign key') || clean.includes('not found')) {
    return 'Selected product variant or customer could not be found. Please refresh the page.';
  }
  if (clean.includes('cannot be edited') || clean.includes('existing return')) {
    return 'This invoice has processed customer returns and cannot be edited directly.';
  }
  if (clean.includes('voided') || clean.includes('is_voided')) {
    return 'This invoice is voided. You must undo the void before making changes.';
  }

  return errorMsg;
}

export async function processCheckoutAction(payload: unknown) {
  try {
    const parsed = checkoutSchema.safeParse(payload);
    if (!parsed.success) {
      const errorMsg = parsed.error.issues.map((i) => i.message).join('. ');
      return { success: false, error: errorMsg };
    }

    const supabase = createClient();
    const { data, error } = await supabase.rpc('process_checkout', {
      p_customer_id: parsed.data.customer_id,
      p_subtotal: round2(parsed.data.subtotal),
      p_discount_amount: round2(parsed.data.discount_amount),
      p_round_off: round2(parsed.data.round_off),
      p_gst_applied: parsed.data.gst_applied,
      p_cgst_amount: round2(parsed.data.cgst_amount),
      p_sgst_amount: round2(parsed.data.sgst_amount),
      p_final_total: round2(parsed.data.final_total),
      p_items: parsed.data.items.map((i) => ({
        variant_id: i.variant_id,
        sets_quantity: i.sets_quantity,
        loose_quantity: i.loose_quantity,
        selling_price: round2(i.selling_price_snapshot)
      })),
      p_payments: parsed.data.payments.map((p) => ({
        amount: round2(p.amount),
        method: p.method
      })),
      p_created_at: parsed.data.created_at || null
    });

    if (error) {
      return { success: false, error: formatHumanReadableError(error.message) };
    }

    if (!data || !data.invoice_id) {
      return { success: false, error: 'Failed to create invoice record in database.' };
    }

    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: formatHumanReadableError(err?.message || 'An unexpected error occurred during checkout') };
  }
}

const updateFullInvoiceSchema = baseCheckoutObjectSchema.extend({
  invoice_id: z.string().uuid('Invalid invoice ID')
}).superRefine(refineCheckoutData);

export type UpdateFullInvoiceInput = z.input<typeof updateFullInvoiceSchema>;

export async function updateFullInvoiceAction(payload: unknown) {
  try {
    const parsed = updateFullInvoiceSchema.safeParse(payload);
    if (!parsed.success) {
      const errorMsg = parsed.error.issues.map((i) => i.message).join('. ');
      return { success: false, error: errorMsg };
    }

    const supabase = createClient();
    const { data, error } = await supabase.rpc('update_full_invoice', {
      p_invoice_id: parsed.data.invoice_id,
      p_customer_id: parsed.data.customer_id,
      p_created_at: parsed.data.created_at || null,
      p_subtotal: round2(parsed.data.subtotal),
      p_discount_amount: round2(parsed.data.discount_amount),
      p_round_off: round2(parsed.data.round_off),
      p_gst_applied: parsed.data.gst_applied,
      p_cgst_amount: round2(parsed.data.cgst_amount),
      p_sgst_amount: round2(parsed.data.sgst_amount),
      p_final_total: round2(parsed.data.final_total),
      p_items: parsed.data.items.map((i) => ({
        variant_id: i.variant_id,
        sets_quantity: i.sets_quantity,
        loose_quantity: i.loose_quantity,
        selling_price: round2(i.selling_price_snapshot)
      })),
      p_payments: parsed.data.payments.map((p) => ({
        amount: round2(p.amount),
        method: p.method
      }))
    });

    if (error) {
      return { success: false, error: formatHumanReadableError(error.message) };
    }

    if (!data || !data.invoice_id) {
      return { success: false, error: 'Failed to update invoice record in database.' };
    }

    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: formatHumanReadableError(err?.message || 'An unexpected error occurred while updating invoice') };
  }
}
