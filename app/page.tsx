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
  const step3Done = useMemo(() => (requestsCount ?? 0) >= 0, [requestsCount]);

  const steps = [
    {
      num: 1,
      title: "إضافة الموظفات",
      desc: "أضف بيانات الموظفات (الاسم، النوع، الكود)",
      href: "/employees",
      icon: "👥",
      done: step1Done,
      stat: loading ? "..." : `${employeesCount ?? 0} موظفة`,
      color: "from-blue-500 to-blue-600",
    },
    {
      num: 2,
      title: "إعدادات الجدول",
      desc: "حدد السنة والشهر وقيم التغطية",
      href: "/settings",
      icon: "⚙️",
      done: step2Done,
      stat: loading ? "..." : step2Done ? `${settings?.year}/${settings?.month}` : "غير مكتمل",
      color: "from-purple-500 to-purple-600",
      disabled: !step1Done,
    },
    {
      num: 3,
      title: "الإجازات والطلبات",
      desc: "أضف طلبات الإجازة والأوف (اختياري)",
      href: "/requests",
      icon: "📋",
      done: step3Done,
      stat: loading ? "..." : `${requestsCount ?? 0} طلب`,
      color: "from-amber-500 to-amber-600",
      disabled: !step1Done || !step2Done,
    },
    {
      num: 4,
      title: "المعاينة والتصدير",
      desc: "ولّد الجدول وصدّره إلى Excel",
      href: "/preview",
      icon: "📊",
      done: false,
      stat: "جاهز للتوليد",
      color: "from-emerald-500 to-emerald-600",
      disabled: !step1Done || !step2Done,
      primary: true,
    },
  ];

  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <div className="bg-gradient-to-br from-teal-500 to-teal-700 rounded-2xl p-8 text-white shadow-xl">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur">
            <span className="text-3xl">📅</span>
          </div>
          <div>
            <h1 className="text-2xl font-bold">Smart Shift Scheduler</h1>
            <p className="text-teal-100 text-sm">نظام جدولة الشفتات الذكي - مركز الاتصالات</p>
          </div>
        </div>
        <p className="text-teal-50 text-sm leading-relaxed max-w-2xl">
          اتبع الخطوات بالترتيب لإنشاء جدول الشفتات الشهري. يمكنك إضافة الموظفات، تحديد الإعدادات، 
          إدخال طلبات الإجازات، ثم توليد الجدول وتصديره.
        </p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
          <div className="text-2xl mb-1">👥</div>
          <div className="text-2xl font-bold text-slate-800">{loading ? "..." : employeesCount ?? 0}</div>
          <div className="text-xs text-slate-500">موظفة مسجلة</div>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
          <div className="text-2xl mb-1">📋</div>
          <div className="text-2xl font-bold text-slate-800">{loading ? "..." : requestsCount ?? 0}</div>
          <div className="text-xs text-slate-500">طلب إجازة</div>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
          <div className="text-2xl mb-1">☀️</div>
          <div className="text-2xl font-bold text-slate-800">{settings?.coverageMorning ?? "-"}</div>
          <div className="text-xs text-slate-500">تغطية صباحية</div>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
          <div className="text-2xl mb-1">🌙</div>
          <div className="text-2xl font-bold text-slate-800">{settings?.coverageEvening ?? "-"}</div>
          <div className="text-xs text-slate-500">تغطية مسائية</div>
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
          <span>📝</span>
          <span>خطوات إنشاء الجدول</span>
        </h2>
        
        <div className="grid gap-4">
          {steps.map((step) => (
            <div
              key={step.num}
              className={`step-card ${step.done ? 'completed' : ''} ${step.disabled ? 'opacity-60' : ''}`}
            >
              <div className="flex items-center gap-4">
                {/* Step Number */}
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${step.color} flex items-center justify-center shadow-md flex-shrink-0`}>
                  <span className="text-white text-xl">{step.icon}</span>
                </div>
                
                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-slate-400">الخطوة {step.num}</span>
                    {step.done && (
                      <span className="badge badge-success">
                        <span>✓</span>
                        <span>مكتمل</span>
                      </span>
                    )}
                  </div>
                  <h3 className="font-semibold text-slate-800">{step.title}</h3>
                  <p className="text-sm text-slate-500">{step.desc}</p>
                </div>
                
                {/* Stat & Button */}
                <div className="flex items-center gap-4 flex-shrink-0">
                  <div className="text-left hidden sm:block">
                    <div className="text-sm font-medium text-slate-700">{step.stat}</div>
                  </div>
                  <Link
                    href={step.disabled ? "#" : step.href}
                    className={`px-5 py-2.5 rounded-xl font-medium transition-all flex items-center gap-2 ${
                      step.primary
                        ? "bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-md hover:shadow-lg"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    } ${step.disabled ? "pointer-events-none" : ""}`}
                  >
                    <span>{step.primary ? "ابدأ" : "فتح"}</span>
                    <span>←</span>
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
