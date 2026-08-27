import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://qrezqagiowilpoboupvl.supabase.co';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFyZXpxYWdpb3dpbHBvYm91cHZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4MTM5MDAsImV4cCI6MjEwMzM4OTkwMH0.F67ICnl4giBSST13BQ0I7VqZBuUDO9wbbYz_rVCDYo0';

export function createClient() {
  const cookieStore = cookies()

  return createServerClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
}
