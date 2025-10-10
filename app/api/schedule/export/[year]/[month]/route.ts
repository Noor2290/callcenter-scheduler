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
    const sb = supabaseServer();

    // جلب بيانات الشهر
    const { data: monthRow, error: monthErr } = await sb
      .from('months')
      .select('id, year, month')
      .eq('year', yearNum)
      .eq('month', monthNum)
      .maybeSingle();
    if (monthErr) throw monthErr;

    // جلب بيانات الموظفين
    const { data: _emps, error: empErr } = await sb
      .from('employees')
      .select('id, code, name')
      .order('name', { ascending: true });
    if (empErr) throw empErr;
    const emps = _emps ?? [];

    // جلب التوزيعات (assignments)
    const { data: assigns = [], error: asgErr } = monthRow
      ? await sb
          .from('assignments')
          .select('employee_id, date, symbol')
          .eq('month_id', monthRow.id)
      : ({ data: [], error: null } as any);
    if (asgErr) throw asgErr;

    // إنشاء ملف Excel جديد
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet(
      `CALL CENTER ${yearNum}-${String(monthNum).padStart(2, '0')}`
    );

    // إعداد العرض من اليسار إلى اليمين (LTR)
    (ws as any).views = [
      { rightToLeft: false, state: 'frozen', xSplit: 2, ySplit: 4 },
    ];

    // إعداد الصفحة للطباعة
    ws.pageSetup.orientation = 'landscape';
    ws.pageSetup.fitToPage = true;
    ws.pageSetup.fitToWidth = 1;
    ws.pageSetup.fitToHeight = 1;
    ws.pageSetup.margins = {
      left: 0.3,
      right: 0.3,
      top: 0.35,
      bottom: 0.35,
      header: 0.15,
      footer: 0.15,
    } as any;
    ws.pageSetup.horizontalCentered = true as any;
    ws.pageSetup.verticalCentered = true as any;
    ws.properties.defaultRowHeight = 17;

    const greenBorder = {
      color: { argb: 'FF9BBB59' },
      style: 'medium' as const,
    };
    const borderAll = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    } as const;
    const borderThick = {
      top: { style: 'thick' },
      left: { style: 'thick' },
      bottom: { style: 'thick' },
      right: { style: 'thick' },
    } as const;

    // دالة دمج آمنة
    const safeMerge = (r1: number, c1: number, r2: number, c2: number) => {
      try {
        ws.mergeCells(r1, c1, r2, c2);
      } catch {}
    };

    // الأعمدة (LTR): 1=NAME, 2=ID, 3..33 = أيام الشهر
    ws.getColumn(1).width = 32; // NAME
    ws.getColumn(2).width = 10; // ID
    for (let c = 3; c <= 33; c++) ws.getColumn(c).width = 4.5;

    // خريطة التوزيع (اختصرت التفاصيل لتبقى الدالة ديناميكية وسليمة)
    const grid: Record<string, Record<string, string>> = {};
    for (const a of assigns ?? []) {
      grid[a.employee_id] ||= {};
      grid[a.employee_id][a.date] = a.symbol;
    }

    // تعبئة بيانات الموظفين (اختصارًا للمثال)
    for (const e of emps) {
      const r = ws.addRow([]);
      const rowIdx = r.number;
      ws.getCell(rowIdx, 1).value = e.name;
      ws.getCell(rowIdx, 2).value = e.code ?? '';

      for (let d = 1; d <= 31; d++) {
        const col = 2 + d;
        const iso = `${yearNum}-${String(monthNum).padStart(2, '0')}-${String(
          d
        ).padStart(2, '0')}`;
        ws.getCell(rowIdx, col).value = grid[e.id]?.[iso] ?? '';
      }
    }

    // إنشاء ملف Excel وإرجاعه كاستجابة
    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `CALL_CENTER_${yearNum}_${String(monthNum).padStart(
      2,
      '0'
    )}.xlsx`;
    const body = Buffer.isBuffer(buffer)
      ? buffer
      : Buffer.from(buffer as ArrayBuffer);

    // إذا تم تمرير debug=1 → يرجع JSON بدل ملف
    if (debug) {
      return Response.json({
        ok: true,
        size: body.length,
        employees: emps.length,
        assignments: assigns.length,
        month: { id: monthRow?.id ?? null, year: yearNum, month: monthNum },
      });
    }

    // إرجاع ملف Excel كتحميل
    return new Response(body, {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename=${filename}`,
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
        'Content-Length': String(body.length),
      },
    });
  } catch (e: any) {
    const message = e?.message || 'Export failed';
    if (debug) {
      return Response.json({ ok: false, error: message }, { status: 500 });
    }
    return new Response(message, {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
