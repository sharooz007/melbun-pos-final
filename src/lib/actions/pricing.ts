'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const updateCostSchema = z.object({
  variantId: z.string().uuid('Invalid variant ID'),
  newCostPrice: z.coerce.number().finite('Cost price must be a valid number').min(0, 'Cost price cannot be negative')
});

export async function getPricingVariantsAction(search?: string, categoryId?: string) {
  try {
    const supabase = createClient();
    const hasCategoryFilter = categoryId && categoryId !== 'ALL';

    const selectClause = hasCategoryFilter
      ? `
        id,
        name,
        barcode,
        cost_price,
        selling_price,
        stock_quantity,
        stock_sets,
        pieces_per_set,
        is_active,
        product_id,
        products!inner (
          id,
          name,
          category_id,
          categories (
            id,
            name
          )
        )
      `
      : `
        id,
        name,
        barcode,
        cost_price,
        selling_price,
        stock_quantity,
        stock_sets,
        pieces_per_set,
        is_active,
        product_id,
        products (
          id,
          name,
          category_id,
          categories (
            id,
            name
          )
        )
      `;

    let query = supabase
      .from('variants')
      .select(selectClause)
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (hasCategoryFilter) {
      query = query.eq('products.category_id', categoryId);
    }

    const { data, error } = await query;
    if (error) throw error;

    let filtered = data || [];
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter((v: any) => 
        (v.name && v.name.toLowerCase().includes(q)) ||
        (v.barcode && v.barcode.toLowerCase().includes(q)) ||
        (v.products?.name && v.products.name.toLowerCase().includes(q))
      );
    }

    return { success: true, data: filtered };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to fetch pricing variants', data: [] };
  }
}

export async function updateVariantCostAction(params: {
  variantId: string;
  newCostPrice: number;
}) {
  try {
    const validated = updateCostSchema.parse(params);
    const supabase = createClient();
    const { data, error } = await supabase.rpc('update_variant_cost_and_recalculate_profits', {
      p_variant_id: validated.variantId,
      p_new_cost_price: validated.newCostPrice
    });

    if (error) throw error;

    revalidatePath('/inventory');
    revalidatePath('/inventory/products');
    revalidatePath('/reports');
    revalidatePath('/invoices');
    revalidatePath('/pos');
    revalidatePath('/dashboard');

    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to update variant cost' };
  }
}
