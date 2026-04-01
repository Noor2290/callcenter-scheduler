import ScheduleGrid from '@/components/ScheduleGrid';
import Stepper from '@/components/Stepper';

export default function PreviewPage() {
  return (
    <div className="space-y-6">
      <Stepper />
      
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 bg-white rounded-xl border border-slate-200 shadow-sm">
        <span className="text-2xl">📊</span>
        <div>
          <h1 className="text-base font-bold text-slate-800">المعاينة والتصدير</h1>
          <p className="text-xs text-slate-500">ولّد الجدول، عدّل محليًا، ثم صدّره إلى Excel</p>
        </div>
      </div>
      
      {/* Schedule Grid */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <ScheduleGrid />
      </div>
    </div>
  );
}
