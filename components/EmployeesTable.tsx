"use client";

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import clsx from 'clsx';

export type Employee = {
  id?: string;
  code?: string;
  name: string;
  employment_type: 'FullTime' | 'PartTime' | 'Trainee';
  allowed_shifts?: string[]; // ['Morning','Evening']
  preferred_days_off?: string[]; // e.g. ['Saturday']
};

function EmptyState() {
  return (
    <div className="text-sm text-gray-500 border rounded p-6 text-center">
      لا يوجد موظفات حتى الآن — أضف أول اسم بالأسفل.
    </div>
  );
}

export default function EmployeesTable() {
  const [items, setItems] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // شريط إضافة سريع بالاسم فقط
  const [quickName, setQuickName] = useState('');
  const [quickCode, setQuickCode] = useState('');

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      const res = await fetch('/api/employees');
      const data = await res.json();
      if (!mounted) return;
      if (!res.ok) {
        setError(data.error || 'فشل التحميل');
      } else {
        setItems(data.items || []);
      }
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, []);

  async function addQuick(e: React.FormEvent) {
    e.preventDefault();
    const name = quickName.trim();
    const code = quickCode.trim();
    if (!name) return;
    setError(null);
    startTransition(async () => {
      const res = await fetch('/api/employees/bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ code: code || null, name, employment_type: 'FullTime', allowed_shifts: ['Morning','Evening'] }] }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'فشل الإضافة'); return; }
      const res2 = await fetch('/api/employees');
      const data2 = await res2.json();
      if (res2.ok) setItems(data2.items || []);
      setQuickName('');
      setQuickCode('');
    });
  }

  async function patchEmployee(id: string | undefined, partial: Partial<Employee>) {
    if (!id) return;
    await fetch(`/api/employees/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(partial),
    });
  }

  async function remove(id?: string) {
    if (!id) return;
    startTransition(async () => {
      const res = await fetch(`/api/employees/${id}`, { method: 'DELETE' });
      if (!res.ok) return;
      const res2 = await fetch('/api/employees');
      const data2 = await res2.json();
      if (res2.ok) setItems(data2.items || []);
    });
  }

  const sorted = useMemo(() => items.slice().sort((a,b) => (a.name||'').localeCompare(b.name||'')), [items]);

  return (
    <div className="space-y-4">
      {loading ? (
        <div className="text-sm text-gray-500">جاري التحميل…</div>
      ) : sorted.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="card overflow-hidden">
          <ul className="divide-y">
            {sorted.map((e) => (
              <li key={e.id} className="flex items-center gap-2 py-1">
                <button onClick={() => remove(e.id)} className="m-2 btn btn-danger text-sm">حذف</button>
                <input
                  className="w-28 border border-[var(--border)] rounded-md p-2 text-center bg-white focus:outline-none focus:ring-2 focus:ring-[var(--brand-600)]/20"
                  placeholder="ID"
                  value={e.code ?? ''}
                  onChange={(ev)=>{
                    const v = ev.target.value;
                    setItems((arr)=>arr.map((it)=> it.id===e.id ? { ...it, code: v } : it));
                  }}
                  onBlur={(ev)=>patchEmployee(e.id, { code: ev.target.value || null as any })}
                />
                <input
                  className="flex-1 border border-[var(--border)] rounded-md p-2 text-right bg-white focus:outline-none focus:ring-2 focus:ring-[var(--brand-600)]/20"
                  placeholder="الاسم"
                  value={e.name}
                  onChange={(ev)=>{
                    const v = ev.target.value;
                    setItems((arr)=>arr.map((it)=> it.id===e.id ? { ...it, name: v } : it));
                  }}
                  onBlur={(ev)=>patchEmployee(e.id, { name: ev.target.value })}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <div className="text-sm text-rose-600">{error}</div>}

      <form onSubmit={addQuick} className="flex items-center gap-2">
        <button type="submit" className={clsx('btn btn-primary', isPending && 'opacity-60')} disabled={isPending}>
          + إضافة
        </button>
        <input
          className="w-32 border border-[var(--border)] rounded-md p-2 text-center bg-white focus:outline-none focus:ring-2 focus:ring-[var(--brand-600)]/20"
          placeholder="ID رقم"
          value={quickCode}
          onChange={(e)=>setQuickCode(e.target.value)}
        />
        <input
          className="flex-1 border border-[var(--border)] rounded-md p-2 text-right bg-white focus:outline-none focus:ring-2 focus:ring-[var(--brand-600)]/20"
          placeholder="اسم جديد"
          value={quickName}
          onChange={(e)=>setQuickName(e.target.value)}
        />
      </form>

      <div className="flex justify-end">
        <Link href="/settings" className="btn btn-primary">التالي</Link>
      </div>
    </div>
  );
}
