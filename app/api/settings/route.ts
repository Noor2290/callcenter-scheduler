import { NextRequest, NextResponse } from 'next/server';
import supabaseServer from '@/app/lib/supabaseServer';

// Persist settings as key/value text rows in `settings` table.
// Known keys: year, month, coverageMorning, coverageEvening, useBetween

function rowsToObject(rows: { key: string; value: string }[]) {
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  return map;
}

function normalizeOut(map: Record<string, string>) {
  return {
    year: map.year ? Number(map.year) : undefined,
    month: map.month ? Number(map.month) : undefined,
    coverageMorning: map.coverageMorning ? Number(map.coverageMorning) : undefined,
    coverageEvening: map.coverageEvening ? Number(map.coverageEvening) : undefined,
    useBetween: map.useBetween ? map.useBetween === 'true' : false, // default false
  };
}

export async function GET() {
  try {
    const supabase = supabaseServer();
    const { data, error } = await supabase.from('settings').select('key,value');
    if (error) throw error;
    const map = rowsToObject(data ?? []);
    return NextResponse.json(normalizeOut(map));
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Unknown error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    // Accept partial updates; only provided keys will be upserted.
    const entries: [string, string][] = [];

    const keys = ['year', 'month', 'coverageMorning', 'coverageEvening', 'useBetween'] as const;
    for (const k of keys) {
      if (k in body) {
        const v = body[k as keyof typeof body];
        if (v === undefined || v === null || v === '') continue;
        entries.push([k, String(v)]);
      }
    }

    if (entries.length === 0) {
      return NextResponse.json({ ok: true });
    }

    const supabase = supabaseServer();
    const rows = entries.map(([key, value]) => ({ key, value }));
    const { error } = await supabase.from('settings').upsert(rows, { onConflict: 'key' });
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Unknown error' }, { status: 500 });
  }
}
