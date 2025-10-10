import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  const env = {
    SUPABASE_URL: process.env.SUPABASE_URL ? 'set' : 'missing',
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY ? 'set' : 'missing',
    SUPABASE_SERVICE_ROLE: process.env.SUPABASE_SERVICE_ROLE ? 'set' : 'missing',
    NODE_ENV: process.env.NODE_ENV || 'unknown',
  };
  return Response.json({ ok: true, env });
}
