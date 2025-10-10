import { createClient } from '@supabase/supabase-js';

// Server-side Supabase client. Prefer service role if provided, otherwise fallback to anon.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string | undefined;

export function supabaseServer() {
  const key = serviceKey ?? anonKey ?? '';
  if (!supabaseUrl || !key) {
    throw new Error('Supabase env not set. Please configure NEXT_PUBLIC_SUPABASE_URL and keys');
  }
  return createClient(supabaseUrl, key);
}

export default supabaseServer;
