import EmployeesTable from '@/components/EmployeesTable';
import Stepper from '@/components/Stepper';

export default function EmployeesPage() {
  return (
    <div className="space-y-4">
      <Stepper />
      <div className="bg-white rounded-2xl shadow-sm border p-4">
        <div className="text-center text-teal-700 font-semibold mb-3">برنامج توزيع الشفتات</div>
        <EmployeesTable />
      </div>
    </div>
  );
}
