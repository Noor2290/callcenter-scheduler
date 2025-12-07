import { NextRequest, NextResponse } from 'next/server';
import { generateSchedule } from '@/app/lib/scheduler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const started = Date.now();

    let body: any = {};
    try {
      body = await req.json();
    } catch {}

    const finalYear = body.year;
    const finalMonth = body.month;

    if (!finalYear || !finalMonth) {
      return NextResponse.json({ error: 'Request body must include year and month' }, { status: 400 });
    }

    const result = await generateSchedule({
      year: Number(finalYear),
      month: Number(finalMonth),
    });

    const durationMs = Date.now() - started;
    return NextResponse.json({ ...(result ?? {}), durationMs });
  } catch (e: any) {
    const isTimeout = /timeout/i.test(String(e?.message || ''));
    const status = isTimeout ? 504 : 500;
    return NextResponse.json({ error: e.message ?? 'Unknown error' }, { status });
  }
}
