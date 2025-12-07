import { NextRequest, NextResponse } from 'next/server';
import { generateRandomSchedule } from '@/app/lib/scheduler';
import supabaseServer from '@/app/lib/supabaseServer';
import { FIXED_RULES } from '@/app/lib/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const started = Date.now();
    const sb = supabaseServer();
    // Get current settings
    const { data } = await sb.from('settings').select('key,value');
    const map = Object.fromEntries((data ?? []).map((r: any) => [r.key, r.value]));
    const year = map.year ? Number(map.year) : undefined;
    const month = map.month ? Number(map.month) : undefined;
    const coverageMorning = map.coverageMorning ? Number(map.coverageMorning) : 0;
    const coverageEvening = map.coverageEvening ? Number(map.coverageEvening) : 0;

    let body: any = {};
    try { body = await req.json(); } catch {}

    const finalYear = body.year ?? year;
    const finalMonth = body.month ?? month;

    if (!finalYear || !finalMonth) {
      return NextResponse.json({ error: 'Settings must include year and month' }, { status: 400 });
    }

    // Server-side timeout guard (60s)
    const timeoutMs = 60000;
    const timeoutPromise = new Promise((_, reject) => {
      const t = setTimeout(() => {
        clearTimeout(t);
        reject(new Error('Server timeout: generation exceeded 25s'));
      }, timeoutMs);
    });

    const runGeneration = async () => {
      // Ensure month row exists for this year/month
      const { data: monthRow, error: monthErr } = await sb
        .from('months')
        .upsert({ year: Number(finalYear), month: Number(finalMonth), seed: FIXED_RULES.seed }, { onConflict: 'year,month' })
        .select('*')
        .single();
      if (monthErr) throw monthErr;

      // Load employees
      const { data: employees, error: empErr } = await sb
        .from('employees')
        .select('id, code, name, employment_type, allowed_shifts, preferred_days_off');
      if (empErr) throw empErr;

      const emps = (employees ?? []) as any[];

      // Compute previous year/month
      let prevYear = Number(finalYear);
      let prevMonth = Number(finalMonth) - 1;
      if (prevMonth < 1) {
        prevMonth = 12;
        prevYear -= 1;
      }

      // Map from employee_id -> last working shift (Morning/Evening) in the last week of the previous month
      const prevLastWeekShiftByEmp: Record<string, 'Morning' | 'Evening'> = {};

      // Try to load previous month assignments if a month row exists
      const { data: prevMonthRow } = await sb
        .from('months')
        .select('id, year, month')
        .eq('year', prevYear)
        .eq('month', prevMonth)
        .maybeSingle();

      if (prevMonthRow) {
        const { data: prevAssignments } = await sb
          .from('assignments')
          .select('employee_id, date, symbol')
          .eq('month_id', prevMonthRow.id)
          .order('date', { ascending: true });

        if (prevAssignments && prevAssignments.length > 0) {
          // Determine the last 7 calendar days of the previous month
          const lastDay = new Date(prevYear, prevMonth, 0).getDate();
          const lastWeekStartDay = Math.max(1, lastDay - 6);

          const isInLastWeek = (iso: string) => {
            const [yStr, mStr, dStr] = iso.split('-');
            const d = Number(dStr);
            return d >= lastWeekStartDay && d <= lastDay;
          };

          // For each employee, track last working assignment (Morning/Evening) in that last week
          const lastByEmp = new Map<string, { date: string; shift: 'Morning' | 'Evening' }>();

          const classifyShift = (symbol: string): 'Morning' | 'Evening' | null => {
            const upper = symbol.toUpperCase();
            if (!upper || upper === 'O' || upper === 'V' || upper === 'B') return null;
            // Heuristic: symbols starting with 'M' are Morning, 'E' are Evening
            if (upper.startsWith('M')) return 'Morning';
            if (upper.startsWith('E')) return 'Evening';
            return null;
          };

          for (const a of prevAssignments as any[]) {
            const iso = a.date as string;
            if (!isInLastWeek(iso)) continue;
            const shift = classifyShift(String(a.symbol ?? ''));
            if (!shift) continue;
            const prev = lastByEmp.get(a.employee_id);
            if (!prev || iso > prev.date) {
              lastByEmp.set(a.employee_id, { date: iso, shift });
            }
          }

          for (const [empId, info] of lastByEmp.entries()) {
            prevLastWeekShiftByEmp[empId] = info.shift;
          }
        }
      }

      // Generate schedule rows using the new pure weekly-random generator
      // Use a per-call seed so each POST can yield a different schedule
      const runtimeSeed = `${Date.now()}-${Math.random()}`;
      const rows = generateRandomSchedule({
        employees: emps as any,
        monthId: monthRow.id,
        year: Number(finalYear),
        month: Number(finalMonth),
        coverageMorning,
        coverageEvening,
        seed: runtimeSeed,
        prevLastWeekShiftByEmp,
      });

      // Replace existing assignments for this month
      await sb.from('assignments').delete().eq('month_id', monthRow.id);
      if (rows.length > 0) {
        const BATCH = 500;
        for (let i = 0; i < rows.length; i += BATCH) {
          const chunk = rows.slice(i, i + BATCH);
          const { error: insErr } = await sb.from('assignments').insert(chunk as any);
          if (insErr) throw insErr;
        }
      }

      return { ok: true, generated: rows.length, coverageMorning, coverageEvening };
    };

    const result = await Promise.race([
      runGeneration(),
      timeoutPromise,
    ]) as any;

    const durationMs = Date.now() - started;
    return NextResponse.json({ ...(result ?? {}), durationMs });
  } catch (e: any) {
    const isTimeout = /timeout/i.test(String(e?.message || ''));
    const status = isTimeout ? 504 : 500;
    return NextResponse.json({ error: e.message ?? 'Unknown error' }, { status });
  }
}
