import type { Metadata } from "next";
import { Geist, Geist_Mono, Tajawal } from "next/font/google";
import "./globals.css";
import AppShell from "@/components/AppShell";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const tajawal = Tajawal({
  variable: "--font-arabic-sans",
  subsets: ["arabic"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "Smart Shift Scheduler – Makkah Medical Center",
  description: "Call Center dynamic monthly shift scheduler",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body className={`${geistSans.variable} ${geistMono.variable} ${tajawal.variable} antialiased`}>
        <AppShell>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
