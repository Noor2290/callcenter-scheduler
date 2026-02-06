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
      if (codeStr) byCode.set(codeStr, String(e.id));
      if ((e as any).name) byName.set(norm((e as any).name), String(e.id));
    }
    
    // لوج للتشخيص: عرض كل الموظفات في قاعدة البيانات
    console.log(`[IMPORT] عدد الموظفات في DB: ${emps?.length || 0}`);
    console.log(`[IMPORT] الموظفات:`, (emps || []).map(e => `${(e as any).name}(${e.id})`).join(', '));

    // Determine month days
    const daysInMonth = new Date(year, month, 0).getDate();

    // ═══════════════════════════════════════════════════════════════════════
    // البحث عن صف العناوين (NAME/ID) ثم البدء من الصف التالي
    // ═══════════════════════════════════════════════════════════════════════
    let headerRow = -1;
    const nameCol = 1;  // العمود A = الاسم
    const idCol = 2;    // العمود B = ID
    const firstDayCol = 3; // العمود C = أول يوم
    
    // البحث عن صف العناوين (يحتوي على NAME أو DAYS أو ID)
    for (let r = 1; r <= Math.min(ws.rowCount, 15); r++) {
      const row = ws.getRow(r);
      for (let c = 1; c <= Math.min(ws.columnCount, 5); c++) {
        const v = String(row.getCell(c).value ?? '').toLowerCase();
        if (v.includes('name') || v.includes('days') || v === 'id') {
          headerRow = r;
          console.log(`[IMPORT] Found header row at ${r}, cell value: "${v}"`);
          break;
        }
      }
      if (headerRow > 0) break;
    }
    
    // إذا لم نجد صف العناوين، نفترض أنه الصف 7
    if (headerRow < 0) headerRow = 7;
    
    const firstDataRow = headerRow + 1;
    console.log(`[IMPORT] Header row: ${headerRow}, First data row: ${firstDataRow}, Name col: ${nameCol}, ID col: ${idCol}`);
    
    // ═══════════════════════════════════════════════════════════════════════
    // قراءة البيانات من الصفوف
    // ═══════════════════════════════════════════════════════════════════════
    const rows: { employee_id: string; date: string; symbol: string; code: string }[] = [];
    let importedEmployees = 0;
    
    const skippedRows: string[] = [];
    
    console.log(`[IMPORT] عدد الصفوف في Excel: ${ws.rowCount}`);
    
    for (let r = firstDataRow; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      
      // قراءة الاسم والكود
      const nameVal = row.getCell(nameCol).value;
      const codeVal = row.getCell(idCol).value;
      
      // لوج لكل صف
      console.log(`[IMPORT] Row ${r}: name="${nameVal}", code="${codeVal}"`);
      
      // تخطي الصفوف الفارغة
      if (!nameVal && !codeVal) {
        console.log(`[IMPORT] Row ${r}: SKIPPED (فارغ)`);
        continue;
      }
      
      // تحويل الكود لنص
      const codeStr = typeof codeVal === 'number' ? String(codeVal) : String(codeVal || '').trim();
      const nameStr = norm(nameVal);
      
      // البحث عن الموظفة بالكود أولاً
      let empId = byCode.get(codeStr);
      
      // إذا لم نجد بالكود، نبحث بالاسم
      if (!empId && nameStr) {
        empId = byName.get(nameStr);
      }
      
      // إذا لم نجد، نحاول البحث بالاسم الجزئي (contains)
      if (!empId && nameStr) {
        for (const [name, id] of byName.entries()) {
          if (name.includes(nameStr) || nameStr.includes(name)) {
            empId = id;
            console.log(`[IMPORT] Partial match: "${nameVal}" -> "${name}" (ID: ${id})`);
            break;
          }
        }
      }
      
      // تسجيل الصفوف التي لم يتم التعرف عليها
      if (!empId) {
        skippedRows.push(`Row ${r}: name="${nameVal}", code="${codeStr}"`);
        continue;
      }
      
      importedEmployees++;
      
      // قراءة الشفتات لكل يوم
      for (let d = 1; d <= daysInMonth; d++) {
        const c = firstDayCol + d - 1;
        const cellValue = row.getCell(c).value;
        
        // استيراد القيمة كما هي بالضبط (بدون أي تعديل)
        let symbol = String(cellValue ?? '').trim();
        
        const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        rows.push({ employee_id: empId, date, symbol, code: symbol });
      }
    }
    
    console.log(`[IMPORT] Found ${importedEmployees} employees, ${rows.length} assignments`);
    if (skippedRows.length > 0) {
      console.log(`[IMPORT] Skipped rows (not matched): ${skippedRows.join(', ')}`);
    }

    // Dedupe rows to avoid duplicate key constraint violation
    const dedupeMap = new Map<string, typeof rows[0]>();
    for (const r of rows) {
      dedupeMap.set(`${r.employee_id}|${r.date}`, r); // keep last occurrence
    }
    const uniqueRows = Array.from(dedupeMap.values());

    // Replace assignments: delete old then upsert new
    await sb.from('assignments').delete().eq('month_id', monthRow.id);
    
    if (uniqueRows.length > 0) {
      const BATCH = 500;
      for (let i = 0; i < uniqueRows.length; i += BATCH) {
        const chunk = uniqueRows.slice(i, i + BATCH).map((r) => ({ ...r, month_id: monthRow.id }));
        // استخدام upsert بدلاً من insert لتجنب خطأ duplicate key
        const { error: insErr } = await sb
          .from('assignments')
          .upsert(chunk as any, { onConflict: 'employee_id,date' });
        if (insErr) throw insErr;
      }
    }

    // استخراج كل التواريخ المقروءة وترتيبها
    const allDates = Array.from(new Set(rows.map(r => r.date))).sort();
    const lastWeekDates = allDates.slice(-7);

    // lastWeekShifts: empId -> "Morning" | "Evening" فقط من آخر 7 تواريخ
    const lastWeekShifts: Record<string, 'Morning' | 'Evening'> = {};
    for (const emp of emps ?? []) {
      const empId = String(emp.id);
      for (let i = lastWeekDates.length - 1; i >= 0; i--) {
        const d = lastWeekDates[i];
        const row = rows.find(r => r.employee_id === empId && r.date === d);
        if (!row) continue;
        const symbol = row.symbol?.toUpperCase() || '';
        if (symbol.startsWith('M') || symbol === 'PT4') {
          lastWeekShifts[empId] = 'Morning';
          break;
        }
        if (symbol.startsWith('E') || symbol === 'PT5' || symbol === 'MA4') {
          lastWeekShifts[empId] = 'Evening';
          break;
        }
      }
    }
    console.log("lastWeekDates", lastWeekDates);
    console.log("lastWeekShifts", lastWeekShifts);

    // استخراج weekStartDay من الإعدادات (أو الافتراضي 6)
    const settingsData = await sb.from('settings').select('key, value');
    let weekStartDay = 6;
    if (settingsData.data) {
      for (const s of settingsData.data) {
        if (s.key === 'weekStartDay') weekStartDay = Number(s.value);
      }
    }

    // Optionally auto-generate next month
    let nextGen: any = undefined;
    if (autoNext) {
      let nextYear = year;
      let nextMonth = month + 1;
      if (nextMonth > 12) { nextMonth = 1; nextYear += 1; }
      nextGen = await generateSchedule({ year: nextYear, month: nextMonth, lastWeekShifts, weekStartDay });
    }

    // طباعة تشخيصية: أول 10 صفوف من جدول assignments بعد الاستيراد
    const checkAssignments = await sb
      .from('assignments')
      .select('*')
      .eq('month_id', monthRow.id)
      .order('employee_id', { ascending: true })
      .order('date', { ascending: true })
      .limit(10);
    console.log('DB assignments sample:', checkAssignments.data);

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
