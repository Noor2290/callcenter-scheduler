"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PropsWithChildren } from "react";
import clsx from "clsx";

const nav = [
  { href: "/", label: "الرئيسية" },
  { href: "/employees", label: "الموظفات" },
  { href: "/settings", label: "الإعدادات" },
  { href: "/requests", label: "الطلبات" },
  { href: "/preview", label: "المعاينة والتصدير" },
];

export default function AppShell({ children }: PropsWithChildren) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <header className="sticky top-0 z-40 border-b bg-white/85 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center gap-6">
          <div className="font-semibold tracking-tight text-[var(--brand)]">الجدولة الذكية – مركز الاتصالات</div>
          <nav className="flex items-center gap-1 text-sm">
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={clsx(
                  "px-3 py-1.5 rounded-md transition",
                  pathname === n.href
                    ? "bg-[var(--brand-600)] text-white"
                    : "text-[var(--foreground)] hover:bg-[var(--brand-50)]"
                )}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ms-auto text-xs text-[var(--muted)]">v0 • Admin</div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {children}
      </main>
      <footer className="border-t bg-white mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-12 flex items-center justify-between text-xs text-[var(--muted)]">
          <span>© {new Date().getFullYear()} Smart Scheduler</span>
          <span>Next.js • Supabase</span>
        </div>
      </footer>
    </div>
  );
}
