'use server'

import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';

const reportsQuerySchema = z.object({
  start_date: z.string().datetime({ message: 'Invalid start date format' }),
  end_date: z.string().datetime({ message: 'Invalid end date format' })
}).refine(data => new Date(data.start_date) <= new Date(data.end_date), {
  message: 'Start date cannot be after end date',
  path: ['start_date']
});

export async function getReportsAction(start_date: string, end_date: string) {
  try {
    const parsed = reportsQuerySchema.safeParse({ start_date, end_date });
    if (!parsed.success) {
      const errorMsg = parsed.error.issues.map(i => i.message).join('. ');
      return { success: false, error: errorMsg };
    }

    const supabase = createClient();
    const { data, error } = await supabase.rpc('get_comprehensive_reports', {
      p_start_date: parsed.data.start_date,
      p_end_date: parsed.data.end_date
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data };
  } catch (err: unknown) {
    return { 
      success: false, 
      error: err instanceof Error ? err.message : 'An unexpected error occurred while fetching reports' 
    };
  }
}
