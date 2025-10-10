import { NextResponse } from 'next/server';
import supabaseServer from '@/app/lib/supabaseServer';

export async function GET() {
  try {
    const sb = supabaseServer();
    const { data, error } = await sb
      .from('requests')
      .select('id, employee_id, date, type')
      .order('date', { ascending: true });
    if (error) throw error;
    return NextResponse.json({ items: data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Unknown error' }, { status: 500 });
  }
}
