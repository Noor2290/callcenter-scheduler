import { NextRequest, NextResponse } from 'next/server';
import { generateSchedule } from '@/app/lib/scheduler';
import supabaseServer from '@/app/lib/supabaseServer';
import { format } from 'date-fns';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/schedule/generate - Enterprise Clean System
 * 
 * Body:
 * - year: number (required)
 * - month: number (required)
 * - preview: boolean (optional, default: true) - إذا true لا يحفظ في DB
 * - seed: number (optional) - seed للتنويع الذكي
 * - variationStrategy: string (optional) - استراتيجية التنويع
 * - variationOffset: number (optional) - معامل التنويع
 * - firstWeekShifts: object (optional) - شفتات أول أسبوع للاستمرارية
 * - lastWeekShifts: object (optional) - شفتات آخر أسبوع للاستمرارية
 */
export async function POST(req: NextRequest) {
  try {
    const started = Date.now();
    const sb = supabaseServer();

    let body: any = {};
    try {
      body = await req.json();
    } catch {}

    const finalYear = body.year;
    const finalMonth = body.month;
    const preview = body.preview ?? true;  // افتراضياً preview mode
    const seed = body.seed ?? Date.now();  // seed عشوائي جديد كل مرة

    if (!finalYear || !finalMonth) {
      return NextResponse.json({ error: 'Request body must include year and month' }, { status: 400 });
    }

    // ═══════════════════════════════════════════════════════════════════
    // جلب lastWeekShifts من الشهر السابق لضمان استمرار الشفت عبر حدود الشهر
    // ═══════════════════════════════════════════════════════════════════
    let prevYear = Number(finalYear);
    let prevMonth = Number(finalMonth) - 1;
    if (prevMonth < 1) { prevMonth = 12; prevYear -= 1; }

    // جلب سجل الشهر السابق
    console.log(`[generate] Looking for previous month: ${prevYear}-${prevMonth}`);
    const { data: prevMonthRow, error: prevMonthErr } = await sb
      .from('months')
      .select('id')
      .eq('year', prevYear)
      .eq('month', prevMonth)
      .single();

    console.log(`[generate] prevMonthRow:`, prevMonthRow, 'error:', prevMonthErr?.message);

    // ═══════════════════════════════════════════════════════════════════
    // استقبال شفتات أول وآخر أسبوع من الواجهة (للحفاظ على الأسابيع المشتركة)
    // ═══════════════════════════════════════════════════════════════════
    const firstWeekShifts: Record<string, 'Morning' | 'Evening'> | undefined = body.firstWeekShifts;
    const lastWeekShifts: Record<string, 'Morning' | 'Evening'> | undefined = body.lastWeekShifts;
    
    console.log(`[generate] body.firstWeekShifts:`, firstWeekShifts ? Object.keys(firstWeekShifts).length + ' employees' : 'undefined');
    console.log(`[generate] body.lastWeekShifts:`, lastWeekShifts ? Object.keys(lastWeekShifts).length + ' employees' : 'undefined');

    // ═══════════════════════════════════════════════════════════════════
    // 🔒 HARD RULE: استمرارية الشفت عبر نهاية الشهر
    // دائماً نجلب الشهر السابق من DB كمصدر موثوق مستقل عن الـ UI
    // ═══════════════════════════════════════════════════════════════════
    let prevMonthLastWeekShifts: Record<string, 'Morning' | 'Evening'> | undefined = undefined;

    if (prevMonthRow) {
      const { data: prevAssignments } = await sb
        .from('assignments')
        .select('employee_id, date, symbol')
        .eq('month_id', prevMonthRow.id)
        .order('date', { ascending: true });

      if (prevAssignments && prevAssignments.length > 0) {
        const allPrevDates = Array.from(new Set(prevAssignments.map((a: {date: string}) => a.date))).sort() as string[];
        
        // إيجاد أسبوع العمل الأخير الفعلي (السبت → الخميس)
        // نبحث عن آخر سبت قبل أو في آخر يوم من الشهر السابق
        const lastDateStr = allPrevDates[allPrevDates.length - 1];
        const lastDate = new Date(lastDateStr);
        const lastWeekStartDate = new Date(lastDate);
        while (lastWeekStartDate.getDay() !== 6) { // 6 = Saturday
          lastWeekStartDate.setDate(lastWeekStartDate.getDate() - 1);
        }
        const lastWeekStartISO = format(lastWeekStartDate, 'yyyy-MM-dd');
        const lastWorkWeekDates = allPrevDates.filter(d => d >= lastWeekStartISO);

        const { data: emps } = await sb.from('employees').select('id');
        prevMonthLastWeekShifts = {};
        for (const emp of emps ?? []) {
          const empId = String(emp.id);
          for (let i = lastWorkWeekDates.length - 1; i >= 0; i--) {
            const d = lastWorkWeekDates[i];
            const row = prevAssignments.find((r: {employee_id: string; date: string; symbol: string}) => 
              String(r.employee_id) === empId && r.date === d
            );
            if (!row) continue;
            const symbol = (row.symbol || '').toUpperCase();
            if (symbol.startsWith('M') || symbol === 'PT4') {
              prevMonthLastWeekShifts[empId] = 'Morning'; break;
            }
            if (symbol.startsWith('E') || symbol === 'PT5' || symbol === 'MA4') {
              prevMonthLastWeekShifts[empId] = 'Evening'; break;
            }
          }
        }
        console.log(`[generate] 🔒 prevMonthLastWeekShifts from ${prevYear}-${prevMonth}:`, Object.keys(prevMonthLastWeekShifts).length, 'employees');
        console.log(`[generate] lastWorkWeekDates (${lastWeekStartISO} onwards):`, lastWorkWeekDates);
        console.log(`[generate] Sample:`, Object.entries(prevMonthLastWeekShifts).slice(0, 5));
      }
    }

    // جلب weekStartDay من الإعدادات
    const { data: settingsData } = await sb.from('settings').select('key, value');
    let weekStartDay = 6; // السبت افتراضياً
    if (settingsData) {
      for (const s of settingsData) {
        if (s.key === 'weekStartDay') weekStartDay = Number(s.value);
      }
    }

    console.log(`[generate] Calling generateSchedule with:`);
    console.log(`  - year: ${finalYear}, month: ${finalMonth}`);
    console.log(`  - firstWeekShifts: ${firstWeekShifts ? Object.keys(firstWeekShifts).length + ' employees' : 'undefined'}`);
    console.log(`  - lastWeekShifts: ${lastWeekShifts ? Object.keys(lastWeekShifts).length + ' employees' : 'undefined'}`);
    console.log(`  - prevMonthLastWeekShifts: ${prevMonthLastWeekShifts ? Object.keys(prevMonthLastWeekShifts).length + ' employees' : 'undefined'}`);
    console.log(`  - weekStartDay: ${weekStartDay}`);
    
    const result = await generateSchedule({
      year: Number(finalYear),
      month: Number(finalMonth),
      preview,
      seed: Number(seed),
      firstWeekShifts,           // شفتات أول أسبوع (لحفظ التوزيع عند إعادة التوليد)
      lastWeekShifts,            // شفتات آخر أسبوع (لحفظ التوزيع عند إعادة التوليد)
      prevMonthLastWeekShifts,   // 🔒 HARD RULE: شفتات الشهر السابق (مصدر مستقل من DB)
      weekStartDay
    });

    const durationMs = Date.now() - started;
    return NextResponse.json({ ...(result ?? {}), durationMs });
  } catch (e: any) {
    const isTimeout = /timeout/i.test(String(e?.message || ''));
    const status = isTimeout ? 504 : 500;
    return NextResponse.json({ error: e.message ?? 'Unknown error' }, { status });
  }
}
