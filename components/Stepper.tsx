"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const steps = [
  { href: "/employees", label: "الموظفات", icon: "👥", num: 1 },
  { href: "/settings", label: "الإعدادات", icon: "⚙️", num: 2 },
  { href: "/requests", label: "الطلبات", icon: "📋", num: 3 },
  { href: "/preview", label: "المعاينة", icon: "📊", num: 4 },
];

export default function Stepper() {
  const pathname = usePathname();
  const currentIndex = steps.findIndex(s => s.href === pathname);
  
  return (
    <div className="w-full flex items-center justify-center py-4">
      <div className="bg-white border border-slate-200 rounded-2xl p-2 shadow-sm flex items-center gap-1">
        {steps.map((s, idx) => {
          const isActive = pathname === s.href;
          const isPast = idx < currentIndex;
          
          return (
            <Link
              key={s.href}
              href={s.href}
              className={clsx(
                "px-4 py-2 rounded-xl text-sm transition-all flex items-center gap-2 font-medium",
                isActive
                  ? "bg-gradient-to-r from-teal-500 to-teal-600 text-white shadow-md"
                  : isPast
                    ? "bg-teal-50 text-teal-700"
                    : "text-slate-500 hover:bg-slate-100"
              )}
            >
              <span className={clsx(
                "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold",
                isActive 
                  ? "bg-white/20" 
                  : isPast 
                    ? "bg-teal-200 text-teal-700"
                    : "bg-slate-200 text-slate-500"
              )}>
                {isPast ? "✓" : s.num}
              </span>
              <span className="hidden sm:inline">{s.label}</span>
              <span className="sm:hidden">{s.icon}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
