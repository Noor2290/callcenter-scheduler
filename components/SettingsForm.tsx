"use client";

import { useEffect, useState, useTransition } from 'react';

type Settings = {
  year?: number;
  month?: number;
  coverageMorning?: number;
  coverageEvening?: number;
  useBetweenShift?: boolean; // default false
  betweenShiftEmployeeId?: string; // optional when enabled
};

export default function SettingsForm() {
  const [settings, setSettings] = useState<Settings>({ useBetweenShift: false });
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    let mounted = true;
    fetch('/api/settings')
      .then((r) => r.json())
      .then((data) => {
        if (!mounted) return;
        setSettings({
          year: data.year ?? undefined,
          month: data.month ?? undefined,
          coverageMorning: data.coverageMorning ?? undefined,
          coverageEvening: data.coverageEvening ?? undefined,
          // Prefer new keys, fallback to legacy ones if present
          useBetweenShift: (data.useBetweenShift ?? data.useBetween) ?? false,
          betweenShiftEmployeeId: data.betweenShiftEmployeeId ?? data.betweenEmployeeId ?? undefined,
        });
      })
      .catch(() => {});
    // load employees for dropdown
    fetch('/api/employees')
      .then((r) => r.json())
      .then((data) => {
        if (!mounted) return;
        const items = Array.isArray(data.items) ? data.items : [];
        setEmployees(items.map((e: any) => ({ id: e.id, name: e.name })));
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  function onSave(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    if ((settings.useBetweenShift ?? false) && !settings.betweenShiftEmployeeId) {
      setStatus('Please select the Between Shift employee.');
      return;
    }
    startTransition(async () => {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year: settings.year,
          month: settings.month,
          coverageMorning: settings.coverageMorning,
          coverageEvening: settings.coverageEvening,
          useBetweenShift: settings.useBetweenShift ?? false,
          betweenShiftEmployeeId: settings.useBetweenShift ? (settings.betweenShiftEmployeeId ?? '') : '',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus(data.error || 'Failed to save');
      } else {
        setStatus('Saved');
      }
    });
  }

  return (
    <form onSubmit={onSave} className="max-w-xl space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col text-sm">
          <span className="mb-1">Year</span>
          <input
            type="number"
            className="border rounded p-2 text-left"
            dir="ltr"
            lang="en"
            value={settings.year ?? ''}
            onChange={(e) => setSettings((s) => ({ ...s, year: e.target.value ? Number(e.target.value) : undefined }))}
            placeholder="e.g., 2025"
          />
        </label>
        <label className="flex flex-col text-sm">
          <span className="mb-1">Month</span>
          <input
            type="number"
            className="border rounded p-2 text-left"
            dir="ltr"
            lang="en"
            value={settings.month ?? ''}
            min={1}
            max={12}
            onChange={(e) => setSettings((s) => ({ ...s, month: e.target.value ? Number(e.target.value) : undefined }))}
            placeholder="1-12"
          />
        </label>
        <label className="flex flex-col text-sm">
          <span className="mb-1">Morning Coverage per day</span>
          <input
            type="number"
            className="border rounded p-2 text-left"
            dir="ltr"
            lang="en"
            value={settings.coverageMorning ?? ''}
            onChange={(e) => setSettings((s) => ({ ...s, coverageMorning: e.target.value ? Number(e.target.value) : undefined }))}
            placeholder="set later by admin"
          />
        </label>
        <label className="flex flex-col text-sm">
          <span className="mb-1">Evening Coverage per day</span>
          <input
            type="number"
            className="border rounded p-2 text-left"
            dir="ltr"
            lang="en"
            value={settings.coverageEvening ?? ''}
            onChange={(e) => setSettings((s) => ({ ...s, coverageEvening: e.target.value ? Number(e.target.value) : undefined }))}
            placeholder="set later by admin"
          />
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={settings.useBetweenShift ?? false}
          onChange={(e) => setSettings((s) => ({ ...s, useBetweenShift: e.target.checked, betweenShiftEmployeeId: e.target.checked ? s.betweenShiftEmployeeId : undefined }))}
        />
        <span>Use Between Shift (default off)</span>
      </label>

      {settings.useBetweenShift && (
        <label className="flex flex-col text-sm">
          <span className="mb-1">Select Between Shift Employee</span>
          <select
            className="border rounded p-2"
            value={settings.betweenShiftEmployeeId ?? ''}
            onChange={(e) => setSettings((s) => ({ ...s, betweenShiftEmployeeId: e.target.value || undefined }))}
          >
            <option value="">-- select employee --</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </label>
      )}

      <button
        type="submit"
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-60"
        disabled={isPending || ((settings.useBetweenShift ?? false) && !settings.betweenShiftEmployeeId)}
      >
        {isPending ? 'Saving…' : 'Save Settings'}
      </button>

      {status && <p className="text-sm text-gray-600">{status}</p>}
    </form>
  );
}
