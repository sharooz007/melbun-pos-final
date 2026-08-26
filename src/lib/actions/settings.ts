'use server'

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { StoreSettings } from '@/types/settings';

const updateSettingsSchema = z.object({
  store_name: z.string().trim().min(1, 'Store name is required').max(150, 'Store name cannot exceed 150 characters'),
  tagline: z.string().trim().max(200).optional().nullable(),
  address: z.string().trim().max(500).optional().nullable(),
  phone: z.string().trim().max(50).optional().nullable(),
  email: z.string().trim().email('Invalid email address').max(100).optional().nullable().or(z.literal('')),
  gstin: z.string().trim().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$|^$/, 'Invalid GSTIN format: Must be 15 uppercase alphanumeric characters (e.g. 29AAAAA0000A1Z5)').optional().nullable().or(z.literal('')),
  business_day_start_hour: z.coerce.number().int().min(0, 'Start hour must be between 0 and 23').max(23, 'Start hour must be between 0 and 23').default(6),
  timezone: z.string().trim().min(1).default('Asia/Kolkata'),
  whatsapp_invoice_template: z.string().trim().max(2000).optional().nullable(),
  whatsapp_due_reminder_template: z.string().trim().max(2000).optional().nullable()
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

export async function getStoreSettingsAction(): Promise<{ success: boolean; data?: StoreSettings; error?: string }> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase.rpc('get_store_settings');
    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true, data: data as StoreSettings };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to retrieve store settings.' };
  }
}

export async function updateStoreSettingsAction(payload: unknown): Promise<{ success: boolean; data?: StoreSettings; error?: string }> {
  try {
    const parsed = updateSettingsSchema.safeParse(payload);
    if (!parsed.success) {
      const errorMsg = parsed.error.issues.map((i) => i.message).join('. ');
      return { success: false, error: errorMsg };
    }

    const supabase = createClient();
    const { data, error } = await supabase.rpc('update_store_settings', {
      p_store_name: parsed.data.store_name,
      p_tagline: parsed.data.tagline || null,
      p_address: parsed.data.address || null,
      p_phone: parsed.data.phone || null,
      p_email: parsed.data.email || null,
      p_gstin: parsed.data.gstin || null,
      p_business_day_start_hour: parsed.data.business_day_start_hour,
      p_timezone: parsed.data.timezone,
      p_whatsapp_invoice_template: parsed.data.whatsapp_invoice_template || null,
      p_whatsapp_due_reminder_template: parsed.data.whatsapp_due_reminder_template || null
    });

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath('/settings');
    revalidatePath('/reports');
    revalidatePath('/dashboard');
    revalidatePath('/pos');
    revalidatePath('/');

    return { success: true, data: data as StoreSettings };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to update store settings.' };
  }
}
