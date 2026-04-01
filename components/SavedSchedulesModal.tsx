'use client';

import { useEffect, useState } from 'react';

interface SavedSchedule {
  id: number;
  year: number;
  month: number;
  monthNameAr: string;
  assignmentsCount: number;
}

interface SavedSchedulesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoad: (year: number, month: number) => void;
  currentYear: number;
  currentMonth: number;
}

export default function SavedSchedulesModal({
  isOpen,
  onClose,
  onLoad,
  currentYear,
  currentMonth,
}: SavedSchedulesModalProps) {
  const [schedules, setSchedules] = useState<SavedSchedule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);
    fetch('/api/schedule/saved-list')
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        setSchedules(data.schedules ?? []);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [isOpen]);

  if (!isOpen) return null;

  const isCurrentMonth = (year: number, month: number) =>
    year === currentYear && month === currentMonth;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-slate-800 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">📂</span>
            <div>
              <h2 className="text-white font-bold text-lg">الجداول المحفوظة</h2>
              <p className="text-slate-400 text-xs mt-0.5">اختر الشهر الذي تريد تحميله</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-slate-700"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-4 max-h-96 overflow-y-auto">
          {loading && (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <div className="w-8 h-8 border-3 border-slate-600 border-t-transparent rounded-full animate-spin" />
              <p className="text-slate-500 text-sm">جاري التحميل...</p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}

          {!loading && !error && schedules.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <span className="text-5xl opacity-40">📭</span>
              <p className="text-slate-500 font-medium">لا يوجد جداول محفوظة</p>
              <p className="text-slate-400 text-xs text-center">
                قم بتوليد جدول جديد وحفظه أولاً
              </p>
            </div>
          )}

          {!loading && !error && schedules.length > 0 && (
            <div className="space-y-2">
              {schedules.map((s, idx) => {
                const isCurrent = isCurrentMonth(s.year, s.month);
                const isFirst = idx === 0;

                return (
                  <button
                    key={s.id}
                    onClick={() => { onLoad(s.year, s.month); onClose(); }}
                    className={`
                      w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all text-right
                      ${isCurrent
                        ? 'border-blue-500 bg-blue-50 shadow-sm'
                        : 'border-slate-100 bg-slate-50 hover:border-slate-300 hover:bg-white'
                      }
                    `}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold
                        ${isCurrent ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600'}`}>
                        {s.month}
                      </div>
                      <div className="text-right">
                        <div className="flex items-center gap-2">
                          <span className={`font-bold text-base ${isCurrent ? 'text-blue-800' : 'text-slate-800'}`}>
                            {s.monthNameAr} {s.year}
                          </span>
                          {isCurrent && (
                            <span className="bg-blue-600 text-white text-xs px-2 py-0.5 rounded-full">
                              الحالي
                            </span>
                          )}
                          {isFirst && !isCurrent && (
                            <span className="bg-green-600 text-white text-xs px-2 py-0.5 rounded-full">
                              الأحدث
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {s.assignmentsCount} تعيين محفوظ
                        </p>
                      </div>
                    </div>
                    <div className={`flex items-center gap-1 text-sm font-medium
                      ${isCurrent ? 'text-blue-600' : 'text-slate-500'}`}>
                      <span>تحميل</span>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 pb-4">
          <button
            onClick={onClose}
            className="w-full py-2.5 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl font-medium transition-colors text-sm"
          >
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
