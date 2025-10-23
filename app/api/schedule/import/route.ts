import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import supabaseServer from '@/app/lib/supabaseServer';
import { generateSchedule } from '@/app/lib/scheduler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    const autoNext = String(form.get('autoGenerateNext') ?? 'false').toLowerCase() === 'true';

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    }

    // Read workbook
    const ab = await file.arrayBuffer();
    const wb = new ExcelJS.Workbook();
    const buf = Buffer.from(new Uint8Array(ab));
    await wb.xlsx.load(buf as any);
    const ws = wb.worksheets[0];
    if (!ws) return NextResponse.json({ error: 'No worksheet found' }, { status: 400 });

    // Detect year/month from sheet name: CALL CENTER Y-M
    let year: number | undefined;
    let month: number | undefined;
    const m = /CALL\s*CENTER\s*(\d{4})[-\/](\d{1,2})/i.exec(ws.name);
    if (m) {
      year = Number(m[1]);
      month = Number(m[2]);
    }
    if (!year || !month) {
      // try to scan the header cells for Month/Year numeric values
      outer: for (let r = 1; r <= Math.min(ws.rowCount, 25); r++) {
        const row = ws.getRow(r);
        for (let c = 1; c <= Math.min(ws.columnCount, 40); c++) {
          const v = row.getCell(c).value as any;
          if (typeof v === 'number' && v >= 1 && v <= 12 && !month) month = v;
          if (typeof v === 'number' && v >= 2000 && v <= 2100 && !year) year = v;
          if (year && month) break outer;
        }
      }
    }
    if (!year || !month) return NextResponse.json({ error: 'Could not detect year/month' }, { status: 400 });

    const sb = supabaseServer();
    // Ensure month row
    const { data: monthRow, error: mErr } = await sb
      .from('months')
      .upsert({ year, month }, { onConflict: 'year,month' })
      .select('id')
      .single();
    if (mErr) throw mErr;

    // Load employees (id, code, name)
    const { data: emps, error: eErr } = await sb
      .from('employees')
      .select('id, code, name');
    if (eErr) throw eErr;
    const byCode = new Map<string, string>();
    const byName = new Map<string, string>();
    const norm = (s: any) => String(s ?? '')
      .replace(/[\u200E\u200F\u202A-\u202E]/g, '') // strip RTL/LTR markers
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    for (const e of emps ?? []) {
      if (e.code) byCode.set(String(e.code).trim(), e.id);
      if ((e as any).name) byName.set(norm((e as any).name), e.id);
    }

    // Determine month days
    const daysInMonth = new Date(year, month, 0).getDate();

    // Parse grid: rows with name in col1 and code (ID) in col2, then day columns start at 3
    const ALWAYS_EVENING_ID = '3979';
    const rows: { employee_id: string; date: string; symbol: string; code: string }[] = [];
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const nameVal = row.getCell(1).value as any;
      const codeVal = row.getCell(2).value as any;
      const codeStr = typeof codeVal === 'number' ? String(codeVal) : String(codeVal || '').trim();
      let empId = byCode.get(codeStr);
      if (!empId) {
        const nameStr = norm(nameVal);
        if (nameStr) empId = byName.get(nameStr);
      }
      if (!empId) continue; // skip rows that don't map to an employee
      for (let d = 1; d <= daysInMonth; d++) {
        const c = 2 + d;
        const v = row.getCell(c).value as any;
        let symbol = (typeof v === 'string' ? v : (typeof v === 'number' ? String(v) : '')).toString().trim().toUpperCase();
        // Force Tooq Almalki to Evening on import as well
        if (empId === ALWAYS_EVENING_ID) {
          if (symbol && symbol !== 'O' && symbol !== 'V' && symbol !== 'B') {
            if (symbol.startsWith('M')) symbol = 'EA1';
          }
        }
        const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        rows.push({ employee_id: empId, date, symbol, code: symbol });
      }
    }

    // Replace assignments EXACTLY: first delete all for this month, then insert
    await sb.from('assignments').delete().eq('month_id', monthRow.id);
    if (rows.length > 0) {
      const BATCH = 500;
      for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH).map((r) => ({ ...r, month_id: monthRow.id }));
        const { error: insErr } = await sb.from('assignments').insert(chunk as any);
        if (insErr) throw insErr;
      }
    }

    // Optionally auto-generate next month with inversion
    let nextGen: any = undefined;
    if (autoNext) {
      // read useBetween setting for next generation behavior
      const { data: srows } = await sb.from('settings').select('key,value');
      const smap = Object.fromEntries((srows ?? []).map((r: any) => [r.key, r.value]));
      const useBetween = (smap.useBetweenShift ?? smap.useBetween) ? ((smap.useBetweenShift ?? smap.useBetween) === 'true') : false;
      let nextYear = year;
      let nextMonth = month + 1;
      if (nextMonth > 12) { nextMonth = 1; nextYear += 1; }
      nextGen = await generateSchedule({ year: nextYear, month: nextMonth, useBetween, invertFirstWeek: true });
    }

    return NextResponse.json({ ok: true, imported: rows.length, year, month, nextGenerated: !!nextGen });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Import failed' }, { status: 500 });
  }
}
