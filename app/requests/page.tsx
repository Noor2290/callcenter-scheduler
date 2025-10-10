import RequestsTable from '@/components/RequestsTable';
import Stepper from '@/components/Stepper';

export default function RequestsPage() {
  return (
    <div className="space-y-4">
      <Stepper />
      <div className="bg-white rounded-2xl shadow-sm border p-4">
        <div className="text-center text-teal-700 font-semibold mb-2">الأوف والإجازات</div>
        <p className="text-sm text-gray-600 mb-4 text-center">سجّل أيام الإجازة (Vacation) وطلبات الأوف (OffRequest) عند الحاجة.</p>
        <RequestsTable />
      </div>
    </div>
  );
}
