'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { 
  InvoiceLookupData, 
  ProcessReturnResult, 
  RecentReturnAuditItem, 
  ReturnActionResult 
} from '@/types/returns'

const processReturnSchema = z.object({
  invoice_item_id: z.string().uuid('Invalid invoice item identifier format'),
  sets_quantity: z.coerce.number().int().min(0, 'Sets cannot be negative').default(0),
  loose_quantity: z.coerce.number().int().min(0, 'Loose pieces cannot be negative').default(0),
  refund_method: z.enum(['CASH', 'UPI', 'STORE_CREDIT']),
  return_type: z.enum(['RESTOCK', 'DAMAGED']),
  notes: z
    .string()
    .trim()
    .max(500, 'Notes cannot exceed 500 characters')
    .optional()
    .nullable()
    .transform((val) => (val && val.length > 0 ? val : null))
}).refine(data => (data.sets_quantity > 0 || data.loose_quantity > 0), {
  message: "Total return quantity (sets or loose) must be at least 1"
});

export type ProcessReturnInput = z.infer<typeof processReturnSchema>;

/**
 * Searches and retrieves complete invoice metadata, snapshots, and prior return history
 */
export async function lookupInvoiceAction(
  invoiceNumber: string
): Promise<ReturnActionResult<InvoiceLookupData>> {
  try {
    const cleanNumber = invoiceNumber.trim();
    if (!cleanNumber) {
      return { success: false, error: 'Please enter a valid invoice number.' };
    }

    const supabase = createClient();
    const { data, error } = await supabase
      .from('invoices')
      .select(`
        id,
        invoice_number,
        customer_id,
        subtotal,
        discount_amount,
        round_off,
        gst_applied,
        cgst_amount,
        sgst_amount,
        final_total,
        is_voided,
        created_at,
        customers (id, name, phone, gstin, is_active),
        payments (
          amount,
          method
        ),
        invoice_items (
          id,
          variant_id,
          quantity,
          sets_quantity,
          loose_quantity,
          selling_price_snapshot,
          cost_price_snapshot,
          profit_snapshot,
          variants (
            id, 
            name, 
            barcode,
            pieces_per_set,
            products (id, name, pieces_per_set)
          ),
          returns (
            id,
            quantity,
            sets_quantity,
            loose_quantity,
            unit_refund_price,
            total_refund_amount,
            refund_method,
            return_type,
            notes,
            created_at
          )
        )
      `)
      .eq('invoice_number', cleanNumber.toUpperCase())
      .maybeSingle();

    if (error) {
      return { success: false, error: error.message };
    }

    if (!data) {
      return { success: false, error: `No invoice found matching "${cleanNumber}".` };
    }

    const totalPaid = (data.payments || []).reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0);
    const totalRefunds = (data.invoice_items || []).reduce((sum: number, item: any) => 
      sum + (item.returns || []).reduce((rSum: number, r: any) => rSum + Number(r.total_refund_amount || 0), 0), 0);
    const effectiveTotal = Math.max(0, Number(data.final_total || 0) - totalRefunds);
    const dueAmount = Math.max(0, effectiveTotal - totalPaid);

    return { 
      success: true, 
      data: {
        ...data,
        total_paid: totalPaid,
        due_amount: dueAmount
      } as unknown as InvoiceLookupData 
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unexpected error during invoice lookup.';
    return { success: false, error: message };
  }
}

/**
 * Executes atomic return RPC: updates inventory, records outbound refund payment, and logs return audit
 */
export async function processReturnAction(
  payload: unknown
): Promise<ReturnActionResult<ProcessReturnResult>> {
  try {
    const parsed = processReturnSchema.safeParse(payload);
    if (!parsed.success) {
      const errorMsg = parsed.error.issues.map((i) => i.message).join('. ');
      return { success: false, error: errorMsg };
    }

    const supabase = createClient();
    const { data, error } = await supabase.rpc('process_return', {
      p_invoice_item_id: parsed.data.invoice_item_id,
      p_sets_quantity: parsed.data.sets_quantity,
      p_loose_quantity: parsed.data.loose_quantity,
      p_refund_method: parsed.data.refund_method,
      p_return_type: parsed.data.return_type,
      p_notes: parsed.data.notes || null
    });

    if (error) {
      return { success: false, error: error.message };
    }

    // Comprehensive route cache purge
    revalidatePath('/returns');
    revalidatePath('/invoices');
    revalidatePath('/inventory/products');
    revalidatePath('/inventory/ledger');
    revalidatePath('/pos');
    revalidatePath('/dashboard');
    revalidatePath('/reports');
    revalidatePath('/');

    return { success: true, data: data as ProcessReturnResult };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unexpected error during return processing.';
    return { success: false, error: message };
  }
}

/**
 * Fetches recent returns for the returns audit ledger
 */
export async function getRecentReturnsAction(
  limit: number = 50
): Promise<ReturnActionResult<RecentReturnAuditItem[]>> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('returns')
      .select(`
        id,
        invoice_id,
        quantity,
        sets_quantity,
        loose_quantity,
        unit_refund_price,
        total_refund_amount,
        refund_method,
        return_type,
        notes,
        created_at,
        invoices (id, invoice_number),
        variants (
          name, 
          barcode,
            pieces_per_set,
          products (name, pieces_per_set)
        ),
        customers (name)
      `)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: (data as unknown as RecentReturnAuditItem[]) || [] };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch returns history.';
    return { success: false, error: message };
  }
}
