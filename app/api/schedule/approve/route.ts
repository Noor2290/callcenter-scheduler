import { NextRequest, NextResponse } from 'next/server';
import supabaseServer from '@/app/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const year = Number(body.year);
    const month = Number(body.month);
    if (!year || !month) return NextResponse.json({ error: 'year and month required' }, { status: 400 });

    const key = `approved:${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}`;

    const sb = supabaseServer();
    const { error } = await (sb as any).from('settings').upsert([{ key, value: 'true' }], { onConflict: 'key' });
    if (error) throw error;

    return NextResponse.json({ ok: true, key });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Unknown error' }, { status: 500 });
  }
}
