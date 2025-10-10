import SettingsForm from '@/components/SettingsForm';
import Stepper from '@/components/Stepper';
import Link from 'next/link';

export default function SettingsPage() {
  return (
    <div className="space-y-4">
      <Stepper />
      <div className="bg-white rounded-2xl shadow-sm border p-4">
        <div className="text-center text-teal-700 font-semibold mb-2">إعداد الشفتات</div>
        <p className="text-sm text-gray-600 mb-4 text-center">
          حدّد السنة والشهر وقيم التغطية (صباحًا/مساءً). خيار Between Shift افتراضيًا مغلق ويمكن تفعيله عند الحاجة.
        </p>
        <SettingsForm />
        <div className="flex items-center justify-between mt-4">
          <Link href="/employees" className="px-4 py-2 rounded-md border">السابق</Link>
          <Link href="/requests" className="px-4 py-2 rounded-md bg-teal-600 text-white">التالي</Link>
        </div>
      </div>
    </div>
  );
}
