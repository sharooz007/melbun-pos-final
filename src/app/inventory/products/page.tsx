import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { InventoryClient } from '@/components/inventory/InventoryClient'
import { ShieldAlert } from 'lucide-react'

export const dynamic = 'force-dynamic';
export const runtime = 'edge';

export default async function InventoryPage() {
  const supabase = createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  const [{ data: variants, error: variantsError }, { data: categories }] = await Promise.all([
    supabase
      .from('variants')
      .select(`
        id, product_id, name, barcode, cost_price, selling_price, stock_quantity, stock_sets, created_at,
        product:products!inner (id, name, category_id, pieces_per_set)
      `)
      .eq('is_active', true)
      .eq('product.is_active', true)
      .order('created_at', { ascending: false }),
    supabase
      .from('categories')
      .select('*')
      .order('name', { ascending: true })
  ])

  if (variantsError) {
    return (
      <div className="p-10 max-w-7xl w-full mx-auto">
        <div className="p-6 text-red-700 bg-red-50 border border-red-200 rounded-[16px] flex items-center gap-3">
          <ShieldAlert className="w-5 h-5" />
          <p className="font-semibold text-[14px]">Database Error: {variantsError.message}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-3.5 pb-36 sm:p-6 md:p-8 md:pb-8 max-w-7xl w-full mx-auto">
      <InventoryClient variants={variants || []} categories={categories || []} />
    </div>
  );
}
