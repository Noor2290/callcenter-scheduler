import { NextRequest, NextResponse } from 'next/server';
import supabaseServer from '@/app/lib/supabaseServer';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const items = (body?.items ?? []) as any[];
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'No items provided' }, { status: 400 });
    }

    const toISO = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    const expandVacationRange = (start: string, end: string) => {
      const out: string[] = [];
      const s = new Date(start + 'T00:00:00');
      const e = new Date(end + 'T00:00:00');
      if (isNaN(s.getTime()) || isNaN(e.getTime())) return out;
      if (s.getTime() > e.getTime()) return out;
      const cur = new Date(s);
      while (cur.getTime() <= e.getTime()) {
        out.push(toISO(cur));
        cur.setDate(cur.getDate() + 1);
      }
      return out;
    };

    const normalized: { employee_id: string; date: string; type: 'Vacation' | 'OffRequest' }[] = [];
    for (const e of items) {
      const employee_id = e.employee_id;
      const type = e.type as 'Vacation' | 'OffRequest';
      if (!employee_id || !type) {
        return NextResponse.json({ error: 'Each item requires employee_id and type' }, { status: 400 });
      }
      if (type === 'Vacation') {
        if (e.start && e.end) {
          const days = expandVacationRange(e.start, e.end);
          if (days.length === 0) {
            return NextResponse.json({ error: 'Invalid vacation range' }, { status: 400 });
          }
          for (const d of days) normalized.push({ employee_id, date: d, type });
        } else if (e.date) {
          normalized.push({ employee_id, date: e.date, type });
        } else {
          return NextResponse.json({ error: 'Vacation requires date or start/end' }, { status: 400 });
        }
      } else if (type === 'OffRequest') {
        if (!e.date) {
          return NextResponse.json({ error: 'OffRequest requires date' }, { status: 400 });
        }
        normalized.push({ employee_id, date: e.date, type });
      } else {
        return NextResponse.json({ error: 'Unknown type' }, { status: 400 });
      }
    }

    const sb = supabaseServer();
    const { error } = await (sb as any).from('requests').insert(normalized as any);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Unknown error' }, { status: 500 });
  }
}
