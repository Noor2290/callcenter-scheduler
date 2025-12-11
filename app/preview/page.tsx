import ScheduleGrid from '@/components/ScheduleGrid';
import Stepper from '@/components/Stepper';

export default function PreviewPage() {
  return (
    <div className="space-y-6">
      <Stepper />
      
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-500 to-teal-600 rounded-2xl p-6 text-white shadow-lg">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur">
            <span className="text-2xl">📊</span>
          </div>
          <div>
            <h1 className="text-xl font-bold">المعاينة والتصدير</h1>
            <p className="text-emerald-100 text-sm">ولّد الجدول، عدّل محليًا، ثم صدّره إلى Excel</p>
          </div>
        </div>
      </div>
      
      {/* Schedule Grid */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <ScheduleGrid />
      </div>
    </div>
  );
}
