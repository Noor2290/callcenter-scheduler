"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const steps = [
  { href: "/employees", label: "(1) الموظفات" },
  { href: "/settings", label: "(2) إعداد الشفتات" },
  { href: "/requests", label: "(3) الأوف والإجازات" },
  { href: "/preview", label: "(4) المعاينة والتوليد" },
];

export default function Stepper() {
  const pathname = usePathname();
  return (
    <div className="w-full flex items-center justify-center py-3">
      <div className="bg-white border border-[var(--border)] rounded-full px-2 h-11 flex items-center gap-2">
        {steps.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className={clsx(
              "px-4 h-8 inline-flex items-center rounded-full text-sm transition",
              pathname === s.href
                ? "bg-[var(--brand-600)] text-white"
                : "bg-white text-[var(--foreground)] border border-[var(--border)] hover:bg-[var(--brand-50)]"
            )}
          >
            {s.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
