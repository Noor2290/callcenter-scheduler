import { NextResponse } from 'next/server';
import supabaseServer from '@/app/lib/supabaseServer';

export async function GET() {
  try {
    const sb = supabaseServer();
    const { data, error } = await sb
      .from('employees')
      .select('id, code, name, employment_type, allowed_shifts, preferred_days_off')
      .order('name', { ascending: true });
    if (error) throw error;
    return NextResponse.json({ items: data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Unknown error' }, { status: 500 });
  }
}
