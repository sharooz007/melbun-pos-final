'use server'

import { createClient } from '@/lib/supabase/server';
import { LabelVariantItem } from '@/types/labels';
import { z } from 'zod';

const searchQuerySchema = z.string().trim().max(100);

export async function searchVariantsForLabelsAction(
  query: string
): Promise<{ success: boolean; data?: LabelVariantItem[]; error?: string }> {
  try {
    const rawQuery = searchQuerySchema.parse(query);
    const cleanQuery = rawQuery.replace(/[,().;:'"%&]/g, ' ').replace(/\s+/g, ' ').trim();
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    let queryBuilder = supabase
      .from('variants')
      .select(`
        id,
        product_id,
        barcode,
        name,
        cost_price,
        selling_price,
        stock_quantity,
        products!inner (
          id,
          name,
          pieces_per_set
        )
      `)
      .eq('is_active', true)
      .eq('products.is_active', true)
      .order('created_at', { ascending: false });

    if (cleanQuery.length > 0) {
      const { data: matchedProds } = await supabase
        .from('products')
        .select('id')
        .ilike('name', `%${cleanQuery}%`)
        .eq('is_active', true)
        .limit(20);

      const prodIds = (matchedProds || []).map((p: any) => p.id);
      const orClauses = [
        `barcode.ilike.%${cleanQuery}%`,
        `name.ilike.%${cleanQuery}%`
      ];

      if (prodIds.length > 0) {
        orClauses.push(`product_id.in.(${prodIds.join(',')})`);
      }

      queryBuilder = queryBuilder.or(orClauses.join(','));
    }

    const { data, error } = await queryBuilder.limit(30);

    if (error) {
      return { success: false, error: error.message };
    }

    if (!data) {
      return { success: true, data: [] };
    }

    const formatted: LabelVariantItem[] = data.map((row: any) => {
      const product = Array.isArray(row.products) ? row.products[0] : row.products;
      return {
        variant_id: row.id,
        product_id: row.product_id,
        product_name: product?.name || 'Unknown Product',
        variant_name: row.name,
        barcode: row.barcode,
        selling_price: Number(row.selling_price || 0),
        cost_price: Number(row.cost_price || 0),
        stock_quantity: Number(row.stock_quantity || 0),
        pieces_per_set: Number(product?.pieces_per_set || 1)
      };
    });

    return { success: true, data: formatted };
  } catch (err: any) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to search inventory variants.'
    };
  }
}
