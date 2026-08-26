'use server'

import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { DashboardActionResult, DashboardMetrics } from '@/types/dashboard'

const dateRangeSchema = z.object({
  start_date: z.string().datetime({ message: 'Invalid start date format (ISO 8601 required)' }),
  end_date: z.string().datetime({ message: 'Invalid end date format (ISO 8601 required)' })
}).refine((data) => new Date(data.start_date) <= new Date(data.end_date), {
  message: 'Start date must be before or equal to end date',
  path: ['start_date']
});

export async function getDashboardMetricsAction(payload: unknown): Promise<DashboardActionResult> {
  try {
    const parsed = dateRangeSchema.safeParse(payload);
    if (!parsed.success) {
      const errorMsg = parsed.error.issues.map((i) => i.message).join('. ');
      return { success: false, error: errorMsg };
    }

    const supabase = createClient();
    
    const { data, error } = await supabase.rpc('get_dashboard_metrics', {
      p_start_date: parsed.data.start_date,
      p_end_date: parsed.data.end_date
    });

    if (error) {
      return { success: false, error: error.message };
    }
    
    return { success: true, data: data as DashboardMetrics };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'An unexpected error occurred while fetching metrics';
    return { success: false, error: message };
  }
}
