import { NextResponse } from 'next/server';
import supabaseServer from '@/app/lib/supabaseServer';

export async function GET() {
  try {
    const sb = supabaseServer();
    const { data: settings } = await sb.from('settings').select('key,value');
    const map = Object.fromEntries((settings ?? []).map((r: any) => [r.key, r.value]));
    const year = map.year ? Number(map.year) : undefined;
    const month = map.month ? Number(map.month) : undefined;

    const out: any = { year, month };

    const { data: months } = await sb
      .from('months')
      .select('id,year,month')
      .eq('year', year || 0)
      .eq('month', month || 0)
      .order('id', { ascending: false });
    out.monthRows = months || [];

    const monthId = months && months.length ? months[0].id : null;
    out.monthId = monthId;

    const { count: empCount } = await sb.from('employees').select('id', { count: 'exact', head: true });
    out.employees = empCount || 0;

    if (monthId) {
      const { count: assignCount } = await sb
        .from('assignments')
        .select('employee_id', { count: 'exact', head: true })
        .eq('month_id', monthId);
      out.assignments = assignCount || 0;
    } else {
      out.assignments = 0;
    }

    return NextResponse.json(out);
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Unknown error' }, { status: 500 });
  }
}
