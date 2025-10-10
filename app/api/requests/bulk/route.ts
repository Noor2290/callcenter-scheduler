import { NextRequest, NextResponse } from 'next/server';
import supabaseServer from '@/app/lib/supabaseServer';

// Bulk insert requests. Accepts items: [{ employee_id, date(YYYY-MM-DD), type('Vacation'|'OffRequest') }]
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const items = (body?.items ?? []) as any[];
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'No items provided' }, { status: 400 });
    }

    const normalized = items.map((e) => ({
      employee_id: e.employee_id,
      date: e.date,
      type: e.type,
    }));

    if (normalized.some((n) => !n.employee_id || !n.date || !n.type)) {
      return NextResponse.json({ error: 'Each item requires employee_id, date, type' }, { status: 400 });
    }

    const sb = supabaseServer();
    const { error } = await sb.from('requests').insert(normalized);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Unknown error' }, { status: 500 });
  }
}
