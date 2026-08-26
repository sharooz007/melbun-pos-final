'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

const stockArrivalSchema = z.array(z.object({
  variant_id: z.string().uuid(),
  sets_quantity: z.number().int().min(0),
  loose_quantity: z.number().int().min(0),
  notes: z.string().optional()
}));

export async function processStockArrivalAction(payload: unknown) {
  try {
    const parsed = stockArrivalSchema.safeParse(payload);
    if (!parsed.success) {
      return { success: false, error: 'Invalid payload format. Ensure quantities are non-negative.' };
    }

    const supabase = createClient();
    const { data, error } = await supabase.rpc('process_stock_arrival', {
      p_movements: parsed.data
    });

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath('/inventory');
    revalidatePath('/inventory/products');
    revalidatePath('/inventory/arrivals');
    revalidatePath('/pos');
    
    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.message || 'Internal server error' };
  }
}

const variantSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, 'Variant name is required'),
  barcode: z
    .string()
    .trim()
    .transform((val) => (val === '' ? undefined : val.toUpperCase()))
    .optional()
    .nullable(),
  cost_price: z.coerce.number().min(0, 'Cost price must be non-negative'),
  selling_price: z.coerce.number().min(0, 'Selling price must be non-negative'),
  initial_sets: z.coerce.number().int().min(0, 'Initial sets cannot be negative').default(0),
  initial_loose: z.coerce.number().int().min(0, 'Initial loose pcs cannot be negative').default(0)
});

const productSchema = z.object({
  name: z.string().trim().min(1, 'Product name is required'),
  category_id: z.string().uuid('Invalid category ID'),
  pieces_per_set: z.coerce.number().int().min(1, 'Pieces per set must be at least 1').default(1),
  variants: z
    .array(variantSchema)
    .min(1, 'At least one variant is required')
    .superRefine((variants, ctx) => {
      const barcodes = new Set<string>();
      variants.forEach((v, index) => {
        if (v.barcode) {
          if (barcodes.has(v.barcode)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Duplicate barcode "${v.barcode}" found across variants`,
              path: [index, 'barcode']
            });
          }
          barcodes.add(v.barcode);
        }
      });
    })
});

export type CreateProductInput = z.input<typeof productSchema>;

export async function createProductAction(payload: unknown) {
  try {
    const parsed = productSchema.safeParse(payload);
    if (!parsed.success) {
      const errorMsg = parsed.error.issues.map((i) => i.message).join('. ');
      return { success: false, error: errorMsg };
    }

    const supabase = createClient();
    const { data, error } = await supabase.rpc('create_product_with_variants', {
      p_name: parsed.data.name,
      p_category_id: parsed.data.category_id,
      p_pieces_per_set: parsed.data.pieces_per_set,
      p_variants: parsed.data.variants
    });

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath('/inventory');
    revalidatePath('/inventory/products');
    
    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err?.message || 'An unexpected internal error occurred' };
  }
}

export async function deleteProductAction(productId: string) {
  try {
    const supabase = createClient();
    const { error } = await supabase.rpc('soft_delete_product', {
      p_product_id: productId
    });

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath('/inventory');
    revalidatePath('/inventory/products');
    
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'An unexpected internal error occurred' };
  }
}

export async function updateProductAction(productId: string, payload: unknown) {
  try {
    const parsed = productSchema.safeParse(payload);
    if (!parsed.success) {
      const errorMsg = parsed.error.issues.map((i) => i.message).join('. ');
      return { success: false, error: errorMsg };
    }

    const supabase = createClient();
    const { data, error } = await supabase.rpc('update_product_with_variants', {
      p_product_id: productId,
      p_name: parsed.data.name,
      p_category_id: parsed.data.category_id,
      p_pieces_per_set: parsed.data.pieces_per_set,
      p_variants: parsed.data.variants
    });

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath('/inventory');
    revalidatePath('/inventory/products');
    
    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err?.message || 'An unexpected internal error occurred' };
  }
}

export interface GetStockLedgerParams {
  page?: number;
  pageSize?: number;
  search?: string;
  type?: string;
  startDate?: string;
  endDate?: string;
}

export async function getStockLedgerAction(params?: GetStockLedgerParams) {
  try {
    const supabase = createClient();
    const page = Math.max(1, params?.page || 1);
    const pageSize = Math.min(100, Math.max(1, params?.pageSize || 25));

    const { data, error } = await supabase.rpc('get_stock_ledger_paged', {
      p_page: page,
      p_page_size: pageSize,
      p_search: params?.search?.trim() || null,
      p_type: params?.type && params.type !== 'ALL' ? params.type : null,
      p_start_date: params?.startDate || null,
      p_end_date: params?.endDate || null
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const rows = data || [];
    const totalCount = rows.length > 0 ? Number(rows[0].total_count) : 0;
    const totalPages = Math.ceil(totalCount / pageSize);

    const formattedData = rows.map((r: any) => ({
      id: r.id,
      type: r.type,
      quantity_change: r.quantity_change,
      notes: r.notes,
      created_at: r.created_at,
      variant: {
        id: r.variant_id,
        name: r.variant_name || 'Deleted Variant',
        barcode: r.variant_barcode || 'N/A',
        product: {
          id: r.product_id,
          name: r.product_name || 'Unknown Product',
          pieces_per_set: r.pieces_per_set || 1
        }
      }
    }));

    return {
      success: true,
      data: formattedData,
      pagination: {
        page,
        pageSize,
        totalCount,
        totalPages
      }
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to load stock ledger'
    };
  }
}

/**
 * Fetches the complete chronological stock movement audit trail for a specific product and its variants.
 */
export async function getProductStockHistoryAction(productId: string) {
  try {
    const parsedId = z.string().uuid().safeParse(productId);
    if (!parsedId.success) {
      return { success: false, error: 'Invalid product ID format' };
    }

    const supabase = createClient();
    const { data, error } = await supabase
      .from('stock_movements')
      .select(`
        id,
        type,
        quantity_change,
        notes,
        created_at,
        variant:variants!inner (
          id,
          name,
          barcode,
          product_id,
          product:products (
            id,
            name,
            pieces_per_set
          )
        )
      `)
      .eq('variant.product_id', parsedId.data)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: data || [] };
  } catch (err: unknown) {
    return { 
      success: false, 
      error: err instanceof Error ? err.message : 'Failed to fetch product stock history' 
    };
  }
}

