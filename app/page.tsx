"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Settings = {
  year?: number;
  month?: number;
  coverageMorning?: number;
  coverageEvening?: number;
  useBetween?: boolean;
};

export default function Home() {
  const [employeesCount, setEmployeesCount] = useState<number | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [requestsCount, setRequestsCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const [eRes, sRes, rRes] = await Promise.all([
          fetch("/api/employees").then((r) => r.json()).catch(() => ({ items: [] })),
          fetch("/api/settings").then((r) => r.json()).catch(() => ({})),
          fetch("/api/requests").then((r) => r.json()).catch(() => ({ items: [] })),
        ]);
        if (!mounted) return;
        setEmployeesCount((eRes.items || []).length ?? 0);
        setSettings(sRes || {});
        setRequestsCount((rRes.items || []).length ?? 0);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const step1Done = useMemo(() => (employeesCount ?? 0) > 0, [employeesCount]);
  const step2Done = useMemo(() => !!(settings?.year && settings?.month), [settings]);
  const step3Done = useMemo(() => (requestsCount ?? 0) >= 0, [requestsCount]); // optional

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold">Smart Shift Scheduler – Call Center</h1>
      <p className="text-sm text-gray-600">اتبع الخطوات بالترتيب لإنشاء الجدول الشهري.</p>

      <ol className="space-y-4">
        <li className="border rounded p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">الخطوة 1: إضافة الموظفات</div>
              <div className="text-xs text-gray-600">أضف الموظفات يدويًا من الشاشة التالية.</div>
            </div>
            <Link href="/employees" className="px-3 py-1.5 rounded bg-blue-600 text-white">فتح</Link>
          </div>
          <div className="mt-2 text-xs text-gray-700">{loading ? '...' : `الموظفات المسجلات: ${employeesCount ?? 0}`}</div>
        </li>

        <li className={`border rounded p-4 ${step1Done ? '' : 'opacity-60'}`}>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">الخطوة 2: الإعدادات</div>
              <div className="text-xs text-gray-600">حدّد السنة والشهر وقيم التغطية، وابقِ Between Shift مغلقًا افتراضيًا.</div>
            </div>
            <Link href="/settings" className="px-3 py-1.5 rounded bg-blue-600 text-white" aria-disabled={!step1Done}>فتح</Link>
          </div>
          <div className="mt-2 text-xs text-gray-700">{loading ? '...' : `الحالة: ${step2Done ? 'جاهز' : 'غير مكتمل'}`}</div>
        </li>

        <li className={`border rounded p-4 ${step1Done && step2Done ? '' : 'opacity-60'}`}>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">الخطوة 3: الإجازات وطلبات الأوف</div>
              <div className="text-xs text-gray-600">أضف Vacation/OffRequest حسب الحاجة (اختياري).</div>
            </div>
            <Link href="/requests" className="px-3 py-1.5 rounded bg-blue-600 text-white" aria-disabled={!step1Done || !step2Done}>فتح</Link>
          </div>
          <div className="mt-2 text-xs text-gray-700">{loading ? '...' : `عدد الطلبات: ${requestsCount ?? 0}`}</div>
        </li>

        <li className={`border rounded p-4 ${step1Done && step2Done ? '' : 'opacity-60'}`}>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">الخطوة 4: المعاينة والتصدير</div>
              <div className="text-xs text-gray-600">ولّـد الجدول، عدّل محليًا، ثم صدّر الملف إلى Excel.</div>
            </div>
            <Link href="/preview" className="px-3 py-1.5 rounded bg-emerald-600 text-white" aria-disabled={!step1Done || !step2Done}>اذهب</Link>
          </div>
        </li>
      </ol>
    </div>
  );
}
