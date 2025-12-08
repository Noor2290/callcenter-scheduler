"use client";

import { useEffect, useMemo, useState, useTransition } from 'react';
import { addDays, endOfMonth, format, startOfMonth } from 'date-fns';

type Employee = { id: string; name: string; code: string | null };

type Assignment = { employee_id: string; date: string; symbol: string };

type MonthData = {
  month: { id: string; year: number; month: number };
  employees: Employee[];
  assignments: Assignment[];
};

function toISO(y: number, m: number, d: number) {
  return format(new Date(y, m - 1, d), 'yyyy-MM-dd');
}

export default function ScheduleGrid() {
  const [settings, setSettings] = useState<{ year?: number; month?: number }>({});
  const [data, setData] = useState<MonthData | null>(null);
  const [grid, setGrid] = useState<Record<string, Record<string, string>>>({}); // empId -> dateISO -> symbol (local edits only)
  const [gridOriginal, setGridOriginal] = useState<Record<string, Record<string, string>>>({}); // snapshot from server
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  // load settings for year/month
  useEffect(() => {
    fetch('/api/settings').then((r) => r.json()).then((s) => setSettings({ year: s.year, month: s.month }));
  }, []);

  const daysInMonth = useMemo(() => {
    if (!settings.year || !settings.month) return 0;
    const start = startOfMonth(new Date(settings.year, (settings.month || 1) - 1, 1));
    const end = endOfMonth(start);
    return Number(format(end, 'd'));
  }, [settings.year, settings.month]);

  function loadMonth() {
    if (!settings.year || !settings.month) return;
    startTransition(async () => {
      const res = await fetch(`/api/schedule/${settings.year}/${settings.month}`);
      const json = await res.json();
      if (!res.ok) { setMsg(json.error || 'Failed to load schedule'); return; }
      setData(json);
      // Build grid map
      const g: Record<string, Record<string, string>> = {};
      for (const emp of json.employees) {
        g[emp.id] = {};
      }
      for (const a of json.assignments) {
        if (!g[a.employee_id]) g[a.employee_id] = {};
        g[a.employee_id][a.date] = a.symbol;
      }
      setGrid(g);
      setGridOriginal(JSON.parse(JSON.stringify(g)));
    });
  }

  useEffect(() => { loadMonth(); }, [settings.year, settings.month]);

  async function generate() {
    console.log('Generate clicked! Settings:', settings);
    
    if (!settings.year || !settings.month) { 
      console.log('Missing year or month!');
      setMsg('الرجاء تحديد السنة والشهر أولاً'); 
      return; 
    }
    
    console.log('Starting generation for:', settings.year, settings.month);
    setIsGenerating(true);
    setMsg('جاري إنشاء جدول جديد...');
    
    try {
      const res = await fetch('/api/schedule/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          year: settings.year, 
          month: settings.month
        })
      });
      
      const data = await res.json();
      console.log('Generate response:', data);
      
      if (data.error) throw new Error(data.error);
      
      // إعادة تحميل الجدول
      loadMonth();
      
      // Build detailed message
      const d = data.debug || {};
      const morningInfo = d.coverageMorningSource === 'database' 
        ? `صباح: ${d.coverageMorning} ✓` 
        : `صباح: ${d.coverageMorning} (افتراضي)`;
      const eveningInfo = d.coverageEveningSource === 'database'
        ? `مساء: ${d.coverageEvening} ✓`
        : `مساء: ${d.coverageEvening} (افتراضي)`;
      
      setMsg(`تم إنشاء الجدول بنجاح! (موظفات: ${d.totalEmployees || '?'}, ${morningInfo}, ${eveningInfo})`);
    } catch (err: any) {
      console.error('Error generating schedule:', err);
      setMsg('حدث خطأ أثناء إنشاء الجدول: ' + (err.message || 'غير معروف'));
    } finally {
      setIsGenerating(false);
    }
  }

  function exportExcel() {
    if (!settings.year || !settings.month) { setMsg('Set Year/Month in Settings first'); return; }
    window.location.href = `/api/schedule/export/${settings.year}/${settings.month}`;
  }

  async function importExcel(file: File) {
    try {
      setIsImporting(true);
      setMsg('جاري استيراد الملف...');
      const form = new FormData();
      form.append('file', file);
      form.append('autoGenerateNext', 'false');

      const res = await fetch('/api/schedule/import', {
        method: 'POST',
        body: form,
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        setMsg(json.error || 'فشل الاستيراد');
        return;
      }
      setMsg('تم الاستيراد بنجاح');
      loadMonth();
    } catch (e: any) {
      setMsg(e?.message || 'فشل الاستيراد');
    } finally {
      setIsImporting(false);
    }
  }

  function saveChanges() {
    if (!settings.year || !settings.month) { setMsg('حدد السنة/الشهر أولاً'); return; }
    const changes: { employee_id: string; date: string; symbol: string }[] = [];
    for (const empId of Object.keys(grid)) {
      const row = grid[empId] || {};
      const base = gridOriginal[empId] || {};
      const dates = new Set([...Object.keys(row), ...Object.keys(base)]);
      for (const d of dates) {
        const v = (row[d] || '').toString().toUpperCase();
        const b = (base[d] || '').toString().toUpperCase();
        if (v !== b) {
          changes.push({ employee_id: empId, date: d, symbol: v });
        }
      }
    }
    if (changes.length === 0) { setMsg('لا توجد تغييرات للحفظ'); return; }
    setMsg(null);
    startTransition(async () => {
      const res = await fetch('/api/schedule/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: settings.year, month: settings.month, changes }),
      });
      const json = await res.json();
      if (!res.ok) { setMsg(json.error || 'فشل الحفظ'); return; }
      setMsg('تم الحفظ');
      loadMonth();
    });
  }

  function setCell(empId: string, dateISO: string, value: string) {
    setGrid((g) => ({ ...g, [empId]: { ...(g[empId] || {}), [dateISO]: value } }));
  }

  const headerDays = useMemo(() => {
    if (!settings.year || !settings.month) return [] as string[];
    const start = startOfMonth(new Date(settings.year, (settings.month || 1) - 1, 1));
    const end = endOfMonth(start);
    const days: string[] = [];
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
      days.push(format(d, 'd'));
    }
    return days;
  }, [settings.year, settings.month]);

  return (
    <div className="space-y-4">
      {data && (
        <div className="text-xs text-gray-600">
          الشهر: {data.month.year}-{String(data.month.month).padStart(2,'0')} • الموظفات: {data.employees.length} • التعيينات: {data.assignments.length}
          {data.assignments.length === 0 && (
            <span className="text-rose-600 ml-2">لا توجد تعيينات لهذا الشهر. اضغط "توليد الجدول" بعد ضبط السنة/الشهر.</span>
          )}
        </div>
      )}
      <div className="flex gap-2 items-center">
        <button 
          onClick={generate} 
          className="px-4 py-2 bg-indigo-600 text-white rounded disabled:opacity-60 flex items-center gap-2" 
          disabled={isPending || isGenerating}
        >
          {(isPending || isGenerating) ? (
            <>
              <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              جاري التوليد...
            </>
          ) : (
            'توليد جدول'
          )}
        </button>
        <button onClick={saveChanges} className="px-4 py-2 bg-teal-600 text-white rounded disabled:opacity-60" disabled={isPending}>حفظ التعديلات</button>
        <button onClick={exportExcel} className="px-4 py-2 bg-emerald-600 text-white rounded">تصدير Excel</button>
        <label className="px-4 py-2 bg-sky-600 text-white rounded cursor-pointer disabled:opacity-60">
          {isImporting ? 'جاري الاستيراد...' : 'استيراد من Excel'}
          <input
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                importExcel(file);
                // allow selecting the same file again later
                e.target.value = '';
              }
            }}
          />
        </label>
      </div>
      {msg && <div className="text-sm text-red-600">{msg}</div>}

      {!data ? (
        <div className="text-sm text-gray-500">Load or set settings to view schedule…</div>
      ) : (
        <div className="overflow-x-auto border rounded" dir="ltr">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-2 text-left">NAME</th>
                <th className="p-2 text-center">ID</th>
                {headerDays.map((d) => (
                  <th key={d} className="p-2 text-center" style={{ minWidth: 36 }}>{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.employees.map((emp) => (
                <tr key={emp.id} className="border-t">
                  <td className="p-2 whitespace-nowrap text-left">{emp.name}</td>
                  <td className="p-2 text-center">{emp.code || '-'}</td>
                  {headerDays.map((dStr, idx) => {
                    const iso = toISO(data.month.year, data.month.month, Number(dStr));
                    const val = grid[emp.id]?.[iso] ?? '';
                    const upper = val.toString().toUpperCase();

                    // تلوين بحسب نوع الشفت
                    // صباح: MA*, M*, PT4 → أصفر فاتح
                    // مساء: EA*, E*, PT5 → أزرق/بنفسجي فاتح
                    // Off: O → رمادي فاتح
                    // Vacation: V → برتقالي فاتح
                    let color = '';
                    if (upper === 'O') {
                      color = 'bg-gray-200';
                    } else if (upper === 'V') {
                      color = 'bg-orange-200';
                    } else if (upper.startsWith('M') || upper === 'PT4') {
                      color = 'bg-yellow-100';
                    } else if (upper.startsWith('E') || upper === 'PT5') {
                      color = 'bg-indigo-100';
                    }

                    return (
                      <td key={idx} className={"p-0 text-center " + color}>
                        <input
                          className="w-16 text-center p-1 border-0 focus:ring-0 bg-transparent"
                          value={val}
                          onChange={(e)=>setCell(emp.id, iso, e.target.value.toUpperCase())}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="text-xs text-gray-600">
        Legend: MA1/EA1 (FullTime), PT4/PT5 (PartTime), M2/E2 (Trainee), O Off, V Vacation
      </div>
    </div>
  );
}
