import { NextResponse } from 'next/server';
import supabaseServer from '@/app/lib/supabaseServer';

export async function GET() {
  try {
    const sb = supabaseServer();

    // ✅ جلب الإعدادات العامة
    const { data: settings } = await sb.from('settings').select('key,value');
    const map = Object.fromEntries((settings ?? []).map((r: any) => [r.key, r.value]));
    const year = map.year ? Number(map.year) : undefined;
    const month = map.month ? Number(map.month) : undefined;

    const out: any = { year, month };

    // ✅ تعريف نوع البيانات لجدول months
    interface Month {
      id: string;
      year: number;
      month: number;
    }

    // ✅ جلب بيانات الشهر المحدد مع تحديد النوع بشكل صريح
    const { data: monthsRaw } = await sb
      .from('months')
      .select('id,year,month')
      .eq('year', year || 0)
      .eq('month', month || 0)
      .order('id', { ascending: false });

    const months = (monthsRaw ?? []) as Month[];
    out.monthRows = months;

    // ✅ استخراج أول شهر (إن وجد)
    const monthId = months?.[0]?.id ?? null;
    out.monthId = monthId;

    // ✅ عدد الموظفين
    const { count: empCount } = await sb
      .from('employees')
      .select('id', { count: 'exact', head: true });
    out.employees = empCount || 0;

    // ✅ عدد التعيينات في الشهر المحدد (إن وجد)
    if (monthId) {
      const { count: assignCount } = await sb
        .from('assignments')
        .select('employee_id', { count: 'exact', head: true })
        .eq('month_id', monthId);
      out.assignments = assignCount || 0;
    } else {
      out.assignments = 0;
    }

    // ✅ إرجاع البيانات كـ JSON
    return NextResponse.json(out);

  } catch (e: any) {
    console.error('Error in /api/debug/summary:', e);
    return NextResponse.json({ error: e.message ?? 'Unknown error' }, { status: 500 });
  }
}
