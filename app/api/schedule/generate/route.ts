import { NextRequest, NextResponse } from 'next/server';
import { generateRandomSchedule } from '@/app/lib/scheduler';
import supabaseServer from '@/app/lib/supabaseServer';

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
    const useBetween = (map.useBetweenShift ?? map.useBetween) ? ((map.useBetweenShift ?? map.useBetween) === 'true') : false;

    let body: any = {};
    try { body = await req.json(); } catch {}

    const finalYear = body.year ?? year;
    const finalMonth = body.month ?? month;
    const finalUseBetween = (body.useBetweenShift ?? body.useBetween) ?? useBetween;
    const finalSeed = body.seed;

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

    const result = await Promise.race([
      // استخدم المولّد الخفيف الذي ينشئ جدولاً عشوائياً سريعاً للشهر المحدد
      generateRandomSchedule({ year: Number(finalYear), month: Number(finalMonth) }),
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
