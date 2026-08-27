'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function createCategoryAction(name: string, hsnCode?: string) {
  try {
    const trimmedName = name.trim();
    if (!trimmedName) return { success: false, error: 'Category name cannot be empty.' };

    const supabase = createClient()
    const insertPayload: any = { name: trimmedName };
    if (hsnCode && hsnCode.trim()) {
      insertPayload.hsn_code = hsnCode.trim();
    }

    const { data, error } = await supabase
      .from('categories')
      .insert(insertPayload)
      .select()
      .single()

    if (error) {
      if (error.code === '23505') return { success: false, error: 'Category already exists.' }
      return { success: false, error: error.message }
    }

    revalidatePath('/inventory');
    revalidatePath('/inventory/products');
    revalidatePath('/pos');
    return { success: true, data }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function updateCategoryAction(id: string, name: string, hsnCode?: string) {
  try {
    const trimmedName = name.trim();
    if (!trimmedName) return { success: false, error: 'Category name cannot be empty.' };

    const supabase = createClient()
    const updatePayload: any = { name: trimmedName };
    if (hsnCode !== undefined) {
      updatePayload.hsn_code = hsnCode ? hsnCode.trim() : '6109';
    }

    const { data, error } = await supabase
      .from('categories')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      if (error.code === '23505') return { success: false, error: 'Category already exists.' }
      return { success: false, error: error.message }
    }

    revalidatePath('/inventory');
    revalidatePath('/inventory/products');
    revalidatePath('/pos');
    return { success: true, data }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function deleteCategoryAction(id: string) {
  try {
    const supabase = createClient()
    const { data, error } = await supabase.rpc('delete_category_safe', {
      p_category_id: id,
    })

    if (error) {
      return { success: false, error: error.message }
    }

    revalidatePath('/inventory');
    revalidatePath('/inventory/products');
    revalidatePath('/pos');
    return { success: true, data }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}
