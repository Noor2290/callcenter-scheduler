import { NextRequest, NextResponse } from 'next/server';
import supabaseServer from '@/app/lib/supabaseServer';

// Bulk insert/update employees. Accepts items: [{code?, name, employment_type, allowed_shifts?, preferred_days_off?}]
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const items = (body?.items ?? []) as any[];
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'No items provided' }, { status: 400 });
    }

    const normalized = items.map((e) => ({
      code: e.code ?? null,
      name: String(e.name).trim(),
      employment_type: e.employment_type,
      allowed_shifts: e.allowed_shifts ?? ['Morning','Evening'],
      preferred_days_off: e.preferred_days_off ?? [],
    }));

    if (normalized.some((n) => !n.name || !n.employment_type)) {
      return NextResponse.json({ error: 'Each item requires name and employment_type' }, { status: 400 });
    }

    const sb = supabaseServer();
    const { error } = await sb.from('employees').upsert(normalized, { onConflict: 'code' });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Unknown error' }, { status: 500 });
  }
}
