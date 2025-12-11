"use client";

import { useEffect, useMemo, useState, useTransition } from 'react';
import { addDays, endOfMonth, format, startOfMonth } from 'date-fns';

type Employee = { id: string; name: string; code: string | null };

type Assignment = { employee_id: string; date: string; symbol: string };

type MonthData = {
  month: { id: string; year: number; month: number };
  employees: Employee[];
  assignments: Assignment[];
  preview?: boolean;
  seed?: number;
  debug?: {
    coverageMorning: number;
    coverageEvening: number;
    totalEmployees: number;
    issues: number;
  };
};

// الجدول المعروض حالياً (في الذاكرة فقط - لا يُحفظ تلقائياً)
let currentDisplayedSchedule: {
  grid: Record<string, Record<string, string>>;
  seed: number;
} | null = null;

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
  const [isPreviewMode, setIsPreviewMode] = useState(true); // وضع المعاينة افتراضياً

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

  // تحديث الـ grid من البيانات
  function updateGridFromData(json: MonthData) {
    setData(json);
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
  }

  // توليد جدول جديد (preview mode - لا يُحفظ في DB)
  async function generateNewSchedule() {
    if (!settings.year || !settings.month) {
      setMsg('الرجاء تحديد السنة والشهر أولاً');
      return;
    }
    
    setIsGenerating(true);
    setMsg('جاري توليد جدول جديد...');
    
    try {
      // ✅ seed عشوائي جديد كل مرة = جدول مختلف كل مرة
      const newSeed = Date.now() + Math.random() * 1000000;
      
      const res = await fetch('/api/schedule/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          year: settings.year, 
          month: settings.month,
          preview: true,  // ❌ لا يحفظ في DB أبداً
          seed: newSeed
        })
      });
      
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      
      // ✅ تحديث الجدول المعروض
      updateGridFromData(json);
      setIsPreviewMode(true);
      
      // ✅ حفظ الـ seed للاستخدام عند الحفظ
      currentDisplayedSchedule = {
        grid: JSON.parse(JSON.stringify(grid)),
        seed: json.seed || newSeed
      };
      
      const d = json.debug || {};
      setMsg(`✅ تم توليد جدول جديد (صباح: ${d.coverageMorning}, مساء: ${d.coverageEvening}) - اضغط "حفظ" للاعتماد`);
    } catch (err: any) {
      setMsg('❌ خطأ: ' + (err.message || 'غير معروف'));
    } finally {
      setIsGenerating(false);
    }
  }

  // تحميل الجدول المحفوظ من DB
  function loadSavedSchedule() {
    if (!settings.year || !settings.month) return;
    startTransition(async () => {
      const res = await fetch(`/api/schedule/${settings.year}/${settings.month}`);
      const json = await res.json();
      if (!res.ok) { 
        setMsg(json.error || 'لا يوجد جدول محفوظ'); 
        return; 
      }
      updateGridFromData(json);
      setIsPreviewMode(false);
      setMsg('تم تحميل الجدول المحفوظ');
    });
  }

  // عند فتح الصفحة: تحميل الجدول المحفوظ أولاً (إن وجد)، وإلا توليد جدول جديد
  useEffect(() => { 
    if (settings.year && settings.month) {
      // محاولة تحميل الجدول المحفوظ أولاً
      loadSavedScheduleOrGenerate();
    }
  }, [settings.year, settings.month]);

  // تحميل الجدول المحفوظ، وإذا لم يوجد يولد جدول جديد
  async function loadSavedScheduleOrGenerate() {
    if (!settings.year || !settings.month) return;
    
    try {
      const res = await fetch(`/api/schedule/${settings.year}/${settings.month}`);
      const json = await res.json();
      
      // إذا وجد جدول محفوظ وفيه بيانات
      if (res.ok && json.assignments && json.assignments.length > 0) {
        updateGridFromData(json);
        setIsPreviewMode(false);
        setMsg('تم تحميل الجدول المحفوظ');
      } else {
        // لا يوجد جدول محفوظ - توليد جدول جديد
        generateNewSchedule();
      }
    } catch {
      // في حالة الخطأ - توليد جدول جديد
      generateNewSchedule();
    }
  }

  // حفظ الجدول المعروض حالياً في DB (بدون تغيير أي شيء في الصفحة)
  async function saveCurrentScheduleToDb() {
    if (!settings.year || !settings.month) {
      setMsg('الرجاء تحديد السنة والشهر أولاً');
      return;
    }
    
    if (!data || !currentDisplayedSchedule) {
      setMsg('❌ لا يوجد جدول للحفظ');
      return;
    }
    
    setIsGenerating(true);
    setMsg('جاري حفظ الجدول المعروض...');
    
    try {
      // حفظ الجدول المعروض حالياً باستخدام نفس الـ seed
      const res = await fetch('/api/schedule/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          year: settings.year, 
          month: settings.month,
          preview: false,  // حفظ في DB
          seed: currentDisplayedSchedule.seed  // نفس الـ seed بالضبط
        })
      });
      
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      
      // ❌ لا نغير الجدول المعروض - فقط نغير الحالة
      setIsPreviewMode(false);
      
      const d = json.debug || {};
      setMsg(`✅ تم حفظ الجدول الرسمي! (صباح: ${d.coverageMorning}, مساء: ${d.coverageEvening})`);
    } catch (err: any) {
      setMsg('❌ خطأ في الحفظ: ' + (err.message || 'غير معروف'));
    } finally {
      setIsGenerating(false);
    }
  }

  // تصدير الجدول المعروض حالياً (وليس المحفوظ في DB)
  async function exportExcel() {
    if (!settings.year || !settings.month) { 
      setMsg('الرجاء تحديد السنة والشهر أولاً'); 
      return; 
    }
    if (!data || !grid) {
      setMsg('❌ لا يوجد جدول للتصدير');
      return;
    }
    
    setMsg('جاري تصدير الجدول المعروض...');
    
    try {
      // تحويل الـ grid المعروض إلى assignments
      const assignments: Assignment[] = [];
      for (const empId of Object.keys(grid)) {
        for (const date of Object.keys(grid[empId] || {})) {
          const symbol = grid[empId][date];
          if (symbol) {
            assignments.push({ employee_id: empId, date, symbol });
          }
        }
      }
      
      // إرسال الجدول المعروض للتصدير
      const res = await fetch('/api/schedule/export-current', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year: settings.year,
          month: settings.month,
          employees: data.employees,
          assignments
        })
      });
      
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'فشل التصدير');
      }
      
      // تحميل الملف
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `schedule_${settings.year}_${String(settings.month).padStart(2, '0')}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
      setMsg('✅ تم تصدير الجدول المعروض بنجاح');
    } catch (err: any) {
      setMsg('❌ خطأ في التصدير: ' + (err.message || 'غير معروف'));
    }
  }

  async function importExcel(file: File) {
    try {
      setIsImporting(true);
      setMsg('جاري استيراد الملف...');
      const form = new FormData();
      form.append('file', file);
      form.append('autoGenerateNext', 'false');
      // إرسال السنة والشهر من الإعدادات الحالية
      if (settings.year) form.append('year', String(settings.year));
      if (settings.month) form.append('month', String(settings.month));

      const res = await fetch('/api/schedule/import', {
        method: 'POST',
        body: form,
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        setMsg('❌ ' + (json.error || 'فشل الاستيراد'));
        return;
      }
      // تحميل الجدول المستورد وعرضه
      loadSavedSchedule();
      setMsg(`✅ تم استيراد جدول الشهر بنجاح (${json.employees} موظفة، ${json.imported} خلية) – هذا الجدول يستخدم كأساس لتوليد الشهر التالي.`);
    } catch (e: any) {
      setMsg('❌ ' + (e?.message || 'فشل الاستيراد'));
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
      setMsg('✅ تم حفظ التعديلات');
      // تحديث الـ grid الأصلي بدون إعادة تحميل
      setGridOriginal(JSON.parse(JSON.stringify(grid)));
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
    <div className="space-y-6">
      {/* معلومات الجدول */}
      {data && (
        <div className="flex flex-wrap items-center gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-white rounded-lg border border-slate-200">
            <span className="text-slate-400">📅</span>
            <span className="text-sm font-medium text-slate-700">{data.month.year}/{String(data.month.month).padStart(2,'0')}</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-white rounded-lg border border-slate-200">
            <span className="text-slate-400">👥</span>
            <span className="text-sm font-medium text-slate-700">{data.employees.length} موظفة</span>
          </div>
          {data.debug && (
            <>
              <div className="flex items-center gap-2 px-3 py-1.5 bg-yellow-50 rounded-lg border border-yellow-200">
                <span>☀️</span>
                <span className="text-sm font-medium text-yellow-700">صباح: {data.debug.coverageMorning}</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 rounded-lg border border-indigo-200">
                <span>🌙</span>
                <span className="text-sm font-medium text-indigo-700">مساء: {data.debug.coverageEvening}</span>
              </div>
            </>
          )}
          <div className="ms-auto">
            {isPreviewMode ? (
              <span className="badge badge-warning">
                <span>⏳</span>
                <span>معاينة - غير محفوظ</span>
              </span>
            ) : (
              <span className="badge badge-success">
                <span>✓</span>
                <span>محفوظ</span>
              </span>
            )}
          </div>
        </div>
      )}
      
      {/* أزرار التحكم */}
      <div className="flex gap-3 items-center flex-wrap">
        {/* زر توليد جدول جديد */}
        <button 
          onClick={generateNewSchedule} 
          className="px-5 py-2.5 bg-gradient-to-r from-indigo-500 to-indigo-600 text-white rounded-xl font-medium shadow-md hover:shadow-lg disabled:opacity-60 flex items-center gap-2 transition-all" 
          disabled={isPending || isGenerating}
        >
          {(isPending || isGenerating) ? (
            <>
              <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>جاري التوليد...</span>
            </>
          ) : (
            <>
              <span>🔄</span>
              <span>توليد جدول جديد</span>
            </>
          )}
        </button>
        
        {/* زر حفظ الجدول */}
        <button 
          onClick={saveCurrentScheduleToDb} 
          className="px-5 py-2.5 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-xl font-medium shadow-md hover:shadow-lg disabled:opacity-60 flex items-center gap-2 transition-all" 
          disabled={isPending || isGenerating || !isPreviewMode}
        >
          <span>💾</span>
          <span>حفظ الجدول</span>
        </button>
        
        {/* زر تحميل المحفوظ */}
        <button 
          onClick={loadSavedSchedule} 
          className="px-5 py-2.5 bg-slate-600 text-white rounded-xl font-medium hover:bg-slate-700 disabled:opacity-60 flex items-center gap-2 transition-all" 
          disabled={isPending}
        >
          <span>📂</span>
          <span>تحميل المحفوظ</span>
        </button>
        
        {/* زر حفظ التعديلات */}
        <button 
          onClick={saveChanges} 
          className="px-5 py-2.5 bg-gradient-to-r from-teal-500 to-teal-600 text-white rounded-xl font-medium shadow-md hover:shadow-lg disabled:opacity-60 flex items-center gap-2 transition-all" 
          disabled={isPending}
        >
          <span>✏️</span>
          <span>حفظ التعديلات</span>
        </button>
        
        <div className="h-8 w-px bg-slate-200 mx-1"></div>
        
        {/* زر تصدير Excel */}
        <button 
          onClick={exportExcel} 
          className="px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl font-medium shadow-md hover:shadow-lg flex items-center gap-2 transition-all"
        >
          <span>📥</span>
          <span>تصدير Excel</span>
        </button>
        
        {/* زر استيراد Excel */}
        <label className="px-5 py-2.5 bg-gradient-to-r from-sky-500 to-sky-600 text-white rounded-xl font-medium shadow-md hover:shadow-lg cursor-pointer flex items-center gap-2 transition-all">
          <span>📤</span>
          <span>{isImporting ? 'جاري الاستيراد...' : 'استيراد Excel'}</span>
          <input
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                importExcel(file);
                e.target.value = '';
              }
            }}
          />
        </label>
      </div>
      
      {/* رسالة الحالة */}
      {msg && (
        <div className={`text-sm p-4 rounded-xl flex items-center gap-3 ${
          msg.startsWith('✅') 
            ? 'bg-green-50 text-green-800 border border-green-200' 
            : msg.startsWith('❌') 
              ? 'bg-red-50 text-red-800 border border-red-200' 
              : 'bg-blue-50 text-blue-800 border border-blue-200'
        }`}>
          <span className="text-lg">{msg.startsWith('✅') ? '✅' : msg.startsWith('❌') ? '❌' : 'ℹ️'}</span>
          <span>{msg.replace(/^[✅❌]\s*/, '')}</span>
        </div>
      )}

      {!data ? (
        <div className="flex flex-col items-center justify-center py-12 text-slate-400">
          <span className="text-4xl mb-3">📊</span>
          <span className="text-sm">جاري تحميل الجدول...</span>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm" dir="ltr">
          <table className="min-w-full text-xs schedule-table">
            <thead>
              <tr>
                <th className="p-3 text-left font-semibold sticky right-0 bg-slate-800 z-20">NAME</th>
                <th className="p-3 text-center font-semibold bg-slate-800">ID</th>
                {headerDays.map((d) => (
                  <th key={d} className="p-2 text-center font-medium" style={{ minWidth: 40 }}>{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.employees.map((emp, empIdx) => (
                <tr key={emp.id} className={empIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                  <td className="p-2 whitespace-nowrap text-left font-medium text-slate-700 sticky right-0 bg-inherit border-l border-slate-200 z-10">
                    {emp.name}
                  </td>
                  <td className="p-2 text-center text-slate-500 border-l border-slate-200">{emp.code || '-'}</td>
                  {headerDays.map((dStr, idx) => {
                    const iso = toISO(data.month.year, data.month.month, Number(dStr));
                    const val = grid[emp.id]?.[iso] ?? '';
                    const upper = val.toString().toUpperCase();

                    // تلوين بحسب نوع الشفت
                    let colorClass = '';
                    if (upper === 'O') {
                      colorClass = 'shift-off';
                    } else if (upper === 'V') {
                      colorClass = 'shift-vacation';
                    } else if (upper === 'B') {
                      colorClass = 'shift-between';
                    } else if (upper.startsWith('M') || upper === 'PT4') {
                      colorClass = 'shift-morning';
                    } else if (upper.startsWith('E') || upper === 'PT5') {
                      colorClass = 'shift-evening';
                    }

                    return (
                      <td key={idx} className={`p-0 text-center border-l border-slate-100 ${colorClass}`}>
                        <input
                          className="w-full text-center py-2 px-1 border-0 focus:ring-2 focus:ring-teal-500 focus:ring-inset bg-transparent font-medium text-slate-700"
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
      
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs">
        <span className="font-medium text-slate-600">دليل الرموز:</span>
        <div className="flex items-center gap-1.5">
          <span className="w-6 h-6 rounded shift-morning flex items-center justify-center font-medium">M</span>
          <span className="text-slate-600">صباح</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-6 h-6 rounded shift-evening flex items-center justify-center font-medium">E</span>
          <span className="text-slate-600">مساء</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-6 h-6 rounded shift-off flex items-center justify-center font-medium">O</span>
          <span className="text-slate-600">إجازة أسبوعية</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-6 h-6 rounded shift-vacation flex items-center justify-center font-medium">V</span>
          <span className="text-slate-600">إجازة</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-6 h-6 rounded shift-between flex items-center justify-center font-medium">B</span>
          <span className="text-slate-600">Between</span>
        </div>
      </div>
    </div>
  );
}
