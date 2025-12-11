import RequestsTable from '@/components/RequestsTable';
import Stepper from '@/components/Stepper';
import Link from 'next/link';

export default function RequestsPage() {
  return (
    <div className="space-y-6">
      <Stepper />
      
      {/* Header */}
      <div className="bg-gradient-to-r from-amber-500 to-orange-600 rounded-2xl p-6 text-white shadow-lg">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur">
            <span className="text-2xl">📋</span>
          </div>
          <div>
            <h1 className="text-xl font-bold">الإجازات والطلبات</h1>
            <p className="text-amber-100 text-sm">سجّل أيام الإجازة (Vacation) وطلبات الأوف (OffRequest)</p>
          </div>
        </div>
      </div>
      
      {/* Requests Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <RequestsTable />
        
        {/* Navigation */}
        <div className="flex items-center justify-between mt-8 pt-6 border-t border-slate-200">
          <Link 
            href="/settings" 
            className="px-5 py-2.5 rounded-xl border border-slate-300 text-slate-600 hover:bg-slate-50 font-medium flex items-center gap-2 transition-all"
          >
            <span>→</span>
            <span>السابق</span>
          </Link>
          <Link 
            href="/preview" 
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-medium flex items-center gap-2 shadow-md hover:shadow-lg transition-all"
          >
            <span>المعاينة والتصدير</span>
            <span>←</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
