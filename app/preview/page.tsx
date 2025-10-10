import ScheduleGrid from '@/components/ScheduleGrid';
import Stepper from '@/components/Stepper';

export default function PreviewPage() {
  return (
    <div className="space-y-4">
      <Stepper />
      <div className="bg-white rounded-2xl shadow-sm border p-4">
        <div className="text-center text-teal-700 font-semibold mb-2">المعاينة والتوليد</div>
        <p className="text-sm text-gray-600 mb-4 text-center">ولّد الجدول، عدّل محليًا، ثم قم بالتصدير إلى Excel.</p>
        <ScheduleGrid />
      </div>
    </div>
  );
}
