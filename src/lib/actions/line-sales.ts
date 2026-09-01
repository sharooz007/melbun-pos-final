'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const createLineStaffSchema = z.object({
  name: z.string().trim().min(1, 'Staff name is required').max(100),
  phone: z.string().trim().max(20).optional().nullable(),
  route_name: z.string().trim().max(100).optional().nullable()
});

const dummyInvoiceItemSchema = z.object({
  variant_id: z.string().uuid(),
  variant_name: z.string(),
  sets_quantity: z.number().int().min(0).default(0),
  loose_quantity: z.number().int().min(0).default(0),
  selling_price: z.coerce.number().min(0),
  total_pieces: z.number().int().min(1)
});

const createLineDummyInvoiceSchema = z.object({
  staff_id: z.string().uuid('Invalid staff ID'),
  shop_name: z.string().trim().default('Valued Shop'),
  shop_phone: z.string().trim().max(20).optional().nullable(),
  items: z.array(dummyInvoiceItemSchema).min(1, 'Invoice must contain at least one item'),
  subtotal: z.coerce.number().min(0),
  discount_amount: z.coerce.number().min(0).default(0),
  round_off: z.coerce.number().min(-50).max(50).default(0),
  gst_applied: z.boolean().optional().default(false),
  cgst_amount: z.number().optional().default(0),
  sgst_amount: z.number().optional().default(0),
  idempotency_key: z.string().optional(),
  final_total: z.coerce.number().min(0),
  notes: z.string().trim().max(500).optional().nullable()
});

const lineItemStockSchema = z.object({
  variant_id: z.string().uuid('Invalid variant ID'),
  sets_quantity: z.number().int().min(0, 'Sets cannot be negative'),
  loose_quantity: z.number().int().min(0, 'Loose quantity cannot be negative'),
  selling_price: z.coerce.number().min(0).optional()
});

const linePaymentSchema = z.object({
  amount: z.coerce.number().positive('Payment amount must be greater than 0'),
  method: z.enum(['CASH', 'UPI', 'CREDIT', 'STORE_CREDIT', 'CARD', 'CHEQUE'])
});

const dispatchStockSchema = z.object({
  staff_id: z.string().uuid('Invalid staff ID'),
  items: z.array(lineItemStockSchema).min(1, 'Must dispatch at least one item'),
  notes: z.string().trim().max(500).optional().nullable()
});

const billLineSalesSchema = z.object({
  staff_id: z.string().uuid('Invalid staff ID'),
  items: z.array(lineItemStockSchema).min(1, 'Must sell at least one item'),
  payments: z.array(linePaymentSchema).default([]),
  discount_amount: z.coerce.number().min(0).default(0),
  round_off: z.coerce.number().min(-50).max(50).default(0),
  gst_applied: z.boolean().optional().default(false),
  cgst_amount: z.number().optional().default(0),
  sgst_amount: z.number().optional().default(0),
  idempotency_key: z.string().optional(),
  notes: z.string().trim().max(500).optional().nullable()
});

const returnStockSchema = z.object({
  staff_id: z.string().uuid('Invalid staff ID'),
  items: z.array(lineItemStockSchema).optional().nullable(),
  put_back_all: z.boolean().default(false),
  notes: z.string().trim().max(500).optional().nullable()
});

export async function getLineStaffListAction() {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('line_staff')
      .select('*, customers(id, name, phone, credit_balance)')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return { success: true, data: data || [] };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to load line staff', data: [] };
  }
}

export async function getLineStaffMemberAction(staffId: string) {
  try {
    if (!staffId) return { success: false, error: 'Staff ID is required' };
    const supabase = createClient();
    const { data, error } = await supabase
      .from('line_staff')
      .select('*, customers(id, name, phone, credit_balance)')
      .eq('id', staffId)
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to load staff member' };
  }
}

export async function createLineStaffAction(params: {
  name: string;
  phone?: string | null;
  route_name?: string | null;
}) {
  try {
    const validated = createLineStaffSchema.parse(params);
    const supabase = createClient();
    const { data, error } = await supabase
      .from('line_staff')
      .insert({
        name: validated.name,
        phone: validated.phone || null,
        route_name: validated.route_name || null
      })
      .select()
      .single();

    if (error) throw error;

    revalidatePath('/customers');
    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to create line staff' };
  }
}

export async function getLineVanInventoryAction(staffId: string) {
  try {
    if (!staffId) return { success: false, error: 'Staff ID is required', data: [] };
    const supabase = createClient();
    const { data, error } = await supabase
      .from('line_van_inventory')
      .select(`
        staff_id,
        variant_id,
        quantity,
        sets_quantity,
        updated_at,
        variants (
          id,
          name,
          barcode,
          selling_price,
          cost_price,
          pieces_per_set,
          products (
            id,
            name
          )
        )
      `)
      .eq('staff_id', staffId)
      .gt('quantity', 0)
      .order('updated_at', { ascending: false });

    if (error) throw error;
    return { success: true, data: data || [] };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to load van inventory', data: [] };
  }
}

export async function getLineDummyInvoicesAction(staffId: string) {
  try {
    if (!staffId) return { success: false, error: 'Staff ID is required', data: [] };
    const supabase = createClient();
    const { data, error } = await supabase
      .from('line_dummy_invoices')
      .select('*')
      .eq('staff_id', staffId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return { success: true, data: data || [] };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to load road dummy invoices', data: [] };
  }
}

export async function getLineStockMovementsAction(staffId: string) {
  try {
    if (!staffId) return { success: false, error: 'Staff ID is required', data: [] };
    const supabase = createClient();
    const { data, error } = await supabase
      .from('line_stock_movements')
      .select(`
        *,
        variants (
          id,
          name,
          pieces_per_set,
          products ( id, name )
        )
      `)
      .eq('staff_id', staffId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return { success: true, data: data || [] };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to load stock movements', data: [] };
  }
}

export async function createLineDummyInvoiceAction(params: {
  staff_id: string;
  shop_name?: string;
  shop_phone?: string | null;
  items: any[];
  subtotal: number;
  discount_amount?: number;
  round_off?: number;
  final_total: number;
  notes?: string | null;
}) {
  try {
    const validated = createLineDummyInvoiceSchema.parse(params);
    const supabase = createClient();
    const year = new Date().getFullYear();
    const randomHex = (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2)).substring(0, 6).toUpperCase();
    const invoiceNumber = `LINE/${year}/${randomHex}`;

    const { data, error } = await supabase
      .from('line_dummy_invoices')
      .insert({
        staff_id: validated.staff_id,
        invoice_number: invoiceNumber,
        shop_name: validated.shop_name || 'Valued Shop',
        shop_phone: validated.shop_phone || null,
        items: validated.items,
        subtotal: validated.subtotal,
        discount_amount: validated.discount_amount || 0,
        final_total: validated.final_total,
        notes: validated.notes || null
      })
      .select()
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to save dummy invoice' };
  }
}

export async function dispatchLineStockAction(params: {
  staff_id: string;
  items: { variant_id: string; sets_quantity: number; loose_quantity: number }[];
  notes?: string | null;
}) {
  try {
    const validated = dispatchStockSchema.parse(params);
    const supabase = createClient();
    const { data, error } = await supabase.rpc('dispatch_stock_to_line_staff', {
      p_staff_id: validated.staff_id,
      p_items: validated.items,
      p_notes: validated.notes || null
    });

    if (error) throw error;

    revalidatePath('/inventory');
    revalidatePath('/inventory/products');
    revalidatePath('/inventory/ledger');
    revalidatePath('/pos');

    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to dispatch stock to line van' };
  }
}

export async function billLineStaffSalesAction(params: {
  staff_id: string;
  items: { variant_id: string; sets_quantity: number; loose_quantity: number; selling_price?: number }[];
  payments?: { amount: number; method: string }[];
  discount_amount?: number;
  round_off?: number;
  gst_applied?: boolean;
  cgst_amount?: number;
  sgst_amount?: number;
  idempotency_key?: string;
  notes?: string | null;
}) {
  try {
    const validated = billLineSalesSchema.parse(params);
    const supabase = createClient();
    const { data, error } = await supabase.rpc('bill_line_staff_sales', {
      p_staff_id: validated.staff_id,
      p_items: validated.items,
      p_payments: validated.payments,
      p_discount_amount: validated.discount_amount || 0,
      p_round_off: validated.round_off || 0,
      p_gst_applied: validated.gst_applied,
      p_cgst_amount: validated.cgst_amount,
      p_sgst_amount: validated.sgst_amount,
      p_idempotency_key: validated.idempotency_key,
      p_notes: validated.notes || null
    });

    if (error) throw error;

    revalidatePath('/invoices');
    revalidatePath('/customers');
    revalidatePath('/reports');
    revalidatePath('/dashboard');
    revalidatePath('/pos');

    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to bill line sales' };
  }
}

export async function returnLineVanStockAction(params: {
  staff_id: string;
  items?: { variant_id: string; sets_quantity: number; loose_quantity: number }[] | null;
  put_back_all?: boolean;
  notes?: string | null;
}) {
  try {
    const validated = returnStockSchema.parse(params);
    const supabase = createClient();
    const { data, error } = await supabase.rpc('return_line_van_stock', {
      p_staff_id: validated.staff_id,
      p_items: validated.items || null,
      p_put_back_all: Boolean(validated.put_back_all),
      p_notes: validated.notes || null
    });

    if (error) throw error;

    revalidatePath('/inventory');
    revalidatePath('/inventory/products');
    revalidatePath('/inventory/ledger');
    revalidatePath('/pos');

    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to return line stock to warehouse' };
  }
}

const toggleLineStaffSchema = z.object({
  staff_id: z.string().uuid('Invalid staff ID'),
  is_active: z.boolean()
});

export async function toggleLineStaffStatusAction(staffId: string, isActive: boolean) {
  try {
    const validated = toggleLineStaffSchema.parse({ staff_id: staffId, is_active: isActive });
    const supabase = createClient();
    const { data, error } = await supabase
      .from('line_staff')
      .update({ is_active: validated.is_active, updated_at: new Date().toISOString() })
      .eq('id', validated.staff_id)
      .select()
      .single();

    if (error) throw error;
    revalidatePath('/line-sales');
    revalidatePath(`/line-sales/${validated.staff_id}`);
    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to update line staff status' };
  }
}
