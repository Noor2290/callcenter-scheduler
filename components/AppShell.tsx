"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PropsWithChildren } from "react";
import clsx from "clsx";

const nav = [
  { href: "/", label: "الرئيسية", icon: "🏠" },
  { href: "/employees", label: "الموظفات", icon: "👥" },
  { href: "/settings", label: "الإعدادات", icon: "⚙️" },
  { href: "/requests", label: "الطلبات", icon: "📋" },
  { href: "/preview", label: "المعاينة", icon: "📊" },
];

export default function AppShell({ children }: PropsWithChildren) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-white/90 backdrop-blur-md shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center gap-8">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500 to-teal-600 flex items-center justify-center shadow-md group-hover:shadow-lg transition-shadow">
              <span className="text-white text-lg">📅</span>
            </div>
            <div className="hidden sm:block">
              <div className="font-bold text-[var(--brand)] text-sm">Smart Scheduler</div>
              <div className="text-[10px] text-[var(--muted)]">مركز الاتصالات</div>
            </div>
          </Link>
          
          {/* Navigation */}
          <nav className="flex items-center gap-1 text-sm flex-1">
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={clsx(
                  "px-4 py-2 rounded-lg transition-all flex items-center gap-2 font-medium",
                  pathname === n.href
                    ? "bg-gradient-to-r from-teal-500 to-teal-600 text-white shadow-md"
                    : "text-slate-600 hover:bg-teal-50 hover:text-teal-700"
                )}
              >
                <span className="text-base">{n.icon}</span>
                <span className="hidden md:inline">{n.label}</span>
              </Link>
            ))}
          </nav>
          
          {/* Version Badge */}
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 rounded-full bg-slate-100 text-xs font-medium text-slate-600">
              v1.0
            </span>
          </div>
        </div>
      </header>
      
      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
      
      {/* Footer */}
      <footer className="border-t border-[var(--border)] bg-white mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between text-xs text-[var(--muted)]">
          <span className="flex items-center gap-2">
            <span>©</span>
            <span>{new Date().getFullYear()}</span>
            <span className="font-medium text-slate-600">Smart Shift Scheduler</span>
          </span>
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-500"></span>
              <span>Online</span>
            </span>
            <span className="text-slate-300">|</span>
            <span>Makkah Medical Center</span>
          </span>
        </div>
      </footer>
    </div>
  );
}
