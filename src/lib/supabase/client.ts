import { createBrowserClient } from '@supabase/ssr'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Missing required Supabase environment variables: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be defined.'
  );
}

const supabaseUrl: string = SUPABASE_URL;
const supabaseAnonKey: string = SUPABASE_ANON_KEY;

export function createClient() {
  return createBrowserClient(
    supabaseUrl,
    supabaseAnonKey
  )
}
