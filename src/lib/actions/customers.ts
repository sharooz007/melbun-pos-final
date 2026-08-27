'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { CustomerPaymentMethod, CreditLedgerEntry } from '@/types/customers'

export async function getOrCreateCustomerAction(name?: string | null, phone?: string | null) {
  try {
    const trimmedName = (name || '').trim();
    const trimmedPhone = (phone || '').trim();
    if (!trimmedName && !trimmedPhone) {
      return { success: false, error: 'Customer name or phone number is required' };
    }

    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return { 
        success: false, 
        error: 'Your login session has expired. Please log out and sign in again.' 
      };
    }

    const { data, error } = await supabase.rpc('get_or_create_customer', {
      p_name: trimmedName || null,
      p_phone: trimmedPhone || null
    });

    if (error) {
      if (error.message.includes('Unauthorized')) {
        return { success: false, error: 'Your login session has expired. Please log out and sign in again.' };
      }
      return { success: false, error: error.message };
    }

    return { success: true, customer: data.customer };
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('Unauthorized') || msg.includes('jwt')) {
      return { success: false, error: 'Your login session has expired. Please log out and sign in again.' };
    }
    return { success: false, error: msg || 'Failed to lookup customer' };
  }
}

export async function getCustomersListAction(searchQuery?: string, showInactive: boolean = false) {
  try {
    const supabase = createClient();
    let query = supabase
      .from('customer_metrics')
      .select('*')
      .order('created_at', { ascending: false });

    if (!showInactive) {
      query = query.eq('is_active', true);
    }

    if (searchQuery && searchQuery.trim()) {
      const safeQ = searchQuery.replace(/[,().;:'"%&]/g, ' ').replace(/\s+/g, ' ').trim();
      if (safeQ) {
        query = query.or(`name.ilike.%${safeQ}%,phone.ilike.%${safeQ}%`);
      }
    }

    const { data, error } = await query;
    if (error) throw error;

    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function createCustomerAction(
  name: string,
  phone?: string | null,
  gstin?: string | null,
  address?: string | null
) {
  try {
    const trimmedName = (name || '').trim();
    const cleanPhone = phone ? phone.replace(/[^0-9+]/g, '').trim() : '';
    const cleanGstin = gstin ? gstin.toUpperCase().replace(/[^0-9A-Z]/g, '').trim() : null;
    const trimmedAddress = (address || '').trim();

    if (!trimmedName) {
      return { success: false, error: 'Customer name is required' };
    }

    if (cleanGstin && cleanGstin.length !== 15) {
      return { success: false, error: 'Invalid GSTIN format: Must be exactly 15 characters (e.g. 29AAAAA0000A1Z5).' };
    }

    const supabase = createClient();

    // Check if phone already exists
    if (cleanPhone) {
      const { data: existing } = await supabase
        .from('customers')
        .select('id, name')
        .eq('phone', cleanPhone)
        .maybeSingle();

      if (existing) {
        return { success: false, error: `Customer with phone ${cleanPhone} already exists (${existing.name}).` };
      }
    }

    const { data, error } = await supabase
      .from('customers')
      .insert({
        name: trimmedName,
        phone: cleanPhone || null,
        gstin: cleanGstin || null,
        address: trimmedAddress || null,
        is_active: true
      })
      .select()
      .single();

    if (error) throw error;

    revalidatePath('/customers');
    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to create customer' };
  }
}

export async function getCustomerDetailsAction(id: string) {
  try {
    const supabase = createClient();
    const [{ data: metricData, error: metricError }, { data: custData, error: custError }] = await Promise.all([
      supabase.from('customer_metrics').select('*').eq('id', id).single(),
      supabase.from('customers').select('credit_balance').eq('id', id).single()
    ]);

    if (metricError) throw metricError;
    return { 
      success: true, 
      data: {
        ...metricData,
        credit_balance: Number(custData?.credit_balance || 0)
      } 
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function getCustomerCreditLedgerAction(id: string) {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('customer_credit_ledger')
      .select('*, invoices(invoice_number)')
      .eq('customer_id', id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return { success: true, data: (data as CreditLedgerEntry[]) || [] };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to load credit history' };
  }
}

export async function getCustomerInvoicesAction(id: string) {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('invoices')
      .select('*, payments(amount), returns(total_refund_amount)')
      .eq('customer_id', id)
      .eq('is_hidden', false)
      .order('created_at', { ascending: false });

    if (error) throw error;
    
    const processed = (data || []).map((inv: any) => {
      const totalRefunds = Math.round((inv.returns?.reduce((acc: number, r: any) => acc + (Number(r.total_refund_amount) || 0), 0) || 0) * 100) / 100;
      const effectiveTotal = Math.max(0, Math.round((Number(inv.final_total || 0) - totalRefunds) * 100) / 100);
      const paid = Math.round((inv.payments?.reduce((acc: number, p: any) => acc + (Number(p.amount) || 0), 0) || 0) * 100) / 100;
      const rawDue = Math.max(0, Math.round((effectiveTotal - paid) * 100) / 100);
      const due = inv.is_voided ? 0 : rawDue;
      
      let status = 'Credit';
      if (inv.is_voided) status = 'Void';
      else if (totalRefunds > 0 && effectiveTotal === 0) status = 'Refunded';
      else if (due === 0) status = 'Paid';
      else if (paid > 0) status = 'Partial';
      
      return {
        ...inv,
        effective_final_total: effectiveTotal,
        total_refunds: totalRefunds,
        amount_paid: paid,
        due_amount: due,
        status
      };
    });

    return { success: true, data: processed };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function deactivateCustomerAction(id: string) {
  try {
    const supabase = createClient();
    const { error } = await supabase.rpc('deactivate_customer', { p_customer_id: id });
    if (error) throw error;
    
    revalidatePath('/customers');
    revalidatePath(`/customers/${id}`);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function getCustomerPaymentsAction(id: string) {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('payments')
      .select('*, invoices(invoice_number, is_voided)')
      .eq('customer_id', id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  } catch (err: any) {
    console.error(err);
    return [];
  }
}

export async function getCustomerReturnsAction(id: string) {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('returns')
      .select('*, invoices(invoice_number), variants(name, products(name))')
      .eq('customer_id', id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  } catch (err: any) {
    console.error(err);
    return [];
  }
}

export async function payInvoiceAction(
  invoice_id: string, 
  customer_id: string, 
  amount: number, 
  method: CustomerPaymentMethod
) {
  try {
    const supabase = createClient();
    const { data, error } = await supabase.rpc('pay_invoice', {
      p_invoice_id: invoice_id,
      p_customer_id: customer_id,
      p_amount: amount,
      p_method: method
    });

    if (error) throw error;

    revalidatePath('/customers');
    revalidatePath(`/customers/${customer_id}`);
    revalidatePath('/invoices');
    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.message || 'Payment failed' };
  }
}

export async function updateCustomerAction(
  id: string, 
  name: string, 
  phone: string,
  gstin?: string | null,
  address?: string | null
) {
  try {
    const supabase = createClient();
    const trimmedName = (name || '').trim();
    if (!trimmedName) {
      return { success: false, error: 'Customer name cannot be empty.' };
    }
    const cleanPhone = phone ? phone.replace(/[^0-9+]/g, '').trim() : '';
    const cleanGstin = gstin ? gstin.toUpperCase().replace(/[^0-9A-Z]/g, '').trim() : null;

    if (cleanGstin && cleanGstin.length !== 15) {
      return { success: false, error: 'Invalid GSTIN format: Must be exactly 15 characters (e.g. 29AAAAA0000A1Z5).' };
    }

    const updatePayload: Record<string, any> = {
      name: trimmedName,
      phone: cleanPhone || null,
      updated_at: new Date().toISOString()
    };
    if (gstin !== undefined) updatePayload.gstin = cleanGstin;
    if (address !== undefined) updatePayload.address = address?.trim() || null;

    const { data, error } = await supabase
      .from('customers')
      .update(updatePayload)
      .eq('id', id);

    if (error) {
      if (error.code === '23505' || error.message?.includes('customers_phone_key')) {
        return { success: false, error: 'A customer with this phone number already exists.' };
      }
      throw error;
    }

    revalidatePath('/customers');
    revalidatePath(`/customers/${id}`);
    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to update customer' };
  }
}

export async function reactivateCustomerAction(id: string) {
  try {
    const supabase = createClient();
    const { data, error } = await supabase.rpc('reactivate_customer', { p_customer_id: id });
    if (error) throw error;

    revalidatePath('/customers');
    revalidatePath(`/customers/${id}`);
    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to reactivate customer' };
  }
}
