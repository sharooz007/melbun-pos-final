'use server'

import { createClient } from '@/lib/supabase/server'

export async function searchVariantsAction(query: string, staffId?: string | null) {
  const supabase = createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Unauthorized' }

  const cleanQuery = query.trim()
  if (!cleanQuery && !staffId) return { success: true, data: [] }

  const { data, error } = await supabase.rpc('search_pos_variants', {
    p_query: cleanQuery || '',
    p_staff_id: staffId || null
  })

  if (error) {
    return { success: false, error: error.message }
  }

  const results = (data || []).map((v: any) => {
    const rawName = String(v.name || '');
    const pName = String(v.product_name || (rawName.includes(' - ') ? rawName.split(' - ')[0] : rawName));
    let varName = rawName;
    if (rawName.startsWith(pName + ' - ')) {
      varName = rawName.slice((pName + ' - ').length);
    } else if (rawName.includes(' - ')) {
      varName = rawName.split(' - ').slice(1).join(' - ');
    }

    return {
      variant_id: v.id,
      name: rawName,
      variant_name: varName || rawName,
      product_id: v.product_id || v.id,
      product_name: pName,
      barcode: v.barcode || '',
      price: Number(v.selling_price) || 0,
      selling_price: Number(v.selling_price) || 0,
      stock_quantity: Number(v.stock_quantity) || 0,
      stock_sets: Number(v.stock_sets) || 0,
      pieces_per_set: Number(v.pieces_per_set) || 1
    };
  });

  return { success: true, data: results };
}
