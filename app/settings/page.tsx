import SettingsForm from '@/components/SettingsForm';
import FixedShiftsManager from '@/components/FixedShiftsManager';
import Stepper from '@/components/Stepper';
import Link from 'next/link';

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <Stepper />
      
      {/* Hero Header */}
      <div className="bg-gradient-to-br from-purple-500 via-indigo-600 to-blue-600 rounded-2xl p-8 text-white shadow-xl relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent"></div>
        <div className="relative z-10">
          <div className="flex items-center gap-4 mb-3">
            <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-sm shadow-lg">
              <span className="text-3xl">⚙️</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold mb-1">إعدادات النظام</h1>
              <p className="text-purple-100 text-sm">قم بتخصيص إعدادات الجدول والتغطية المطلوبة</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Settings Grid */}
      <div className="grid gap-6">
        {/* Card 1: إعدادات الجدول الأساسية */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="bg-gradient-to-r from-slate-50 to-white px-6 py-4 border-b border-slate-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-sm">
                <span className="text-xl">📅</span>
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-800">إعدادات الجدول</h2>
                <p className="text-xs text-slate-500">السنة، الشهر، والتغطية المطلوبة</p>
              </div>
            </div>
          </div>
          <div className="p-6">
            <SettingsForm />
          </div>
        </div>

        {/* Card 2: تثبيت الشفت للموظفين */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="bg-gradient-to-r from-teal-50 to-white px-6 py-4 border-b border-slate-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center shadow-sm">
                <span className="text-xl">📌</span>
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-800">تثبيت الشفت للموظفين</h2>
                <p className="text-xs text-slate-500">حدد شفت ثابت (صباحي أو مسائي) لموظفين معينين</p>
              </div>
            </div>
          </div>
          <div className="p-6">
            <FixedShiftsManager />
          </div>
        </div>
      </div>

      {/* Navigation Footer */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
        <div className="flex items-center justify-between">
          <Link 
            href="/employees" 
            className="px-5 py-2.5 rounded-xl border-2 border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-slate-400 font-medium flex items-center gap-2 transition-all"
          >
            <span>→</span>
            <span>السابق: الموظفات</span>
          </Link>
          <Link 
            href="/requests" 
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-teal-500 to-teal-600 text-white font-medium flex items-center gap-2 shadow-md hover:shadow-lg hover:from-teal-600 hover:to-teal-700 transition-all"
          >
            <span>التالي: الطلبات</span>
            <span>←</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
