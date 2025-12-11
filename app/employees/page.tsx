import EmployeesTable from '@/components/EmployeesTable';
import Stepper from '@/components/Stepper';
import Link from 'next/link';

export default function EmployeesPage() {
  return (
    <div className="space-y-6">
      <Stepper />
      
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-500 to-cyan-600 rounded-2xl p-6 text-white shadow-lg">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur">
            <span className="text-2xl">👥</span>
          </div>
          <div>
            <h1 className="text-xl font-bold">إدارة الموظفات</h1>
            <p className="text-blue-100 text-sm">أضف وعدّل بيانات الموظفات (الاسم، النوع، الكود)</p>
          </div>
        </div>
      </div>
      
      {/* Employees Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <EmployeesTable />
        
        {/* Navigation */}
        <div className="flex items-center justify-end mt-8 pt-6 border-t border-slate-200">
          <Link 
            href="/settings" 
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
