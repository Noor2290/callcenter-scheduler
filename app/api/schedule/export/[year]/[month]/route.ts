import { NextRequest } from 'next/server';
import supabaseServer from '@/app/lib/supabaseServer';
import ExcelJS from 'exceljs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ year: string; month: string }> }
) {
  const { year, month } = await context.params;
  const debug = _req.nextUrl?.searchParams?.get('debug') === '1';

  try {
    const yearNum = Number(year);
    const monthNum = Number(month);
    const daysInMonth = new Date(yearNum, monthNum, 0).getDate();

    const sb = supabaseServer();

    // 🟡 جلب بيانات الشهر
    const { data: monthRow, error: monthErr } = await sb
      .from('months')
      .select('id, year, month')
      .eq('year', yearNum)
      .eq('month', monthNum)
      .maybeSingle();
    if (monthErr) throw monthErr;

    // 👥 جلب الموظفين
    const { data: _emps, error: empErr } = await sb
      .from('employees')
      .select('id, code, name')
      .order('name', { ascending: true });
    if (empErr) throw empErr;
    const emps = _emps ?? [];

    // 📅 جلب التوزيعات
    const { data: assigns = [], error: asgErr } = monthRow
      ? await sb
          .from('assignments')
          .select('employee_id, date, symbol')
          .eq('month_id', monthRow.id)
      : ({ data: [], error: null } as any);
    if (asgErr) throw asgErr;

    // 📗 إنشاء ملف Excel جديد
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(`CALL CENTER ${yearNum}-${monthNum}`);

    // إعداد الصفحة والطباعة
    (ws as any).views = [{ rightToLeft: false, state: 'frozen', xSplit: 2, ySplit: 6 }];
    ws.pageSetup.orientation = 'landscape';
    ws.pageSetup.fitToPage = true;
    ws.pageSetup.fitToWidth = 1;
    ws.pageSetup.fitToHeight = 1;
    ws.pageSetup.margins = { left: 0.3, right: 0.3, top: 0.35, bottom: 0.35 } as any;
    ws.pageSetup.horizontalCentered = true as any;
    ws.pageSetup.verticalCentered = true as any;
    ws.properties.defaultRowHeight = 20;

    // 🧩 إعداد الأعمدة
    ws.getColumn(1).width = 30; // NAME
    ws.getColumn(2).width = 10; // ID
    for (let c = 3; c <= 2 + daysInMonth; c++) ws.getColumn(c).width = 4.5;

    // 🎨 أنماط الألوان
    const colors: Record<string, string> = {
      MA1: 'FFFCE699', MA2: 'FFFCE699', MA4: 'FFFCE699',
      EA1: 'FFBDD7EE', E2: 'FFBDD7EE', E5: 'FFBDD7EE',
      PT4: 'FFD9D9D9', PT5: 'FFD9D9D9',
      V: 'FF92D050',
      O: 'FFFFC7CE'
    };

    const borderAll = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    } as const;

    // 🧱 دالة دمج آمنة
    const safeMerge = (r1: number, c1: number, r2: number, c2: number) => {
      try { ws.mergeCells(r1, c1, r2, c2); } catch {}
    };

    // 🟨 الترويسة العلوية (EN / AR)
    ws.addRow([]);
    ws.mergeCells('A1', 'E1');
    ws.getCell('A1').value = 'MAKKAH MEDICAL CENTER';
    ws.getCell('A1').alignment = { horizontal: 'left' };
    ws.mergeCells(`F1:${ws.getColumn(2 + daysInMonth).letter}${1}`);
    ws.getCell('F1').value = 'مسـتـشـفـى مـركـز مـكـة الـطـبـي';
    ws.getCell('F1').alignment = { horizontal: 'right' };
    ws.addRow([]);

    // 🟡 الصف الثالث: Month / Year / Department
    const infoRow = ws.addRow([]);
    ws.getCell('A3').value = 'Month';
    ws.getCell('B3').value = monthNum;
    ws.getCell('C3').value = 'Year';
    ws.getCell('D3').value = yearNum;
    ws.getCell('E3').value = 'Department';
    ws.getCell('F3').value = 'CALL CENTER';
    for (let c = 1; c <= 6; c++) {
      const cell = ws.getCell(3, c);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE699' } };
      cell.border = borderAll;
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    }

    ws.addRow([]);

    // 🗓️ ترويسة الأيام (إنجليزي + رقم)
    const daysRow1 = ws.addRow(['NAME', 'ID', ...Array.from({ length: daysInMonth }, (_, i) => {
      const date = new Date(yearNum, monthNum - 1, i + 1);
      const day = date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
      return day;
    })]);

    const daysRow2 = ws.addRow(['', '', ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]);

    // تنسيق الترويسة
    [daysRow1, daysRow2].forEach(r => {
      r.eachCell((c, n) => {
        c.alignment = { horizontal: 'center', vertical: 'middle' };
        c.font = { bold: true };
        c.border = borderAll;
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
        // تظليل الجمعة
        if (n > 2 && daysRow1.getCell(n).value === 'FRI') {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBFBFBF' } };
        }
      });
    });

    // 📋 تعبئة بيانات الموظفين
    const grid: Record<string, Record<string, string>> = {};
    for (const a of assigns ?? []) {
      grid[a.employee_id] ||= {};
      grid[a.employee_id][a.date] = a.symbol;
    }

    for (const e of emps) {
      const r = ws.addRow([]);
      const idx = r.number;
      ws.getCell(idx, 1).value = e.name;
      ws.getCell(idx, 2).value = e.code ?? '';

      for (let d = 1; d <= daysInMonth; d++) {
        const col = 2 + d;
        const iso = `${yearNum}-${String(monthNum).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const symbol = grid[e.id]?.[iso] ?? '';
        const cell = ws.getCell(idx, col);
        cell.value = symbol;
        cell.border = borderAll;
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        const color = colors[symbol];
        if (color) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
        if (daysRow1.getCell(col).value === 'FRI')
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBFBFBF' } };
      }
    }

    // 🟢 Legend
    ws.addRow([]);
    const legendStart = ws.lastRow!.number + 1;
    const legendItems: [string, string, string][] = [
      ['MA1 / MA2 / MA4', 'FFFCE699', 'Morning Shifts'],
      ['EA1 / E2 / E5', 'FFBDD7EE', 'Evening Shifts'],
      ['PT4 / PT5', 'FFD9D9D9', 'Part-time'],
      ['V', 'FF92D050', 'Vacation'],
      ['O', 'FFFFC7CE', 'OFF'],
    ];
    for (const [label, color, desc] of legendItems) {
      const row = ws.addRow([label, desc]);
      const cell = ws.getCell(`A${row.number}`);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
      cell.border = borderAll;
      ws.getCell(`B${row.number}`).alignment = { horizontal: 'left' };
    }

    // ✍️ صناديق التوقيع
    ws.addRow([]);
    const sigStart = ws.lastRow!.number + 1;
    ws.addRow(['Director of Human Resources', '', '', '', '', 'رئيس القسم']);
    ws.addRow(['مدير الموارد البشرية', '', '', '', '', 'Head of Department']);

    ws.getRow(sigStart).eachCell(c => (c.font = { bold: true }));
    ws.getRow(sigStart + 1).eachCell(c => (c.font = { italic: true }));

    // 🔄 تصدير
    const buffer = await wb.xlsx.writeBuffer();
    const filename = `CALL_CENTER_${yearNum}_${String(monthNum).padStart(2, '0')}.xlsx`;
    const body = Buffer.isBuffer(buffer)
      ? buffer
      : Buffer.from(buffer as ArrayBuffer);

    if (debug) {
      return Response.json({
        ok: true,
        employees: emps.length,
        assignments: assigns.length,
        days: daysInMonth,
      });
    }

    return new Response(body, {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename=${filename}`,
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    });
  } catch (e: any) {
    const msg = e?.message || 'Export failed';
    if (debug) return Response.json({ ok: false, error: msg }, { status: 500 });
    return new Response(msg, { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}
