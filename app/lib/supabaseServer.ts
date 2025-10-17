import { createClient } from '@supabase/supabase-js';

// Server-side Supabase client (singleton). Prefer service role if provided, otherwise fallback to anon.
const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL) as string;
const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE) as string | undefined;
const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY) as string | undefined;

let _client: ReturnType<typeof createClient> | null = null;

export function supabaseServer() {
  if (_client) return _client;
  const key = serviceKey ?? anonKey ?? '';
  const missing: string[] = [];
  if (!supabaseUrl) missing.push('NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL');
  if (!key) missing.push('SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SERVICE_ROLE or NEXT_PUBLIC_SUPABASE_ANON_KEY/SUPABASE_ANON_KEY');
  if (missing.length) {
    throw new Error(`Supabase env not set: missing ${missing.join(', ')}`);
  }
  _client = createClient(supabaseUrl, key, {
    auth: { persistSession: false },
    global: { headers: { 'X-Client-Info': 'scheduler-server' } },
  });
  return _client;
}

export default supabaseServer;
