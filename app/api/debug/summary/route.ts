import { NextResponse } from 'next/server';
import supabaseServer from '@/app/lib/supabaseServer';

export async function GET() {
  try {
    const sb = supabaseServer();

    // جلب الإعدادات العامة
    const { data: settings } = await sb.from('settings').select('key,value');
    const map = Object.fromEntries((settings ?? []).map((r: any) => [r.key, r.value]));
    const year = map.year ? Number(map.year) : undefined;
    const month = map.month ? Number(map.month) : undefined;
    
    // Coverage settings
    const coverageMorning = Number(map.coverageMorning || map.coveragemorning) || 5;
    const coverageEvening = Number(map.coverageEvening || map.coverageevening) || 6;

    const out: any = { 
      year, 
      month,
      coverageMorning,
      coverageEvening,
      allSettings: map
    };

    // تعريف نوع Month
    type Month = {
      id: string;
      year: number;
      month: number;
    };

    // جلب بيانات الشهور
    const { data: monthsRaw } = await sb
      .from('months')
      .select('id,year,month')
      .eq('year', year || 0)
      .eq('month', month || 0)
      .order('id', { ascending: false });

    // هنا نجبر TypeScript على فهم النوع
    const months: Month[] = (monthsRaw as Month[]) || [];

    // استخراج أول شهر (إن وجد)
    const monthId: string | null = months.length > 0 ? months[0].id : null;
    out.monthRows = months;
    out.monthId = monthId;

    // عدد الموظفين
    const { count: empCount } = await sb
      .from('employees')
      .select('id', { count: 'exact', head: true });
    out.employees = empCount || 0;

    // عدد التعيينات
    if (monthId) {
      const { count: assignCount } = await sb
        .from('assignments')
        .select('employee_id', { count: 'exact', head: true })
        .eq('month_id', monthId);
      out.assignments = assignCount || 0;
    } else {
      out.assignments = 0;
    }

    // إرجاع النتيجة
    return NextResponse.json(out);

  } catch (e: any) {
    console.error('Error in /api/debug/summary:', e);
    return NextResponse.json({ error: e.message ?? 'Unknown error' }, { status: 500 });
  }
}
