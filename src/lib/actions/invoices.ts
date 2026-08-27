'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

const voidInvoiceSchema = z.object({
  invoice_id: z.string().uuid('Invalid invoice ID format'),
  reason: z
    .string()
    .trim()
    .max(500, 'Reason cannot exceed 500 characters')
    .optional()
    .default('Voided by user')
});

const undoVoidInvoiceSchema = z.object({
  invoice_id: z.string().uuid('Invalid invoice ID format')
});

const permanentlyDeleteInvoiceSchema = z.object({
  invoice_id: z.string().uuid('Invalid invoice ID format')
});

const updateInvoiceDetailsSchema = z.object({
  invoice_id: z.string().uuid('Invalid invoice ID format'),
  created_at: z.string().datetime({ offset: true, message: 'Invalid datetime format' }).optional().nullable(),
  customer_id: z.string().uuid('Invalid customer ID format').nullable().optional()
});

export type VoidInvoiceInput = z.infer<typeof voidInvoiceSchema>;

export async function voidInvoiceAction(payload: unknown) {
  try {
    const parsed = voidInvoiceSchema.safeParse(payload);
    if (!parsed.success) {
      const errorMsg = parsed.error.issues.map((i) => i.message).join('. ');
      return { success: false, error: errorMsg };
    }

    const supabase = createClient();
    const { data, error } = await supabase.rpc('void_invoice', {
      p_invoice_id: parsed.data.invoice_id,
      p_reason: parsed.data.reason
    });

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath('/invoices');
    revalidatePath('/inventory');
    revalidatePath('/dashboard');
    revalidatePath('/reports');
    revalidatePath('/customers');
    revalidatePath('/pos');
    revalidatePath('/');

    return { success: true, data };
  } catch (err: any) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'An unexpected error occurred while voiding the invoice'
    };
  }
}

export async function undoVoidInvoiceAction(payload: unknown) {
  try {
    const parsed = undoVoidInvoiceSchema.safeParse(payload);
    if (!parsed.success) {
      const errorMsg = parsed.error.issues.map((i) => i.message).join('. ');
      return { success: false, error: errorMsg };
    }

    const supabase = createClient();
    const { data, error } = await supabase.rpc('undo_void_invoice', {
      p_invoice_id: parsed.data.invoice_id
    });

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath('/invoices');
    revalidatePath('/inventory');
    revalidatePath('/dashboard');
    revalidatePath('/reports');
    revalidatePath('/customers');
    revalidatePath('/pos');
    revalidatePath('/');

    return { success: true, data };
  } catch (err: any) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'An unexpected error occurred while un-voiding the invoice'
    };
  }
}

export async function permanentlyDeleteInvoiceAction(payload: unknown) {
  try {
    const parsed = permanentlyDeleteInvoiceSchema.safeParse(payload);
    if (!parsed.success) {
      const errorMsg = parsed.error.issues.map((i) => i.message).join('. ');
      return { success: false, error: errorMsg };
    }

    const supabase = createClient();
    const { data, error } = await supabase.rpc('permanently_delete_invoice', {
      p_invoice_id: parsed.data.invoice_id
    });

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath('/invoices');
    revalidatePath('/dashboard');
    revalidatePath('/reports');
    revalidatePath('/customers');
    revalidatePath('/pos');
    revalidatePath('/');

    return { success: true, data };
  } catch (err: any) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'An unexpected error occurred while deleting the invoice'
    };
  }
}

export async function updateInvoiceDetailsAction(payload: unknown) {
  try {
    const parsed = updateInvoiceDetailsSchema.safeParse(payload);
    if (!parsed.success) {
      const errorMsg = parsed.error.issues.map((i) => i.message).join('. ');
      return { success: false, error: errorMsg };
    }

    const supabase = createClient();
    const { data, error } = await supabase.rpc('update_invoice_details', {
      p_invoice_id: parsed.data.invoice_id,
      p_created_at: parsed.data.created_at || null,
      p_customer_id: parsed.data.customer_id !== undefined ? parsed.data.customer_id : null,
      p_update_customer: parsed.data.customer_id !== undefined
    });

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath('/invoices');
    revalidatePath('/dashboard');
    revalidatePath('/reports');
    revalidatePath('/customers');
    revalidatePath('/pos');
    revalidatePath('/');

    return { success: true, data };
  } catch (err: any) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'An unexpected error occurred while updating the invoice'
    };
  }
}

export async function getAllInvoicesAction(limit?: number) {
  const supabase = createClient();
  let query = supabase
    .from('invoices')
    .select(`
      id,
      invoice_number,
      final_total,
      is_voided,
      created_at,
      customers ( name )
    `)
    .eq('is_hidden', false)
    .order('created_at', { ascending: false });

  if (limit) {
    query = query.limit(limit);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching invoices:', error);
    return [];
  }

  return data.map((inv: any) => ({
    id: inv.id,
    invoice_number: inv.invoice_number,
    customer_name: inv.customers?.name || undefined,
    total_amount: inv.final_total,
    is_voided: inv.is_voided,
    created_at: inv.created_at
  }));
}

export async function getInvoicesPagedAction(params?: {
  query?: string;
  page?: number;
  pageSize?: number;
}) {
  try {
    const supabase = createClient();
    const page = Math.max(1, params?.page || 1);
    const pageSize = Math.max(1, Math.min(100, params?.pageSize || 25));
    const offset = (page - 1) * pageSize;
    const cleanQ = (params?.query || '').trim();

    let queryBuilder = supabase
      .from('invoices')
      .select(`
        id,
        invoice_number,
        final_total,
        is_voided,
        created_at,
        customer_id,
        customers ( id, name, phone ),
        payments ( amount ),
        returns ( total_refund_amount )
      `, { count: 'exact' })
      .eq('is_hidden', false);

    if (cleanQ) {
      const safeQ = cleanQ.replace(/[,().;:'"%&]/g, ' ').replace(/\s+/g, ' ').trim();
      if (safeQ) {
        // Find matching customers first (capped to 50 to prevent URI length overflow)
        const { data: matchedCustomers } = await supabase
          .from('customers')
          .select('id')
          .or(`name.ilike.%${safeQ}%,phone.ilike.%${safeQ}%`)
          .limit(50);

        const customerIds = (matchedCustomers || []).map((c: any) => c.id);

        if (customerIds.length > 0) {
          queryBuilder = queryBuilder.or(`invoice_number.ilike.%${safeQ}%,customer_id.in.(${customerIds.join(',')})`);
        } else {
          queryBuilder = queryBuilder.ilike('invoice_number', `%${safeQ}%`);
        }
      }
    }

    const { data, count, error } = await queryBuilder
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) throw error;

    const formatted = (data || []).map((inv: any) => {
      const totalRefunds = Math.round((inv.returns?.reduce((acc: number, r: any) => acc + (Number(r.total_refund_amount) || 0), 0) || 0) * 100) / 100;
      const effectiveTotal = Math.max(0, Math.round((Number(inv.final_total || 0) - totalRefunds) * 100) / 100);
      const paid = Math.round((inv.payments?.reduce((acc: number, p: any) => acc + (Number(p.amount) || 0), 0) || 0) * 100) / 100;
      const rawDue = Math.max(0, Math.round((effectiveTotal - paid) * 100) / 100);
      const due = inv.is_voided ? 0 : rawDue;

      let status: 'Paid' | 'Partial' | 'Credit' | 'Void' | 'Refunded' = 'Paid';
      if (inv.is_voided) {
        status = 'Void';
      } else if (totalRefunds > 0 && effectiveTotal === 0) {
        status = 'Refunded';
      } else if (due === 0) {
        status = 'Paid';
      } else if (paid > 0) {
        status = 'Partial';
      } else {
        status = 'Credit';
      }

      return {
        id: inv.id,
        invoice_number: inv.invoice_number,
        customer_name: inv.customers?.name || undefined,
        customer_phone: inv.customers?.phone || undefined,
        total_amount: Number(inv.final_total || 0),
        effective_total: effectiveTotal,
        total_refunds: totalRefunds,
        paid_amount: paid,
        due_amount: due,
        status,
        is_voided: Boolean(inv.is_voided),
        created_at: inv.created_at
      };
    });

    const total = count || 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return {
      success: true,
      data: formatted,
      total,
      page,
      pageSize,
      totalPages
    };
  } catch (err: any) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to fetch invoices',
      data: [],
      total: 0,
      page: 1,
      pageSize: 25,
      totalPages: 1
    };
  }
}

export async function getFullInvoiceAction(id: string) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('invoices')
    .select(`
      *,
      customers ( id, name, phone, gstin, address, credit_balance ),
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
          selling_price,
          stock_quantity,
          stock_sets,
          products ( id, name, pieces_per_set, categories ( id, name ) )
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
      ),
      payments (
        id,
        amount,
        method,
        created_at
      )
    `)
    .eq('id', id)
    .single();

  if (error) {
    console.error('Error fetching full invoice:', error);
    return { success: false, error: error.message };
  }

  return { success: true, data };
}
