import { NextRequest, NextResponse } from 'next/server';
import supabaseServer from '@/app/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ year: string; month: string }> }
) {
  try {
    const { year, month } = await context.params;
    const yearNum = Number(year);
    const monthNum = Number(month);
    const sb = supabaseServer();

    // Always load employees
    const { data: emps, error: eErr } = await sb
      .from('employees')
      .select('id, code, name, employment_type')
      .order('name', { ascending: true });
    if (eErr) throw eErr;

    // Try load month (pick the latest row if duplicates exist)
    const { data: monthsRows } = await sb
      .from('months')
      .select('id, year, month')
      .eq('year', yearNum)
      .eq('month', monthNum)
      .order('id', { ascending: false });
    const monthRow = monthsRows && monthsRows.length > 0 ? monthsRows[0] : null;

    if (!monthRow) {
      return NextResponse.json({
        month: { id: null, year: yearNum, month: monthNum },
        employees: emps ?? [],
        assignments: [],
      });
    }

    const { data: assigns, error: aErr } = await sb
      .from('assignments')
      .select('employee_id, date, symbol, code')
      .eq('month_id', monthRow.id);
    if (aErr) throw aErr;

    return NextResponse.json({
      month: { id: monthRow.id, year: yearNum, month: monthNum },
      employees: emps ?? [],
      assignments: assigns ?? [],
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message ?? 'Unknown error' },
      { status: 500 }
    );
  }
}
