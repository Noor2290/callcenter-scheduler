"use client";

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';

type Employee = { id: string; name: string };

type RequestItem = {
  id?: string;
  employee_id: string;
  date: string; // YYYY-MM-DD
  type: 'Vacation' | 'OffRequest';
};

export default function RequestsTable() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [items, setItems] = useState<RequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<RequestItem>({ employee_id: '', date: '', type: 'Vacation' });

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
    if (!form.employee_id || !form.date || !form.type) { setError('All fields required'); return; }
    startTransition(async () => {
      const res = await fetch('/api/requests/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [form] }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to save'); return; }
      const res2 = await fetch('/api/requests');
      const json2 = await res2.json();
      if (res2.ok) setItems(json2.items || []);
      setForm({ employee_id: '', date: '', type: 'Vacation' });
    });
  }

  const itemsSorted = useMemo(() => items.slice().sort((a,b) => a.date.localeCompare(b.date)), [items]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-medium mb-2">Requests</h2>
        {loading ? (
          <div className="text-sm text-gray-500">Loading…</div>
        ) : (
          <div className="overflow-x-auto border rounded">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left p-2">Employee</th>
                  <th className="text-left p-2">Date</th>
                  <th className="text-left p-2">Type</th>
                  <th className="text-left p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {itemsSorted.map((r, idx) => {
                  const emp = employees.find((e) => e.id === r.employee_id);
                  return (
                    <tr className="border-t" key={idx}>
                      <td className="p-2">{emp?.name || r.employee_id}</td>
                      <td className="p-2">{r.date}</td>
                      <td className="p-2">{r.type}</td>
                      <td className="p-2">
                        <button
                          onClick={() => {
                            startTransition(async () => {
                              const res = await fetch(`/api/requests/${r.id}`, { method: 'DELETE' });
                              if (!res.ok) return;
                              const res2 = await fetch('/api/requests');
                              const json2 = await res2.json();
                              if (res2.ok) setItems(json2.items || []);
                            });
                          }}
                          className="px-3 py-1.5 rounded-full text-sm bg-rose-100 text-rose-700 hover:bg-rose-200"
                        >حذف</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <form onSubmit={onAdd} className="border rounded p-4 space-y-4">
        <h3 className="font-medium">Add Request</h3>
        {error && <div className="text-sm text-red-600">{error}</div>}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <label className="flex flex-col text-sm">
            <span className="mb-1">Employee</span>
            <select className="border rounded p-2" value={form.employee_id} onChange={(e)=>setForm((f)=>({ ...f, employee_id: e.target.value }))}>
              <option value="">Select employee</option>
              {employees.map((e)=> <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col text-sm">
            <span className="mb-1">Date</span>
            <input type="date" className="border rounded p-2" value={form.date} onChange={(e)=>setForm((f)=>({ ...f, date: e.target.value }))} />
          </label>
          <label className="flex flex-col text-sm">
            <span className="mb-1">Type</span>
            <select className="border rounded p-2" value={form.type} onChange={(e)=>setForm((f)=>({ ...f, type: e.target.value as RequestItem['type'] }))}>
              <option value="Vacation">Vacation</option>
              <option value="OffRequest">OffRequest</option>
            </select>
          </label>
        </div>
        <button type="submit" className="px-4 py-2 bg-green-600 text-white rounded disabled:opacity-60" disabled={isPending}>
          {isPending ? 'Saving…' : 'Add Request'}
        </button>
      </form>

      <div className="flex justify-end">
        <Link href="/preview" className="px-4 py-2 rounded-md bg-teal-600 text-white">التالي</Link>
      </div>
    </div>
  );
}
