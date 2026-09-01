'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const clearChequeSchema = z.object({
  chequeId: z.string().uuid('Invalid cheque ID'),
  clearanceMethod: z.enum(['BANK', 'CASH']),
  clearanceDate: z.string().optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable()
});

const customerIdSchema = z.string().uuid('Invalid customer ID');

const createChequeSchema = z.object({
  customerId: z.string().uuid('Invalid customer ID'),
  invoiceId: z
    .string()
    .uuid('Invalid invoice ID')
    .optional()
    .nullable()
    .or(z.literal(''))
    .transform((val) => (val ? val : null)),
  chequeNumber: z.string().trim().min(1, 'Cheque number is required').max(50),
  bankName: z.string().trim().min(1, 'Bank name is required').max(100),
  chequeDate: z
    .string()
    .min(1, 'Cheque date is required')
    .refine((d) => !isNaN(new Date(d).getTime()), 'Invalid cheque date format')
    .transform((d) => new Date(d).toISOString().split('T')[0]),
  amount: z.coerce
    .number()
    .positive('Cheque amount must be greater than 0')
    .max(99999999.99, 'Amount exceeds maximum permitted value')
    .transform((a) => Math.round(a * 100) / 100)
});

export async function getCustomerChequesAction(customerId: string) {
  try {
    const validCustomerId = customerIdSchema.parse(customerId);
    const supabase = createClient();
    const { data, error } = await supabase
      .from('customer_cheques')
      .select('*, invoices(invoice_number)')
      .eq('customer_id', validCustomerId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return { success: true, data: data || [] };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to load customer cheques', data: [] };
  }
}

export async function createCustomerChequeAction(params: {
  customerId: string;
  invoiceId?: string | null;
  chequeNumber: string;
  bankName: string;
  chequeDate: string;
  amount: number;
}) {
  try {
    const validated = createChequeSchema.parse(params);
    const supabase = createClient();

    // 1. Verify Customer exists and is active
    const { data: customer, error: customerErr } = await supabase
      .from('customers')
      .select('id, is_active')
      .eq('id', validated.customerId)
      .maybeSingle();

    if (customerErr || !customer) {
      return { success: false, error: 'Customer not found.' };
    }
    if (!customer.is_active) {
      return { success: false, error: 'Cannot record cheque for an inactive customer.' };
    }

    // 2. If linked to an invoice, verify ownership and active status
    if (validated.invoiceId) {
      const { data: invoice, error: invoiceErr } = await supabase
        .from('invoices')
        .select('id, customer_id, is_voided, is_hidden, invoice_number')
        .eq('id', validated.invoiceId)
        .maybeSingle();

      if (invoiceErr || !invoice) {
        return { success: false, error: 'Linked invoice not found.' };
      }
      if (invoice.customer_id !== validated.customerId) {
        return { success: false, error: 'Selected invoice does not belong to this customer.' };
      }
      if (invoice.is_voided) {
        return { success: false, error: 'Cannot link cheque to a voided invoice.' };
      }
      if (invoice.is_hidden) {
        return { success: false, error: 'Cannot link cheque to a deleted invoice.' };
      }
    }

    // 3. Insert customer cheque and return with joined invoice details
    const { data, error } = await supabase
      .from('customer_cheques')
      .insert({
        customer_id: validated.customerId,
        invoice_id: validated.invoiceId,
        cheque_number: validated.chequeNumber,
        bank_name: validated.bankName,
        cheque_date: validated.chequeDate,
        amount: validated.amount,
        status: 'PENDING'
      })
      .select('*, invoices(invoice_number)')
      .single();

    if (error) throw error;

    // 4. Revalidate paths including specific customer detail page
    revalidatePath('/customers');
    revalidatePath(`/customers/${validated.customerId}`);
    revalidatePath('/invoices');

    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to record cheque' };
  }
}

export async function clearCustomerChequeAction(params: {
  chequeId: string;
  clearanceMethod: 'BANK' | 'CASH';
  clearanceDate?: string | null;
  notes?: string | null;
}) {
  try {
    const validated = clearChequeSchema.parse(params);
    const supabase = createClient();

    let formattedDate = new Date().toISOString();
    if (validated.clearanceDate) {
      const parsed = new Date(validated.clearanceDate);
      if (isNaN(parsed.getTime())) {
        return { success: false, error: 'Invalid clearance date format.' };
      }
      formattedDate = parsed.toISOString();
    }

    const { data, error } = await supabase.rpc('clear_customer_cheque', {
      p_cheque_id: validated.chequeId,
      p_clearance_method: validated.clearanceMethod,
      p_clearance_date: formattedDate,
      p_clearance_notes: validated.notes || null
    });

    if (error) throw error;

    revalidatePath('/customers');
    revalidatePath('/invoices');
    revalidatePath('/reports');
    revalidatePath('/dashboard');

    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to clear cheque' };
  }
}
