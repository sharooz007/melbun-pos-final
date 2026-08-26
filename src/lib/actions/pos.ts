'use server'

import { createClient } from '@/lib/supabase/server'

export async function searchVariantsAction(query: string) {
  const supabase = createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Unauthorized' }

  const cleanQuery = query.trim()
  if (!cleanQuery) return { success: true, data: [] }

  const { data, error } = await supabase.rpc('search_pos_variants', {
    p_query: cleanQuery
  })

  if (error) {
    return { success: false, error: error.message }
  }

  const results = (data || []).map((v: any) => ({
    variant_id: v.id,
    name: v.name,
    barcode: v.barcode,
    price: Number(v.selling_price),
    stock_quantity: Number(v.stock_quantity) || 0,
    stock_sets: Number(v.stock_sets) || 0,
    pieces_per_set: Number(v.pieces_per_set) || 1
  }))

  return { success: true, data: results }
}
