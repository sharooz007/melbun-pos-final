'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function createCategoryAction(name: string) {
  try {
    const trimmedName = name.trim();
    if (!trimmedName) return { success: false, error: 'Category name cannot be empty.' };

    const supabase = createClient()
    const { data, error } = await supabase
      .from('categories')
      .insert({ name: trimmedName })
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

export async function updateCategoryAction(id: string, name: string) {
  try {
    const trimmedName = name.trim();
    if (!trimmedName) return { success: false, error: 'Category name cannot be empty.' };

    const supabase = createClient()
    const { data, error } = await supabase
      .from('categories')
      .update({ name: trimmedName })
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
