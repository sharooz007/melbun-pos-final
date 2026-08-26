'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { ExpenseItem, ExpenseActionResult } from '@/types/expenses'

const addExpenseSchema = z.object({
  category: z
    .string()
    .trim()
    .min(2, 'Category must be at least 2 characters')
    .max(100, 'Category cannot exceed 100 characters'),
  amount: z.coerce
    .number()
    .positive('Amount must be greater than zero')
    .max(10000000, 'Amount cannot exceed ₹1,00,00,000')
    .refine((val) => Number.isFinite(val), 'Amount must be a finite number'),
  payment_method: z.enum(['CASH', 'UPI']),
  notes: z
    .string()
    .trim()
    .max(500, 'Notes cannot exceed 500 characters')
    .optional()
    .nullable()
    .transform((v) => (v && v.length > 0 ? v : null)),
  created_at: z
    .string()
    .optional()
    .nullable()
    .refine(
      (val) => !val || !isNaN(Date.parse(val)),
      'Invalid date/time format'
    )
    .transform((val) => (val ? new Date(val).toISOString() : null))
});

export type AddExpenseInput = z.infer<typeof addExpenseSchema>;

const voidExpenseSchema = z.object({
  expense_id: z.string().uuid('Invalid expense ID format'),
  reason: z
    .string()
    .trim()
    .min(3, 'A void reason must be provided (min 3 characters)')
    .max(500, 'Reason cannot exceed 500 characters')
});

export type VoidExpenseInput = z.infer<typeof voidExpenseSchema>;

const deleteExpenseSchema = z.object({
  id: z.string().uuid('Invalid expense ID format')
});

/**
 * Adds a new store expense with audit-traceable metadata and backdating support
 */
export async function addExpenseAction(
  payload: unknown
): Promise<ExpenseActionResult<{ expense_id: string; category: string; amount: number; payment_method: string; created_at: string }>> {
  try {
    const parsed = addExpenseSchema.safeParse(payload);
    if (!parsed.success) {
      const errorMsg = parsed.error.issues.map((i) => i.message).join('. ');
      return { success: false, error: errorMsg };
    }

    const supabase = createClient();
    const { data, error } = await supabase.rpc('add_expense', {
      p_category: parsed.data.category,
      p_amount: parsed.data.amount,
      p_payment_method: parsed.data.payment_method,
      p_notes: parsed.data.notes || null,
      p_created_at: parsed.data.created_at || null
    });

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath('/expenses');
    revalidatePath('/dashboard');
    revalidatePath('/reports');
    revalidatePath('/');

    return { success: true, data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unexpected error while adding expense';
    return { success: false, error: message };
  }
}

/**
 * Voids an existing expense record (ADMIN only, soft-delete with audit note)
 */
export async function voidExpenseAction(
  payload: unknown
): Promise<ExpenseActionResult<{ expense_id: string }>> {
  try {
    const parsed = voidExpenseSchema.safeParse(payload);
    if (!parsed.success) {
      const errorMsg = parsed.error.issues.map((i) => i.message).join('. ');
      return { success: false, error: errorMsg };
    }

    const supabase = createClient();
    const { data, error } = await supabase.rpc('void_expense', {
      p_expense_id: parsed.data.expense_id,
      p_reason: parsed.data.reason
    });

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath('/expenses');
    revalidatePath('/dashboard');
    revalidatePath('/reports');
    revalidatePath('/');

    return { success: true, data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unexpected error while voiding expense';
    return { success: false, error: message };
  }
}

/**
 * Retrieves the most recent expenses for list and ledger views
 */
export async function getExpenseDetailsAction(
  id: string
): Promise<ExpenseActionResult<ExpenseItem>> {
  try {
    const parsed = deleteExpenseSchema.safeParse({ id });
    if (!parsed.success) {
      return { success: false, error: 'Invalid expense ID format' };
    }

    const supabase = createClient();
    const { data, error } = await supabase
      .from('expenses')
      .select('id, category, amount, payment_method, notes, is_voided, is_hidden, created_at, updated_at')
      .eq('id', parsed.data.id)
      .eq('is_hidden', false)
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: (data as unknown as ExpenseItem) };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unexpected error while fetching expense details';
    return { success: false, error: message };
  }
}

export async function getExpensesAction(
  limit: number = 100
): Promise<ExpenseActionResult<ExpenseItem[]>> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('expenses')
      .select('id, category, amount, payment_method, notes, is_voided, created_at, updated_at')
      .eq('is_hidden', false)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: (data as unknown as ExpenseItem[]) || [] };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unexpected error while fetching expenses';
    return { success: false, error: message };
  }
}

export async function updateExpenseAction(
  id: string,
  payload: unknown
): Promise<ExpenseActionResult<{ id: string }>> {
  try {
    const parsed = addExpenseSchema.safeParse(payload);
    if (!parsed.success) {
      const errorMsg = parsed.error.issues.map((i) => i.message).join('. ');
      return { success: false, error: errorMsg };
    }

    const supabase = createClient();
    const { data, error } = await supabase
      .from('expenses')
      .update({
        category: parsed.data.category,
        amount: parsed.data.amount,
        payment_method: parsed.data.payment_method,
        notes: parsed.data.notes || null,
        created_at: parsed.data.created_at ? parsed.data.created_at : undefined,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('is_voided', false)
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath('/expenses');
    revalidatePath('/dashboard');
    revalidatePath('/reports');
    revalidatePath('/');

    return { success: true, data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unexpected error while updating expense';
    return { success: false, error: message };
  }
}

export async function deleteExpenseAction(
  id: string
): Promise<ExpenseActionResult<{ id: string }>> {
  try {
    const parsed = deleteExpenseSchema.safeParse({ id });
    if (!parsed.success) {
      return { success: false, error: 'Invalid expense ID format' };
    }

    const supabase = createClient();
    const { data, error } = await supabase
      .from('expenses')
      .update({
        is_hidden: true,
        is_voided: true, // Nullifies financial impact in dashboard & reports
        updated_at: new Date().toISOString()
      })
      .eq('id', parsed.data.id)
      .select('id')
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath('/expenses');
    revalidatePath('/dashboard');
    revalidatePath('/reports');
    revalidatePath('/');

    return { success: true, data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unexpected error while deleting expense';
    return { success: false, error: message };
  }
}

export async function getExpensesSummaryMetricsAction(): Promise<
  ExpenseActionResult<{
    totalActiveSum: number;
    cashSum: number;
    upiSum: number;
    voidedCount: number;
    totalCount: number;
  }>
> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('expenses')
      .select('amount, payment_method, is_voided')
      .eq('is_hidden', false);

    if (error) throw error;

    const totalActive = (data || []).filter(e => !e.is_voided);
    const totalActiveSum = totalActive.reduce((sum, e) => sum + Number(e.amount || 0), 0);
    const cashSum = totalActive.filter(e => e.payment_method === 'CASH').reduce((sum, e) => sum + Number(e.amount || 0), 0);
    const upiSum = totalActive.filter(e => e.payment_method === 'UPI').reduce((sum, e) => sum + Number(e.amount || 0), 0);
    const voidedCount = (data || []).filter(e => e.is_voided).length;
    const totalCount = totalActive.length;

    return {
      success: true,
      data: {
        totalActiveSum,
        cashSum,
        upiSum,
        voidedCount,
        totalCount
      }
    };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to calculate expense metrics' };
  }
}

const expenseCategorySchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Category name must be at least 2 characters')
    .max(50, 'Category name cannot exceed 50 characters')
});

export async function getExpenseCategoriesAction(): Promise<ExpenseActionResult<{ id: string; name: string }[]>> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('expense_categories')
      .select('id, name')
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) return { success: false, error: error.message };
    return { success: true, data: data || [] };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch expense categories';
    return { success: false, error: message };
  }
}

export async function createExpenseCategoryAction(
  name: string
): Promise<ExpenseActionResult<{ id: string; name: string }>> {
  try {
    const parsed = expenseCategorySchema.safeParse({ name });
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const trimmed = parsed.data.name;
    const supabase = createClient();

    // Check if an inactive category with same name exists to reactivate it cleanly
    const { data: existing } = await supabase
      .from('expense_categories')
      .select('id, is_active')
      .ilike('name', trimmed)
      .maybeSingle();

    if (existing) {
      if (existing.is_active) {
        return { success: false, error: 'Category already exists' };
      }
      // Reactivate previously soft-deleted category
      const { data: reactivated, error: reactivateErr } = await supabase
        .from('expense_categories')
        .update({ is_active: true, name: trimmed, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select('id, name')
        .single();

      if (reactivateErr) return { success: false, error: reactivateErr.message };

      revalidatePath('/expenses');
      revalidatePath('/expenses/[id]');
      return { success: true, data: reactivated };
    }

    const { data, error } = await supabase
      .from('expense_categories')
      .insert({ name: trimmed })
      .select('id, name')
      .single();

    if (error) {
      if (error.code === '23505') return { success: false, error: 'Category already exists' };
      return { success: false, error: error.message };
    }

    revalidatePath('/expenses');
    revalidatePath('/expenses/[id]');
    return { success: true, data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create category';
    return { success: false, error: message };
  }
}

export async function updateExpenseCategoryAction(
  id: string,
  name: string
): Promise<ExpenseActionResult<{ id: string; name: string }>> {
  try {
    const parsed = expenseCategorySchema.safeParse({ name });
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const trimmed = parsed.data.name;
    const supabase = createClient();

    const { data, error } = await supabase
      .from('expense_categories')
      .update({ name: trimmed, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('is_active', true)
      .select('id, name')
      .single();

    if (error) {
      if (error.code === '23505') return { success: false, error: 'Category name already in use' };
      return { success: false, error: error.message };
    }

    revalidatePath('/expenses');
    revalidatePath('/expenses/[id]');
    return { success: true, data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update category';
    return { success: false, error: message };
  }
}

export async function deleteExpenseCategoryAction(id: string): Promise<ExpenseActionResult<{ id: string }>> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('expense_categories')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id')
      .single();

    if (error) return { success: false, error: error.message };

    revalidatePath('/expenses');
    revalidatePath('/expenses/[id]');
    return { success: true, data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to delete category';
    return { success: false, error: message };
  }
}
