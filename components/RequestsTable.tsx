"use client";

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';

type Employee = { id: string; name: string };

type RequestItem = {
  id?: string;
  employee_id: string;
  date?: string; // YYYY-MM-DD (single day)
  start?: string; // YYYY-MM-DD (range start for Vacation)
  end?: string;   // YYYY-MM-DD (range end for Vacation)
  type: 'Vacation' | 'OffRequest';
};

// نوع للعرض المجمّع
type GroupedRequest = {
  employee_id: string;
  type: 'Vacation' | 'OffRequest';
  startDate: string;
  endDate: string;
  ids: string[]; // جميع الـ IDs للحذف
  daysCount: number;
};

export default function RequestsTable() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [items, setItems] = useState<RequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<RequestItem>({ employee_id: '', date: '', start: '', end: '', type: 'Vacation' });

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      const [r1, r2] = await Promise.all([
        fetch('/api/employees').then((r) => r.json()),
        fetch('/api/requests').then((r) => r.json()),
      ]);
      if (!mounted) return;
      if (r1.items) setEmployees(r1.items);
      if (r2.items) setItems(r2.items);
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, []);

  function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.employee_id || !form.type) { setError('All fields required'); return; }
    if (form.type === 'OffRequest' && !form.date) { setError('Date is required for OffRequest'); return; }
    if (form.type === 'Vacation') {
      const hasRange = !!form.start && !!form.end;
      const hasSingle = !!form.date;
      if (!hasRange && !hasSingle) { setError('Provide date or start/end for Vacation'); return; }
    }
    startTransition(async () => {
      const payload: any = { employee_id: form.employee_id, type: form.type };
      if (form.type === 'Vacation') {
        if (form.start && form.end) { payload.start = form.start; payload.end = form.end; }
        else if (form.date) { payload.date = form.date; }
      } else if (form.type === 'OffRequest') {
        payload.date = form.date;
      }

      const res = await fetch('/api/requests/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [payload] }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to save'); return; }
      const res2 = await fetch('/api/requests');
      const json2 = await res2.json();
      if (res2.ok) setItems(json2.items || []);
      setForm({ employee_id: '', date: '', start: '', end: '', type: 'Vacation' });
    });
  }

  // دمج الإجازات المتتالية للعرض فقط
  const groupedItems = useMemo(() => {
    const result: GroupedRequest[] = [];
    
    // فصل OffRequest و Vacation
    const offRequests = items.filter(i => i.type === 'OffRequest');
    const vacations = items.filter(i => i.type === 'Vacation');
    
    // OffRequest: كل واحد سطر مستقل
    for (const req of offRequests) {
      if (req.date && req.id) {
        result.push({
          employee_id: req.employee_id,
          type: 'OffRequest',
          startDate: req.date,
          endDate: req.date,
          ids: [req.id],
          daysCount: 1
        });
      }
    }
    
    // Vacation: تجميع الأيام المتتالية لنفس الموظفة
    // أولاً: تجميع حسب الموظفة
    const vacationsByEmployee = new Map<string, RequestItem[]>();
    for (const v of vacations) {
      if (!v.date || !v.id) continue;
      const list = vacationsByEmployee.get(v.employee_id) || [];
      list.push(v);
      vacationsByEmployee.set(v.employee_id, list);
    }
    
    // ثانياً: لكل موظفة، دمج الأيام المتتالية
    for (const [empId, empVacations] of vacationsByEmployee) {
      // ترتيب حسب التاريخ
      const sorted = empVacations.slice().sort((a, b) => 
        (a.date || '').localeCompare(b.date || '')
      );
      
      let currentGroup: { start: string; end: string; ids: string[] } | null = null;
      
      for (const v of sorted) {
        const date = v.date!;
        const id = v.id!;
        
        if (!currentGroup) {
          // بداية مجموعة جديدة
          currentGroup = { start: date, end: date, ids: [id] };
        } else {
          // التحقق إذا كان اليوم متتالي
          const prevDate = new Date(currentGroup.end);
          const currDate = new Date(date);
          const diffDays = Math.round((currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));
          
          if (diffDays === 1) {
            // يوم متتالي - إضافة للمجموعة الحالية
            currentGroup.end = date;
            currentGroup.ids.push(id);
          } else {
            // يوم غير متتالي - حفظ المجموعة الحالية وبدء جديدة
            result.push({
              employee_id: empId,
              type: 'Vacation',
              startDate: currentGroup.start,
              endDate: currentGroup.end,
              ids: currentGroup.ids,
              daysCount: currentGroup.ids.length
            });
            currentGroup = { start: date, end: date, ids: [id] };
          }
        }
      }
      
      // حفظ المجموعة الأخيرة
      if (currentGroup) {
        result.push({
          employee_id: empId,
          type: 'Vacation',
          startDate: currentGroup.start,
          endDate: currentGroup.end,
          ids: currentGroup.ids,
          daysCount: currentGroup.ids.length
        });
      }
    }
    
    // ترتيب النتيجة حسب التاريخ ثم الموظفة
    return result.sort((a, b) => {
      const dateCompare = a.startDate.localeCompare(b.startDate);
      if (dateCompare !== 0) return dateCompare;
      return a.employee_id.localeCompare(b.employee_id);
    });
  }, [items]);

  // حذف مجموعة من الطلبات
  async function deleteGroup(ids: string[]) {
    startTransition(async () => {
      // حذف جميع الـ IDs
      for (const id of ids) {
        await fetch(`/api/requests/${id}`, { method: 'DELETE' });
      }
      // إعادة تحميل القائمة
      const res2 = await fetch('/api/requests');
      const json2 = await res2.json();
      if (res2.ok) setItems(json2.items || []);
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <span>📋</span>
          <span>الطلبات المسجلة</span>
          <span className="text-sm font-normal text-slate-500">({groupedItems.length} طلب)</span>
        </h2>
        {loading ? (
          <div className="flex items-center justify-center py-8 text-slate-400">
            <span className="text-2xl mr-2">⏳</span>
            <span>جاري التحميل...</span>
          </div>
        ) : groupedItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-300">
            <span className="text-3xl mb-2">📭</span>
            <span>لا توجد طلبات مسجلة</span>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-800 text-white">
                <tr>
                  <th className="text-right p-3 font-medium">الموظفة</th>
                  <th className="text-right p-3 font-medium">النوع</th>
                  <th className="text-right p-3 font-medium">من تاريخ</th>
                  <th className="text-right p-3 font-medium">إلى تاريخ</th>
                  <th className="text-center p-3 font-medium">الأيام</th>
                  <th className="text-center p-3 font-medium">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {groupedItems.map((group, idx) => {
                  const emp = employees.find((e) => e.id === group.employee_id);
                  const isVacation = group.type === 'Vacation';
                  const isMultiDay = group.daysCount > 1;
                  
                  return (
                    <tr 
                      key={idx} 
                      className={`border-t border-slate-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'} hover:bg-slate-100 transition-colors`}
                    >
                      <td className="p-3 font-medium text-slate-700">{emp?.name || group.employee_id}</td>
                      <td className="p-3">
                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
                          isVacation 
                            ? 'bg-orange-100 text-orange-700 border border-orange-200' 
                            : 'bg-blue-100 text-blue-700 border border-blue-200'
                        }`}>
                          <span>{isVacation ? '🏖️' : '📅'}</span>
                          <span>{isVacation ? 'إجازة' : 'طلب أوف'}</span>
                        </span>
                      </td>
                      <td className="p-3 text-slate-600">{group.startDate}</td>
                      <td className="p-3 text-slate-600">
                        {isMultiDay ? group.endDate : '-'}
                      </td>
                      <td className="p-3 text-center">
                        {isMultiDay ? (
                          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-teal-100 text-teal-700 font-bold text-xs">
                            {group.daysCount}
                          </span>
                        ) : (
                          <span className="text-slate-400">1</span>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        <button
                          onClick={() => deleteGroup(group.ids)}
                          disabled={isPending}
                          className="px-4 py-1.5 rounded-lg text-xs font-medium bg-rose-100 text-rose-700 hover:bg-rose-200 border border-rose-200 disabled:opacity-50 transition-colors flex items-center gap-1 mx-auto"
                        >
                          <span>🗑️</span>
                          <span>حذف{isMultiDay ? ` (${group.daysCount})` : ''}</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* نموذج إضافة طلب */}
      <form onSubmit={onAdd} className="bg-slate-50 rounded-xl border border-slate-200 p-6 space-y-5">
        <h3 className="font-semibold text-slate-800 flex items-center gap-2">
          <span>➕</span>
          <span>إضافة طلب جديد</span>
        </h3>
        
        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            <span>❌</span>
            <span>{error}</span>
          </div>
        )}
        
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* اختيار الموظفة */}
          <label className="flex flex-col text-sm">
            <span className="mb-2 font-medium text-slate-700">الموظفة</span>
            <select 
              className="border border-slate-300 rounded-lg p-2.5 bg-white focus:ring-2 focus:ring-teal-500 focus:border-teal-500" 
              value={form.employee_id} 
              onChange={(e)=>setForm((f)=>({ ...f, employee_id: e.target.value }))}
            >
              <option value="">اختر الموظفة</option>
              {employees.map((e)=> <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          
          {/* اختيار النوع */}
          <label className="flex flex-col text-sm">
            <span className="mb-2 font-medium text-slate-700">النوع</span>
            <select 
              className="border border-slate-300 rounded-lg p-2.5 bg-white focus:ring-2 focus:ring-teal-500 focus:border-teal-500" 
              value={form.type} 
              onChange={(e)=>setForm((f)=>({ ...f, type: e.target.value as RequestItem['type'] }))}
            >
              <option value="Vacation">🏖️ إجازة (Vacation)</option>
              <option value="OffRequest">📅 طلب أوف (OffRequest)</option>
            </select>
          </label>
          
          {/* التاريخ */}
          {form.type === 'OffRequest' ? (
            <label className="flex flex-col text-sm">
              <span className="mb-2 font-medium text-slate-700">التاريخ</span>
              <input 
                type="date" 
                className="border border-slate-300 rounded-lg p-2.5 bg-white focus:ring-2 focus:ring-teal-500 focus:border-teal-500" 
                value={form.date || ''} 
                onChange={(e)=>setForm((f)=>({ ...f, date: e.target.value }))} 
              />
            </label>
          ) : (
            <>
              <label className="flex flex-col text-sm">
                <span className="mb-2 font-medium text-slate-700">من تاريخ</span>
                <input 
                  type="date" 
                  className="border border-slate-300 rounded-lg p-2.5 bg-white focus:ring-2 focus:ring-teal-500 focus:border-teal-500" 
                  value={form.start || ''} 
                  onChange={(e)=>setForm((f)=>({ ...f, start: e.target.value }))} 
                />
              </label>
              <label className="flex flex-col text-sm">
                <span className="mb-2 font-medium text-slate-700">إلى تاريخ</span>
                <input 
                  type="date" 
                  className="border border-slate-300 rounded-lg p-2.5 bg-white focus:ring-2 focus:ring-teal-500 focus:border-teal-500" 
                  value={form.end || ''} 
                  onChange={(e)=>setForm((f)=>({ ...f, end: e.target.value }))} 
                />
              </label>
            </>
          )}
        </div>
        
        <button 
          type="submit" 
          className="px-6 py-2.5 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-xl font-medium shadow-md hover:shadow-lg disabled:opacity-60 flex items-center gap-2 transition-all" 
          disabled={isPending}
        >
          <span>{isPending ? '⏳' : '✅'}</span>
          <span>{isPending ? 'جاري الحفظ...' : 'إضافة الطلب'}</span>
        </button>
      </form>
    </div>
  );
}
