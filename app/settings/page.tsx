import SettingsForm from '@/components/SettingsForm';
import Stepper from '@/components/Stepper';
import Link from 'next/link';

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <Stepper />
      
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-500 to-indigo-600 rounded-2xl p-6 text-white shadow-lg">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur">
            <span className="text-2xl">⚙️</span>
          </div>
          <div>
            <h1 className="text-xl font-bold">إعدادات الجدول</h1>
            <p className="text-purple-100 text-sm">حدد السنة والشهر وقيم التغطية الصباحية والمسائية</p>
          </div>
        </div>
      </div>
      
      {/* Settings Form */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <SettingsForm />
        
        {/* Navigation */}
        <div className="flex items-center justify-between mt-8 pt-6 border-t border-slate-200">
          <Link 
            href="/employees" 
            className="px-5 py-2.5 rounded-xl border border-slate-300 text-slate-600 hover:bg-slate-50 font-medium flex items-center gap-2 transition-all"
          >
            <span>→</span>
            <span>السابق</span>
          </Link>
          <Link 
            href="/requests" 
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-teal-500 to-teal-600 text-white font-medium flex items-center gap-2 shadow-md hover:shadow-lg transition-all"
          >
            <span>التالي</span>
            <span>←</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
