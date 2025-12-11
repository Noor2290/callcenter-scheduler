import { NextRequest } from 'next/server';
import supabaseServer from '@/app/lib/supabaseServer';
import ExcelJS from 'exceljs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/schedule/export-current
 * تصدير الجدول المعروض حالياً (وليس المحفوظ في DB)
 * 
 * Body:
 * - year: number
 * - month: number
 * - employees: Array<{id, name, code}>
 * - assignments: Array<{employee_id, date, symbol}>
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { year, month, employees, assignments } = body;

    if (!year || !month || !employees || !assignments) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const yearNum = Number(year);
    const monthNum = Number(month);
    const daysInMonth = new Date(yearNum, monthNum, 0).getDate();

    const sb = supabaseServer();

    // ⚙️ قراءة الإعدادات (useBetweenShift/betweenShiftEmployeeId)
    const { data: settingsRows } = await sb.from('settings').select('key,value');
    const settingsMap = Object.fromEntries((settingsRows ?? []).map((r: any) => [r.key, r.value]));
    const useBetween = settingsMap.useBetweenShift === 'true';
    const betweenEmployeeId = settingsMap.betweenShiftEmployeeId || undefined;

    // 📗 إنشاء ملف Excel جديد
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(`CALL CENTER ${yearNum}-${monthNum}`);

    // إعداد الصفحة والطباعة
    (ws as any).views = [{ rightToLeft: false, state: 'frozen', xSplit: 2, ySplit: 6 }];
    ws.pageSetup.orientation = 'landscape';
    ws.pageSetup.fitToPage = true;
    ws.pageSetup.fitToWidth = 1;
    ws.pageSetup.fitToHeight = 1;
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
    const colors: Record<string, string> = {
      MA1: 'FFFEF3C7', MA2: 'FFFEF3C7', MA4: 'FFFEF3C7', M2: 'FFFEF3C7',
      EA1: 'FFDBEAFE', E2: 'FFDBEAFE', E5: 'FFDBEAFE',
      PT4: 'FFFFE699',
      PT5: 'FF9FC5E8',
      V: 'FFFEE2E2',
      O: 'FFE5E7EB',
      B: 'FFCCFBF1',
    };

    const borderAll = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    } as const;

    const safeMerge = (r1: number, c1: number, r2: number, c2: number) => {
      try { ws.mergeCells(r1, c1, r2, c2); } catch {}
    };

    // الترويسة العلوية
    ws.addRow([]);
    const lastColLetter = ws.getColumn(2 + daysInMonth).letter;
    ws.mergeCells(`A1:${lastColLetter}1`);
    ws.getCell('A1').value = '';
    const titleRow = ws.addRow([]).number;
    ws.mergeCells(titleRow, 1, titleRow, 10);
    ws.getCell(titleRow, 1).value = 'MAKKAH MEDICAL CENTER';
    ws.getCell(titleRow, 1).alignment = { horizontal: 'left' } as any;
    ws.getCell(titleRow, 1).font = { color: { argb: 'FF008000' }, bold: true } as any;
    ws.mergeCells(titleRow, 11, titleRow, 11);
    ws.getCell(titleRow, 11).value = '';
    ws.mergeCells(titleRow, 12, titleRow, 2 + daysInMonth);
    ws.getCell(titleRow, 12).value = 'مستشفى مركز مكة الطبي';
    ws.getCell(titleRow, 12).alignment = { horizontal: 'right' } as any;
    ws.getCell(titleRow, 12).font = { color: { argb: 'FF008000' }, bold: true } as any;

    // شريط معلومات القسم/الشهر/السنة
    const infoTop = ws.addRow([]).number;
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

    // ترويسة الأيام
    const dayNamesRow: string[] = [];
    const dayNumbersRow: (number | string)[] = [];
    
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(yearNum, monthNum - 1, d);
      const dayName = date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
      dayNamesRow.push(dayName);
      dayNumbersRow.push(d);
    }
    
    const daysRow1 = ws.addRow(['', 'ID', ...dayNamesRow]);
    const daysRow2 = ws.addRow(['NAME', '', ...dayNumbersRow]);
    safeMerge(daysRow1.number, 1, daysRow1.number, 1);
    safeMerge(daysRow2.number, 1, daysRow2.number, 1);
    safeMerge(daysRow1.number, 1, daysRow2.number, 1);
    ws.getCell(daysRow1.number, 1).value = 'DAYS & DATE\nNAME';
    ws.getCell(daysRow1.number, 1).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true } as any;
    safeMerge(daysRow1.number, 2, daysRow2.number, 2);
    ws.getCell(daysRow1.number, 2).value = 'ID';
    ws.getCell(daysRow1.number, 2).alignment = { horizontal: 'center', vertical: 'middle' } as any;
    
    const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6C3' } } as any;
    ws.getCell(daysRow1.number, 1).fill = headerFill;
    ws.getRow(daysRow1.number).height = 22;
    ws.getRow(daysRow2.number).height = 18;

    [daysRow1, daysRow2].forEach(r => {
      r.eachCell((c, n) => {
        const isDayCol = n > 2;
        c.alignment = { horizontal: 'center', vertical: 'middle', shrinkToFit: isDayCol } as any;
        c.font = { bold: true, size: isDayCol ? 8 : 9 } as any;
        c.border = { top: { style: 'medium' }, left: { style: 'medium' }, bottom: { style: 'medium' }, right: { style: 'medium' } } as any;
        c.fill = headerFill;
        if (n > 2 && daysRow1.getCell(n).value === 'FRI') {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBFBFBF' } };
        }
      });
    });

    // 📋 تعبئة بيانات الموظفين من الجدول المعروض
    const grid: Record<string, Record<string, string>> = {};
    for (const a of assignments) {
      const empId = String(a.employee_id);
      grid[empId] ||= {};
      grid[empId][a.date] = a.symbol;
    }

    console.log('[Export-Current] ========================================');
    console.log('[Export-Current] Year:', yearNum, 'Month:', monthNum);
    console.log('[Export-Current] Employees:', employees.length);
    console.log('[Export-Current] Assignments:', assignments.length);
    console.log('[Export-Current] ========================================');

    for (const e of employees) {
      const r = ws.addRow([]);
      const idx = r.number;
      ws.getCell(idx, 1).value = e.name;
      ws.getCell(idx, 2).value = e.code ?? '';
      ws.getCell(idx, 1).font = { size: 9 } as any;
      ws.getCell(idx, 2).font = { size: 9, bold: true } as any;
      ws.getCell(idx, 1).alignment = { horizontal: 'left', vertical: 'middle' } as any;
      ws.getCell(idx, 2).alignment = { horizontal: 'center', vertical: 'middle' } as any;
      ws.getCell(idx, 1).border = borderAll as any;
      ws.getCell(idx, 2).border = borderAll as any;

      for (let d = 1; d <= daysInMonth; d++) {
        const col = 2 + d;
        const iso = `${yearNum}-${String(monthNum).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const empIdStr = String(e.id);
        let symbol = grid[empIdStr]?.[iso] ?? '';
        
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
    const leftBlock: Array<[string, string, string?]> = [
      ['MA1', '07:00AM - 04:00PM', 'FFFEF3C7'],
      ['MA2', '08:00AM - 05:00PM', 'FFFEF3C7'],
      ['MA4', '11:00AM - 08:00PM', 'FFFEF3C7'],
      ['EA1', '02:00PM - 11:00PM', 'FFDBEAFE'],
      ['V',   'Vacation',          'FFFEE2E2'],
      ['O',   'OFF',               'FFE5E7EB'],
    ];
    const midBlock: Array<[string, string, string?]> = [
      ['PT4', '08:00AM - 01:00PM', 'FFFFE699'],
      ['PT5', '05:00PM - 10:00PM', 'FF9FC5E8'],
    ];
    const rightBlock: Array<[string, string, string?]> = [
      ['M2', '08:00AM - 04:00PM', 'FFFEF3C7'],
      ['E5', '12:00PM - 08:00PM', 'FFDBEAFE'],
      ['E2', '02:00PM - 10:00PM', 'FFDBEAFE'],
    ];

    const timeSpan = 6;
    const blockWidth = 1 + timeSpan;
    const gap = 2;
    const totalBlocksWidth = blockWidth * 3 + gap * 2;
    const totalCols = 2 + daysInMonth;
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

    const hoursRow = ws.addRow([]).number;
    const hoursCol = centerCol + step + Math.floor(blockWidth / 2);
    ws.mergeCells(hoursRow, hoursCol, hoursRow, hoursCol + 1);
    ws.getCell(hoursRow, hoursCol).value = '8 hours';
    ws.getCell(hoursRow, hoursCol).alignment = { horizontal: 'center' } as any;

    // ✍️ صناديق التوقيع
    ws.addRow([]);
    const sigTop = ws.addRow([]).number;
    const midStart = Math.max(6, Math.floor((2 + daysInMonth) / 2) - 6);
    const midEnd = midStart + 8;
    ws.mergeCells(sigTop, midStart, sigTop + 2, midEnd);
    const midCell = ws.getCell(sigTop, midStart);
    midCell.value = 'مدير الموارد البشرية\nDirector of Human Resources';
    midCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true } as any;
    midCell.border = borderAll as any;
    midCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3EEDA' } } as any;
    
    const rightBoxStart = Math.min(2 + daysInMonth - 6, midEnd + 3);
    const rightBoxEnd = 2 + daysInMonth - 1;
    ws.mergeCells(sigTop, rightBoxStart, sigTop, rightBoxEnd);
    const numCell = ws.getCell(sigTop, rightBoxStart);
    numCell.value = 'Number - رقم الصادر';
    numCell.alignment = { horizontal: 'center', vertical: 'middle' } as any;
    numCell.border = borderAll as any;
    
    const issueRow = sigTop + 1;
    ws.mergeCells(issueRow, rightBoxStart, issueRow, rightBoxEnd);
    const dateStr = new Date().toISOString().slice(0,10);
    const issCell = ws.getCell(issueRow, rightBoxStart);
    issCell.value = `issued - محرر في\n${dateStr}`;
    issCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true } as any;
    issCell.border = borderAll as any;

    const lastRowForPrint = ws.lastRow?.number ?? 1;
    ws.pageSetup.printArea = `A1:${lastColLetter}${lastRowForPrint}`;

    // 🔄 تصدير
    const buffer = await wb.xlsx.writeBuffer();
    const filename = `CALL_CENTER_${yearNum}_${String(monthNum).padStart(2, '0')}.xlsx`;
    const fileBody = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer as ArrayBuffer);

    return new Response(fileBody, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename=${filename}`,
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    });
  } catch (e: any) {
    console.error('[Export-Current] Error:', e);
    return Response.json({ error: e?.message || 'Export failed' }, { status: 500 });
  }
}
