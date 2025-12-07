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

      // Generate schedule rows using the new pure weekly-random generator
      const rows = generateRandomSchedule({
        employees: emps as any,
        monthId: monthRow.id,
        year: Number(finalYear),
        month: Number(finalMonth),
        coverageMorning,
        coverageEvening,
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
