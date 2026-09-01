'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function createCategoryAction(name: string, hsnCode?: string) {
  try {
    const trimmedName = name.trim();
    if (!trimmedName) return { success: false, error: 'Category name cannot be empty.' };

    const insertData: any = { name: trimmedName };
    if (hsnCode !== undefined) {
      insertData.hsn_code = hsnCode.trim() || null;
    }

    const supabase = createClient()
    const { data, error } = await supabase
      .from('categories')
      .insert(insertData)
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

    const updateData: any = { name: trimmedName };
    if (hsnCode !== undefined) {
      updateData.hsn_code = hsnCode.trim() || null;
    }

    const supabase = createClient()
    const { data, error } = await supabase
      .from('categories')
      .update(updateData)
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

export async function getCategoriesAction() {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('categories')
      .select('id, name, hsn_code')
      .order('name', { ascending: true });
    if (error) throw error;
    return { success: true, data: data || [] };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to load categories', data: [] };
  }
}

