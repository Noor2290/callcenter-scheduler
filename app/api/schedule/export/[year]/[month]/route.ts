import { NextRequest } from 'next/server';
import supabaseServer from '@/app/lib/supabaseServer';
import { generateSchedule } from '@/app/lib/scheduler';
import ExcelJS from 'exceljs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ year: string; month: string }> }
) {
  const { year, month } = await context.params;
  const debug = _req.nextUrl?.searchParams?.get('debug') === '1';
  const regen = _req.nextUrl?.searchParams?.get('regen') === '1';

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

    // ⚙️ قراءة الإعدادات (useBetweenShift/betweenShiftEmployeeId)
    const { data: settingsRows } = await sb.from('settings').select('key,value');
    const settingsMap = Object.fromEntries((settingsRows ?? []).map((r: any) => [r.key, r.value]));
    const useBetween = (settingsMap.useBetweenShift ?? settingsMap.useBetween)
      ? ((settingsMap.useBetweenShift ?? settingsMap.useBetween) === 'true')
      : false;
    const betweenEmployeeId = (settingsMap.betweenShiftEmployeeId ?? settingsMap.betweenEmployeeId) || undefined;

    // 📅 جلب التوزيعات
    let { data: assigns = [], error: asgErr } = monthRow
      ? await sb
          .from('assignments')
          .select('employee_id, date, symbol')
          .eq('month_id', monthRow.id)
      : ({ data: [], error: null } as any);
    if (asgErr) throw asgErr;

    // Auto-generate when requested or when no assignments exist yet
    if (regen || assigns.length === 0) {
      await generateSchedule({ year: yearNum, month: monthNum, useBetween });
      const { data: monthRow2 } = await sb
        .from('months')
        .select('id, year, month')
        .eq('year', yearNum)
        .eq('month', monthNum)
        .maybeSingle();
      const monthId = (monthRow2 ?? monthRow)?.id;
      if (monthId) {
        const r = await sb
          .from('assignments')
          .select('employee_id, date, symbol')
          .eq('month_id', monthId);
        assigns = (r.data ?? []) as any;
      }
    }

    // 📗 إنشاء ملف Excel جديد
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(`CALL CENTER ${yearNum}-${monthNum}`);

    // إعداد الصفحة والطباعة (لا نضيف أعمدة إضافية)
    (ws as any).views = [{ rightToLeft: false, state: 'frozen', xSplit: 2, ySplit: 6 }];
    ws.pageSetup.orientation = 'landscape';
    ws.pageSetup.fitToPage = true;
    ws.pageSetup.fitToWidth = 1;
    ws.pageSetup.fitToHeight = 1;
    // A4 paper size for predictable scaling (Excel paper size code 9)
    (ws.pageSetup as any).paperSize = 9;
    ws.pageSetup.margins = { left: 0.25, right: 0.25, top: 0.3, bottom: 0.3, header: 0.2, footer: 0.2 } as any;
    ws.pageSetup.horizontalCentered = true as any;
    ws.pageSetup.verticalCentered = true as any;
    ws.properties.defaultRowHeight = 14;

    // 🧩 إعداد الأعمدة
    ws.getColumn(1).width = 26; // NAME
    ws.getColumn(2).width = 8; // ID
    for (let c = 3; c <= 2 + daysInMonth; c++) ws.getColumn(c).width = 3.8;
    

    // 🎨 أنماط الألوان
    // Medium-soft palette aligned with UI (Tailwind 100-ish)
    // Morning (yellow-100): #FEF3C7 -> FFFE F3C7
    // Evening (blue-100):   #DBEAFE -> FFDB EAFE
    // Part-time Morning PT4: yellow-300 (#FDE68A) a bit stronger than Morning
    // Part-time Evening PT5: blue-300   (#93C5FD) a bit stronger than Evening
    // Between (teal-100):   #CCFBF1 -> FFCC FBF1
    // Off (gray-200):       #E5E7EB -> FFE5 E7EB
    // Vacation (amber-100): #FEF3C7 -> FFFE F3C7
    const colors: Record<string, string> = {
      // Morning codes
      MA1: 'FFFEF3C7', MA2: 'FFFEF3C7', MA4: 'FFFEF3C7', M2: 'FFFEF3C7',
      // Evening codes
      EA1: 'FFDBEAFE', E2: 'FFDBEAFE', E5: 'FFDBEAFE',
      // Part-time emphasized but close to Morning/Evening
      PT4: 'FFFDE68A', // yellow-300
      PT5: 'FF93C5FD', // blue-300
      // Special days
      V: 'FFFEE2E2',
      O: 'FFE5E7EB',
      B: 'FFCCFBF1', // Between Shift
    };

    const borderAll = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    } as const;

    // دالة دمج آمنة
    const safeMerge = (r1: number, c1: number, r2: number, c2: number) => {
      try { ws.mergeCells(r1, c1, r2, c2); } catch {}
    };

    // الترويسة العلوية (EN / AR) بشكل أقرب للقالب
    ws.addRow([]);
    const lastColLetter = ws.getColumn(2 + daysInMonth).letter;
    ws.mergeCells(`A1:${lastColLetter}1`);
    ws.getCell('A1').value = '';
    const titleRow = ws.addRow([]).number;
    ws.mergeCells(titleRow, 1, titleRow, 10);
    ws.getCell(titleRow, 1).value = 'MAKKAH MEDICAL CENTER';
    ws.getCell(titleRow, 1).alignment = { horizontal: 'left' } as any;
    ws.getCell(titleRow, 1).font = { color: { argb: 'FF008000' }, bold: true } as any;
    ws.mergeCells(titleRow, 11, titleRow, 11); // مساحة وسطية للشعار
    ws.getCell(titleRow, 11).value = '';
    ws.mergeCells(titleRow, 12, titleRow, 2 + daysInMonth);
    ws.getCell(titleRow, 12).value = 'مستشفى مركز مكة الطبي';
    ws.getCell(titleRow, 12).alignment = { horizontal: 'right' } as any;
    ws.getCell(titleRow, 12).font = { color: { argb: 'FF008000' }, bold: true } as any;

    // شريط معلومات القسم/الشهر/السنة باللون الأصفر وحدود أوضح (EN يسار / AR يمين)
    const infoTop = ws.addRow([]).number;
    // EN box
    ws.mergeCells(infoTop, 1, infoTop, 4);
    ws.mergeCells(infoTop, 5, infoTop, 8);
    ws.mergeCells(infoTop, 9, infoTop, 12);
    ws.getCell(infoTop, 1).value = 'Department';
    ws.getCell(infoTop, 5).value = 'Month';
    ws.getCell(infoTop, 9).value = 'Year';
    const infoTopVals = ws.addRow([]).number;
    ws.mergeCells(infoTopVals, 1, infoTopVals, 4);
    ws.mergeCells(infoTopVals, 5, infoTopVals, 8);
    ws.mergeCells(infoTopVals, 9, infoTopVals, 12);
    ws.getCell(infoTopVals, 1).value = 'CALL CENTER';
    ws.getCell(infoTopVals, 5).value = monthNum as any;
    ws.getCell(infoTopVals, 9).value = yearNum as any;
    // AR box on the right
    const arStartCol = Math.max(13, 2 + daysInMonth - 11);
    ws.mergeCells(infoTop, arStartCol, infoTop, arStartCol + 3);
    ws.mergeCells(infoTop, arStartCol + 4, infoTop, arStartCol + 7);
    ws.mergeCells(infoTop, arStartCol + 8, infoTop, 2 + daysInMonth);
    ws.getCell(infoTop, arStartCol).value = 'القسم';
    ws.getCell(infoTop, arStartCol + 4).value = 'الشهر';
    ws.getCell(infoTop, arStartCol + 8).value = 'السنة';
    const arVals = ws.addRow([]).number;
    ws.mergeCells(arVals, arStartCol, arVals, arStartCol + 3);
    ws.mergeCells(arVals, arStartCol + 4, arVals, arStartCol + 7);
    ws.mergeCells(arVals, arStartCol + 8, arVals, 2 + daysInMonth);
    ws.getCell(arVals, arStartCol).value = 'مركز الاتصالات';
    ws.getCell(arVals, arStartCol + 4).value = monthNum as any;
    ws.getCell(arVals, arStartCol + 8).value = yearNum as any;
    // style both boxes
    for (const r of [infoTop, infoTopVals, arVals]) {
      ws.getRow(r).eachCell(c => {
        if (!c.value) return;
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE699' } } as any;
        c.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } } as any;
        c.alignment = { horizontal: 'center', vertical: 'middle' } as any;
        c.font = { bold: true } as any;
      });
    }

    ws.addRow([]);

    // ترويسة الأيام (إنجليزي + رقم)
    const daysRow1 = ws.addRow(['', 'ID', ...Array.from({ length: daysInMonth }, (_, i) => {
      const date = new Date(yearNum, monthNum - 1, i + 1);
      const day = date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
      return day;
    })]);
    const daysRow2 = ws.addRow(['NAME', '', ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]);
    // دمج خانة عنوان يسار الجدول لتكون فوق عمودَي الاسم والرقم وبامتداد صفّي الترويسة
    safeMerge(daysRow1.number, 1, daysRow1.number, 1);
    safeMerge(daysRow2.number, 1, daysRow2.number, 1);
    // دمج عنوان العمود الأول عبر الخانتين عمودياً (نضع النص على صفّين باستعمال wrap)
    safeMerge(daysRow1.number, 1, daysRow2.number, 1);
    ws.getCell(daysRow1.number, 1).value = 'DAYS & DATE\nNAME';
    ws.getCell(daysRow1.number, 1).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true } as any;
    // دمج ترويسة ID عمودياً عبر صفّي الترويسة
    safeMerge(daysRow1.number, 2, daysRow2.number, 2);
    ws.getCell(daysRow1.number, 2).value = 'ID';
    ws.getCell(daysRow1.number, 2).alignment = { horizontal: 'center', vertical: 'middle' } as any;
    // تلوين خفيف أخضر وحدود أقوى وارتفاع صفوف الترويسة
    const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6C3' } } as any;
    ws.getCell(daysRow1.number, 1).fill = headerFill;
    ws.getRow(daysRow1.number).height = 22;
    ws.getRow(daysRow2.number).height = 18;

    // تنسيق الترويسة مع إبراز الإطار
    [daysRow1, daysRow2].forEach(r => {
      r.eachCell((c, n) => {
        const isDayCol = n > 2;
        c.alignment = { horizontal: 'center', vertical: 'middle', shrinkToFit: isDayCol } as any;
        c.font = { bold: true, size: isDayCol ? 8 : 9 } as any;
        c.border = { top: { style: 'medium' }, left: { style: 'medium' }, bottom: { style: 'medium' }, right: { style: 'medium' } } as any;
        c.fill = headerFill;
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
      ws.getCell(idx, 1).font = { size: 9 } as any;
      ws.getCell(idx, 2).font = { size: 9, bold: true } as any;
      ws.getCell(idx, 1).alignment = { horizontal: 'left', vertical: 'middle' } as any;
      ws.getCell(idx, 2).alignment = { horizontal: 'center', vertical: 'middle' } as any;
      ws.getCell(idx, 1).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } } as any;
      ws.getCell(idx, 2).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } } as any;

      for (let d = 1; d <= daysInMonth; d++) {
        const col = 2 + d;
        const iso = `${yearNum}-${String(monthNum).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        let symbol = grid[e.id]?.[iso] ?? '';
        // إذا كان خيار Between مفعّل وهذه هي الموظفة المختارة، استبدل رمز العمل بـ B
        if (useBetween && betweenEmployeeId === e.id && symbol && symbol !== 'O' && symbol !== 'V') {
          symbol = 'B';
        }
        const cell = ws.getCell(idx, col);
        cell.value = symbol;
        cell.border = borderAll;
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.font = { size: 7 } as any;
        const color = colors[symbol];
        if (color) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
        if (daysRow1.getCell(col).value === 'FRI')
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBFBFBF' } };
      }
    }

    // 🟢 Legend
    ws.addRow([]);
    // تعريف الجداول الثلاثة كجداول ذات عمودين مع حدود كاملة
    const leftBlock: Array<[string, string, string?]> = [
      ['MA1', '07:00AM - 04:00PM', 'FFFEF3C7'],
      ['MA2', '08:00AM - 05:00PM', 'FFFEF3C7'],
      ['MA4', '11:00AM - 08:00PM', 'FFFEF3C7'],
      ['EA1', '02:00PM - 11:00PM', 'FFDBEAFE'],
      ['V',   'Vacation',          'FFFEE2E2'],
      ['O',   'OFF',               'FFE5E7EB'],
    ];
    const midBlock: Array<[string, string, string?]> = [
      ['PT4', '08:00AM - 01:00PM', 'FFFDE68A'],
      ['PT5', '05:00PM - 10:00PM', 'FF93C5FD'],
    ];
    const rightBlock: Array<[string, string, string?]> = [
      ['M2', '08:00AM - 04:00PM', 'FFFEF3C7'],
      ['E5', '12:00PM - 08:00PM', 'FFDBEAFE'],
      ['E2', '02:00PM - 10:00PM', 'FFDBEAFE'],
    ];

    // ⚙️ عرض المستطيلات وطريقة التمركز
    const timeSpan = 6; // زيادة طول خانة الوقت لزيادة طول المستطيل
    const blockWidth = 1 + timeSpan; // عمود الرمز + أعمدة الوقت المدمجة
    const gap = 2; // فراغ ثابت بين الكتل
    const totalBlocksWidth = blockWidth * 3 + gap * 2;
    const totalCols = 2 + daysInMonth; // من A حتى آخر يوم
    // بداية محاذاة وسطية بحيث لا تتجاوز آخر عمود
    const centerCol = Math.max(3, Math.floor((totalCols - totalBlocksWidth + 1) / 2));
    const step = blockWidth + gap;
    const drawTable = (startCol: number, rows: Array<[string,string,string?]>, title?: string, fillTimeCell: boolean = false) => {
      if (title) {
        const tr = ws.addRow([]).number;
        ws.mergeCells(tr, startCol, tr, startCol + timeSpan);
        const t = ws.getCell(tr, startCol);
        t.value = title;
        t.alignment = { horizontal: 'left' } as any;
        t.font = { bold: true } as any;
      }
      for (const [code, text, color] of rows) {
        const r = ws.addRow([]).number;
        const c1 = ws.getCell(r, startCol);
        c1.value = code;
        if (color) c1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } } as any;
        c1.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } } as any;
        ws.mergeCells(r, startCol + 1, r, startCol + timeSpan);
        const c2 = ws.getCell(r, startCol + 1);
        c2.value = text;
        if (fillTimeCell && color) c2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } } as any;
        c2.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } } as any;
        c2.alignment = { horizontal: 'center' } as any;
      }
    };

    drawTable(centerCol, leftBlock, '', false);
    drawTable(centerCol + step, midBlock, '', true);
    drawTable(centerCol + step * 2, rightBlock, '', true);

    // نص "8 hours" تحت الجداول في الوسط
    const hoursRow = ws.addRow([]).number;
    const hoursCol = centerCol + step + Math.floor(blockWidth / 2);
    ws.mergeCells(hoursRow, hoursCol, hoursRow, hoursCol + 1);
    ws.getCell(hoursRow, hoursCol).value = '8 hours';
    ws.getCell(hoursRow, hoursCol).alignment = { horizontal: 'center' } as any;

    // ✍️ صناديق التوقيع (تخطيط جديد)
    ws.addRow([]);
    const sigTop = ws.addRow([]).number;
    // صندوق وسط عريض: مدير الموارد البشرية (عربي/إنجليزي) مع تعبئة بيج
    const midStart = Math.max(6, Math.floor((2 + daysInMonth) / 2) - 6);
    const midEnd = midStart + 8;
    ws.mergeCells(sigTop, midStart, sigTop + 2, midEnd);
    const midCell = ws.getCell(sigTop, midStart);
    midCell.value = 'مدير الموارد البشرية\nDirector of Human Resources';
    midCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true } as any;
    midCell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } } as any;
    midCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3EEDA' } } as any;
    // صندوق يمين صغير: رقم الصادر والتاريخ
    const rightBoxStart = Math.min(2 + daysInMonth - 6, midEnd + 3);
    const rightBoxEnd = 2 + daysInMonth - 1;
    // الصف الأول: Number - رقم الصادر
    ws.mergeCells(sigTop, rightBoxStart, sigTop, rightBoxEnd);
    const numCell = ws.getCell(sigTop, rightBoxStart);
    numCell.value = 'Number - رقم الصادر';
    numCell.alignment = { horizontal: 'center', vertical: 'middle' } as any;
    numCell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } } as any;
    // الصف الثاني: issued - محرر في + تاريخ اليوم
    const issueRow = sigTop + 1;
    ws.mergeCells(issueRow, rightBoxStart, issueRow, rightBoxEnd);
    const dateStr = new Date().toISOString().slice(0,10);
    const issCell = ws.getCell(issueRow, rightBoxStart);
    issCell.value = `issued - محرر في\n${dateStr}`;
    issCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true } as any;
    issCell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } } as any;

    // حدد نطاق الطباعة ليقتصر على الجدول + الأسطورة والتوقيعات
    const lastRowForPrint = ws.lastRow?.number ?? 1;
    ws.pageSetup.printArea = `A1:${lastColLetter}${lastRowForPrint}`;

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
