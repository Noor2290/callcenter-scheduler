"use client";

import { memo, useCallback, useEffect, useMemo, useState, useTransition } from 'react';
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

// Memoized row to avoid re-rendering all rows on each cell edit
const ScheduleRow = memo(function ScheduleRow({
  emp,
  row,
  headerDays,
  year,
  month,
  onSetCell,
  readOnly,
}: {
  emp: Employee;
  row: Record<string, string>;
  headerDays: string[];
  year: number;
  month: number;
  onSetCell: (dateISO: string, value: string) => void;
  readOnly: boolean;
}) {
  return (
    <tr className="border-t">
      <td className="p-2 whitespace-nowrap text-left">{emp.name}</td>
      <td className="p-2 text-center">{emp.code || '-'}</td>
      {headerDays.map((dStr, idx) => {
        const iso = toISO(year, month, Number(dStr));
        const val = row?.[iso] ?? '';
        const isM = typeof val === 'string' && val.startsWith('M');
        const isE = typeof val === 'string' && val.startsWith('E');
        const isB = val === 'B' || val === 'BT' || val === 'Between';
        const color = val === 'O'
          ? 'bg-gray-200 text-gray-800'
          : val === 'V'
          ? 'bg-red-100 text-red-800'
          : isM
          ? 'bg-yellow-100 text-yellow-800'
          : isE
          ? 'bg-blue-100 text-blue-800'
          : isB
          ? 'bg-teal-100 text-teal-800'
          : '';
        return (
          <td key={idx} className={"p-0 text-center " + color}>
            <input
              className="w-16 text-center p-1 border-0 focus:ring-0 bg-transparent"
              value={val}
              readOnly={readOnly}
              onChange={(e) => onSetCell(iso, e.target.value.toUpperCase())}
            />
          </td>
        );
      })}
    </tr>
  );
});

export default function ScheduleGrid() {
  const [settings, setSettings] = useState<{ year?: number; month?: number }>({});
  const [data, setData] = useState<MonthData | null>(null);
  const [grid, setGrid] = useState<Record<string, Record<string, string>>>({}); // empId -> dateISO -> symbol (local edits only)
  const [gridOriginal, setGridOriginal] = useState<Record<string, Record<string, string>>>({}); // snapshot from server
  const [isPending, startTransition] = useTransition();
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [autoGenTried, setAutoGenTried] = useState(false);

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

  function loadMonth(overrideYear?: number, overrideMonth?: number) {
    const y = overrideYear ?? settings.year;
    const m = overrideMonth ?? settings.month;
    if (!y || !m) return;
    startTransition(async () => {
      const res = await fetch(`/api/schedule/${y}/${m}`);
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

  // Run auto-generate after data loads to avoid nested transitions
  useEffect(() => {
    (async () => {
      if (!data || autoGenTried) return;
      const empty = (data.assignments?.length || 0) === 0;
      try {
        const sres = await fetch('/api/settings');
        const s = await sres.json();
        const key = `approved:${settings.year}-${String(settings.month).padStart(2,'0')}`;
        const approved = (s?.[key] ?? s?.settings?.[key] ?? s?.items?.find?.((x: any)=>x.key===key)?.value) === 'true';
        if (empty || !approved) {
          setAutoGenTried(true);
          generate(`${settings.year}-${settings.month}-auto`);
        }
      } catch {
        // ignore
      }
    })();
  }, [data, autoGenTried, settings.year, settings.month]);

  function generate(seedOverride?: string) {
    if (!settings.year || !settings.month) { setMsg('Set Year/Month in Settings first'); return; }
    setMsg(null);
    startTransition(async () => {
      setIsGenerating(true);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 65000);
      try {
        const res = await fetch('/api/schedule/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            year: settings.year,
            month: settings.month,
            seed: seedOverride ?? `${Date.now()}-${Math.random()}`,
          }),
          signal: controller.signal,
        });
        let json: any = {};
        try { json = await res.json(); } catch {}
        if (!res.ok) { setMsg(json?.error || 'فشل التوليد'); return; }
        loadMonth();
      } catch (e: any) {
        if (e?.name === 'AbortError') {
          setMsg('الخادم يستغرق وقتاً طويلاً (60 ثانية). تحقق من الإعدادات والاتصال ثم حاول مجدداً.');
        } else {
          setMsg(e?.message || 'تعذر الاتصال بالخادم');
        }
      } finally {
        clearTimeout(timer);
        setIsGenerating(false);
      }
    });
  }

  const busy = isPending || isGenerating || isSaving;

  async function approveMonth() {
    if (!settings.year || !settings.month) { setMsg('Set Year/Month in Settings first'); return; }
    setMsg(null);
    setIsApproving(true);
    try {
      const res = await fetch('/api/schedule/approve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: settings.year, month: settings.month }),
      });
      const json = await res.json();
      if (!res.ok) { setMsg(json.error || 'فشل اعتماد الشهر'); return; }
      setMsg('تم اعتماد الشهر');
    } catch (e: any) {
      setMsg(e?.message || 'تعذر الاتصال بالخادم');
    } finally {
      setIsApproving(false);
    }
  }

  function exportExcel() {
    if (!settings.year || !settings.month) { setMsg('Set Year/Month in Settings first'); return; }
    window.location.href = `/api/schedule/export/${settings.year}/${settings.month}`;
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
      setIsSaving(true);
      try {
        const res = await fetch('/api/schedule/save', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ year: settings.year, month: settings.month, changes }),
        });
        const json = await res.json();
        if (!res.ok) { setMsg(json.error || 'فشل الحفظ'); return; }
        setMsg('تم الحفظ');
        loadMonth();
      } catch (e: any) {
        setMsg(e?.message || 'تعذر الحفظ');
      } finally {
        setIsSaving(false);
      }
    });
  }

  const setCell = useCallback((empId: string, dateISO: string, value: string) => {
    setGrid((g) => ({ ...g, [empId]: { ...(g[empId] || {}), [dateISO]: value } }));
  }, []);

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
        <button onClick={() => generate()} className="px-4 py-2 bg-indigo-600 text-white rounded disabled:opacity-60" disabled={isGenerating}>توليد الجدول</button>
        <button onClick={saveChanges} className="px-4 py-2 bg-teal-600 text-white rounded disabled:opacity-60" disabled={isSaving}>حفظ التعديلات</button>
        <button onClick={approveMonth} className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-60" disabled={isApproving}>اعتماد الشهر</button>
        <button onClick={exportExcel} className="px-4 py-2 bg-emerald-600 text-white rounded">تصدير Excel</button>
        <label className="px-4 py-2 bg-slate-600 text-white rounded cursor-pointer">
          استيراد Excel
          <input type="file" accept=".xlsx,.xls" className="hidden" onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const fd = new FormData();
            fd.append('file', f);
            fd.append('autoGenerateNext', 'true');
            try {
              const res = await fetch('/api/schedule/import', { method: 'POST', body: fd });
              const json = await res.json();
              if (!res.ok) { setMsg(json.error || 'فشل الاستيراد'); return; }
              const ym = (json.year && json.month) ? ` شهر ${json.year}-${String(json.month).padStart(2,'0')}` : '';
              setMsg(`تم استيراد${ym}` + (json.nextGenerated ? ' وتم توليد الشهر التالي تلقائياً' : ''));
              // If API detected a specific year/month from the file, persist and switch the view to it
              if (json.year && json.month) {
                try {
                  await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ year: json.year, month: json.month }) });
                } catch {}
                setSettings((s) => ({ ...s, year: json.year, month: json.month }));
                loadMonth(Number(json.year), Number(json.month));
              } else {
                loadMonth();
              }
            } catch (err: any) {
              setMsg(err?.message || 'فشل الاستيراد');
            } finally {
              e.currentTarget.value = '';
            }
          }} />
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
                <ScheduleRow
                  key={emp.id}
                  emp={emp}
                  row={grid[emp.id] || {}}
                  headerDays={headerDays}
                  year={data.month.year}
                  month={data.month.month}
                  onSetCell={(iso, v) => setCell(emp.id, iso, v)}
                  readOnly={busy}
                />
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
