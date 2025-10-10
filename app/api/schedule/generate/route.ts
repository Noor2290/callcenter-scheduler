import { NextRequest, NextResponse } from 'next/server';
import { generateSchedule } from '@/app/lib/scheduler';
import supabaseServer from '@/app/lib/supabaseServer';

export async function POST(req: NextRequest) {
  try {
    const sb = supabaseServer();
    // Get current settings
    const { data } = await sb.from('settings').select('key,value');
    const map = Object.fromEntries((data ?? []).map((r: any) => [r.key, r.value]));
    const year = map.year ? Number(map.year) : undefined;
    const month = map.month ? Number(map.month) : undefined;
    const useBetween = map.useBetween ? map.useBetween === 'true' : false;

    let body: any = {};
    try { body = await req.json(); } catch {}

    const finalYear = body.year ?? year;
    const finalMonth = body.month ?? month;
    const finalUseBetween = body.useBetween ?? useBetween;
    const finalSeed = body.seed;

    if (!finalYear || !finalMonth) {
      return NextResponse.json({ error: 'Settings must include year and month' }, { status: 400 });
    }

    const result = await generateSchedule({ year: Number(finalYear), month: Number(finalMonth), useBetween: !!finalUseBetween, seed: finalSeed });
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Unknown error' }, { status: 500 });
  }
}
