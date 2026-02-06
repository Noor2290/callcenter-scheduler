import { NextRequest, NextResponse } from 'next/server';
import { generateSchedule } from '@/app/lib/scheduler';
import supabaseServer from '@/app/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/schedule/generate
 * 
 * Body:
 * - year: number (required)
 * - month: number (required)
 * - preview: boolean (optional, default: false) - إذا true لا يحفظ في DB
 * - seed: number (optional) - seed عشوائي لتوليد جداول مختلفة
 * - save: boolean (optional) - إذا true يحفظ الجدول الحالي
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
    let firstWeekShifts: Record<string, 'Morning' | 'Evening'> | undefined = body.firstWeekShifts;
    let lastWeekShifts: Record<string, 'Morning' | 'Evening'> | undefined = body.lastWeekShifts;
    
    console.log(`[generate] body.firstWeekShifts:`, body.firstWeekShifts ? Object.keys(body.firstWeekShifts).length + ' employees' : 'undefined');
    console.log(`[generate] body.lastWeekShifts:`, body.lastWeekShifts ? Object.keys(body.lastWeekShifts).length + ' employees' : 'undefined');
    
    // إذا تم تمرير firstWeekShifts من الواجهة، نستخدمه لتثبيت أول أسبوع
    if (firstWeekShifts && Object.keys(firstWeekShifts).length > 0) {
      console.log(`[generate] ✅ Using firstWeekShifts from request body:`, Object.keys(firstWeekShifts).length, 'employees');
    }
    
    // إذا تم تمرير lastWeekShifts من الواجهة، نستخدمه لتثبيت آخر أسبوع
    if (lastWeekShifts && Object.keys(lastWeekShifts).length > 0) {
      console.log(`[generate] ✅ Using lastWeekShifts from request body:`, Object.keys(lastWeekShifts).length, 'employees');
    }
    
    // إذا لم يتم تمرير firstWeekShifts، نحاول جلبها من الشهر السابق في DB
    if ((!firstWeekShifts || Object.keys(firstWeekShifts).length === 0) && prevMonthRow) {
      // جلب assignments الشهر السابق
      const { data: prevAssignments } = await sb
        .from('assignments')
        .select('employee_id, date, symbol')
        .eq('month_id', prevMonthRow.id)
        .order('date', { ascending: true });

      if (prevAssignments && prevAssignments.length > 0) {
        // استخراج آخر 7 تواريخ فعلية
        const allDates = Array.from(new Set(prevAssignments.map(a => a.date))).sort();
        const lastWeekDates = allDates.slice(-7);

        // جلب الموظفات
        const { data: emps } = await sb.from('employees').select('id');

        lastWeekShifts = {};
        for (const emp of emps ?? []) {
          const empId = String(emp.id);
          for (let i = lastWeekDates.length - 1; i >= 0; i--) {
            const d = lastWeekDates[i];
            const row = prevAssignments.find(r => String(r.employee_id) === empId && r.date === d);
            if (!row) continue;
            const symbol = (row.symbol || '').toUpperCase();
            // Morning shifts: MA1, MA2, M2, PT4
            if (symbol.startsWith('M') || symbol === 'PT4') {
              lastWeekShifts[empId] = 'Morning';
              break;
            }
            // Evening shifts: EA1, E5, E2, MA4, PT5
            if (symbol.startsWith('E') || symbol === 'PT5' || symbol === 'MA4') {
              lastWeekShifts[empId] = 'Evening';
              break;
            }
          }
        }
        console.log(`[generate] lastWeekShifts from ${prevYear}-${prevMonth}:`, Object.keys(lastWeekShifts).length, 'employees');
        console.log(`[generate] lastWeekDates:`, lastWeekDates);
        console.log(`[generate] Sample shifts:`, Object.entries(lastWeekShifts).slice(0, 5));
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
    console.log(`  - weekStartDay: ${weekStartDay}`);
    
    const result = await generateSchedule({
      year: Number(finalYear),
      month: Number(finalMonth),
      preview,
      seed: Number(seed),
      firstWeekShifts,  // شفتات أول أسبوع (للتثبيت إذا كان هناك أسبوع مشترك)
      lastWeekShifts,   // شفتات آخر أسبوع (للتثبيت إذا كان هناك أسبوع مشترك)
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
