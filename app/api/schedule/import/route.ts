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
    
    // استخدام السنة والشهر من الإعدادات إذا تم إرسالها
    const settingsYear = form.get('year') ? Number(form.get('year')) : undefined;
    const settingsMonth = form.get('month') ? Number(form.get('month')) : undefined;

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

    // استخدام السنة والشهر من الإعدادات أولاً، وإلا من الملف
    let year: number | undefined = settingsYear;
    let month: number | undefined = settingsMonth;
    
    // إذا لم يتم إرسال السنة/الشهر، حاول قراءتها من اسم الـ Sheet
    if (!year || !month) {
      const m = /CALL\s*CENTER\s*(\d{4})[-\/](\d{1,2})/i.exec(ws.name);
      if (m) {
        if (!year) year = Number(m[1]);
        if (!month) month = Number(m[2]);
      }
    }
    
    // إذا لم نجد، حاول البحث في الخلايا
    if (!year || !month) {
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
      const codeStr = e.code != null ? String(e.code).trim() : '';
      if (codeStr) byCode.set(codeStr, e.id);
      if ((e as any).name) byName.set(norm((e as any).name), e.id);
    }

    // Determine month days
    const daysInMonth = new Date(year, month, 0).getDate();

    // ═══════════════════════════════════════════════════════════════════════
    // البحث عن صف الأيام وتحديد بداية البيانات
    // ═══════════════════════════════════════════════════════════════════════
    let headerRow = -1;
    let nameCol = 1;  // العمود A = الاسم
    let idCol = 2;    // العمود B = ID
    let firstDayCol = 3; // العمود C = أول يوم
    
    // البحث عن صف العناوين (يحتوي على NAME أو DAYS أو أرقام 1,2,3...)
    for (let r = 1; r <= Math.min(ws.rowCount, 20); r++) {
      const row = ws.getRow(r);
      
      // التحقق من وجود كلمة NAME أو DAYS في أي خلية
      for (let c = 1; c <= Math.min(ws.columnCount, 5); c++) {
        const v = String(row.getCell(c).value ?? '').toLowerCase();
        if (v.includes('name') || v.includes('days') || v.includes('اسم')) {
          headerRow = r;
          nameCol = c;
          
          // البحث عن عمود ID (الخلية التالية أو التي تحتوي على ID)
          for (let cc = c; cc <= Math.min(ws.columnCount, c + 3); cc++) {
            const vv = String(row.getCell(cc).value ?? '').toLowerCase();
            if (vv.includes('id') || vv === 'id') {
              idCol = cc;
              break;
            }
          }
          if (idCol <= nameCol) idCol = nameCol + 1;
          break;
        }
      }
      if (headerRow > 0) break;
      
      // أو البحث عن صف يحتوي على أرقام 1, 2, 3 (أيام الشهر)
      let hasNumbers = 0;
      for (let c = 3; c <= Math.min(ws.columnCount, 10); c++) {
        const v = row.getCell(c).value;
        if (typeof v === 'number' && v >= 1 && v <= 31) hasNumbers++;
      }
      if (hasNumbers >= 3) {
        headerRow = r;
        break;
      }
    }
    
    // إذا لم نجد صف العناوين، نفترض أنه الصف 7 أو 8
    if (headerRow < 0) {
      // البحث عن أول صف يحتوي على اسم موظفة معروفة
      for (let r = 1; r <= Math.min(ws.rowCount, 15); r++) {
        const row = ws.getRow(r);
        const nameVal = row.getCell(1).value;
        const codeVal = row.getCell(2).value;
        const nameStr = norm(nameVal);
        const codeStr = typeof codeVal === 'number' ? String(codeVal) : String(codeVal || '').trim();
        
        if (byCode.has(codeStr) || byName.has(nameStr)) {
          headerRow = r - 1; // الصف السابق هو العناوين
          break;
        }
      }
    }
    
    if (headerRow < 0) headerRow = 7;
    firstDayCol = Math.max(nameCol, idCol) + 1;
    
    console.log(`[IMPORT] Header row: ${headerRow}, Name col: ${nameCol}, ID col: ${idCol}, First day col: ${firstDayCol}`);
    
    // ═══════════════════════════════════════════════════════════════════════
    // قراءة البيانات من الصفوف
    // ═══════════════════════════════════════════════════════════════════════
    const rows: { employee_id: string; date: string; symbol: string; code: string }[] = [];
    let importedEmployees = 0;
    
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      
      // قراءة الاسم والكود
      const nameVal = row.getCell(nameCol).value;
      const codeVal = row.getCell(idCol).value;
      
      // تحويل الكود لنص
      const codeStr = typeof codeVal === 'number' ? String(codeVal) : String(codeVal || '').trim();
      
      // البحث عن الموظفة بالكود أولاً
      let empId = byCode.get(codeStr);
      
      // إذا لم نجد بالكود، نبحث بالاسم
      if (!empId) {
        const nameStr = norm(nameVal);
        if (nameStr) empId = byName.get(nameStr);
      }
      
      // تخطي الصفوف التي لا تطابق موظفة
      if (!empId) continue;
      
      importedEmployees++;
      
      // قراءة الشفتات لكل يوم
      for (let d = 1; d <= daysInMonth; d++) {
        const c = firstDayCol + d - 1;
        const cellValue = row.getCell(c).value;
        
        // استيراد القيمة كما هي بالضبط
        let symbol = '';
        if (cellValue !== null && cellValue !== undefined) {
          symbol = String(cellValue).trim().toUpperCase();
        }
        
        const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        rows.push({ employee_id: empId, date, symbol, code: symbol });
      }
    }
    
    console.log(`[IMPORT] Found ${importedEmployees} employees, ${rows.length} assignments`);

    // Dedupe rows to avoid duplicate key constraint violation
    const dedupeMap = new Map<string, typeof rows[0]>();
    for (const r of rows) {
      dedupeMap.set(`${r.employee_id}|${r.date}`, r); // keep last occurrence
    }
    const uniqueRows = Array.from(dedupeMap.values());

    // Replace assignments EXACTLY: first delete all for this month, then insert
    await sb.from('assignments').delete().eq('month_id', monthRow.id);
    if (uniqueRows.length > 0) {
      const BATCH = 500;
      for (let i = 0; i < uniqueRows.length; i += BATCH) {
        const chunk = uniqueRows.slice(i, i + BATCH).map((r) => ({ ...r, month_id: monthRow.id }));
        const { error: insErr } = await sb.from('assignments').insert(chunk as any);
        if (insErr) throw insErr;
      }
    }

    // Optionally auto-generate next month
    let nextGen: any = undefined;
    if (autoNext) {
      let nextYear = year;
      let nextMonth = month + 1;
      if (nextMonth > 12) { nextMonth = 1; nextYear += 1; }
      nextGen = await generateSchedule({ year: nextYear, month: nextMonth });
    }

    return NextResponse.json({ 
      ok: true, 
      imported: uniqueRows.length, 
      employees: importedEmployees,
      year, 
      month, 
      nextGenerated: !!nextGen 
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Import failed' }, { status: 500 });
  }
}
