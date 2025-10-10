import { createClient } from '@supabase/supabase-js';

// Public client for browser usage. Uses anon key only.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  // Do not throw at import time in the browser; log to help diagnose
  // eslint-disable-next-line no-console
  console.warn('Supabase env not set: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

export const supabaseClient = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '');

export default supabaseClient;
