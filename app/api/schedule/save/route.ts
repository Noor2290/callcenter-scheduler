import { NextRequest, NextResponse } from 'next/server';
import supabaseServer from '@/app/lib/supabaseServer';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const year = Number(body.year);
    const month = Number(body.month);
    const changes = (body.changes ?? []) as Array<{ employee_id: string; date: string; symbol: string }>;
    if (!year || !month) return NextResponse.json({ error: 'year and month required' }, { status: 400 });

    const sb = supabaseServer();
    // ensure month row
    const { data: monthRow, error: mErr } = await sb
      .from('months')
      .upsert({ year, month }, { onConflict: 'year,month' })
      .select('id')
      .single();
    if (mErr) throw mErr;

    // sanitize changes
    const rows = changes
      .filter((c) => c.employee_id && c.date)
      .map((c) => ({
        month_id: monthRow.id,
        employee_id: c.employee_id,
        date: c.date,
        symbol: c.symbol?.toUpperCase() || '',
        code: c.symbol?.toUpperCase() || '',
      }));

    if (rows.length === 0) return NextResponse.json({ ok: true, updated: 0 });

    // Upsert by (employee_id, date)
    const { error: upErr } = await sb.from('assignments').upsert(rows, { onConflict: 'employee_id,date' });
    if (upErr) throw upErr;

    return NextResponse.json({ ok: true, updated: rows.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Unknown error' }, { status: 500 });
  }
}
