'use client';

import { useState, useEffect } from 'react';
// Icons - using simple text instead of lucide-react for now
const Trash2 = () => <span>🗑️</span>;
const Plus = () => <span>➕</span>;
const AlertCircle = () => <span>⚠️</span>;

interface Employee {
  id: string;
  name: string | null;
  code: string | null;
}

interface FixedShift {
  id: string;
  employee_id: string;
  shift_type: 'Morning' | 'Evening';
  start_date: string; // Required - all shifts must have a period
  end_date: string; // Required - all shifts must have a period
  employee: Employee;
}

export default function FixedShiftsManager() {
  const [fixedShifts, setFixedShifts] = useState<FixedShift[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [selectedShift, setSelectedShift] = useState<'Morning' | 'Evening'>('Morning');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      console.log('[FixedShifts] Loading data...');
      
      // Load employees first
      const empRes = await fetch('/api/employees');
      console.log('[FixedShifts] Employees response status:', empRes.status);
      const empData = await empRes.json();
      console.log('[FixedShifts] Employees data:', empData);
      
      if (!empRes.ok) {
        console.error('[FixedShifts] Failed to load employees:', empData);
        setError(`Failed to load employees: ${empData.error || 'Unknown error'}`);
        return;
      }
      
      setEmployees(empData.items || []);
      console.log('[FixedShifts] Employees loaded:', empData.items?.length || 0);
      
      // Load fixed shifts
      const fixedRes = await fetch('/api/fixed-shifts');
      console.log('[FixedShifts] Fixed shifts response status:', fixedRes.status);
      const fixedData = await fixedRes.json();
      console.log('[FixedShifts] Fixed shifts data:', fixedData);
      
      if (!fixedRes.ok) {
        console.error('[FixedShifts] Failed to load fixed shifts:', fixedData);
        // Don't set error for fixed shifts, just log it
        setFixedShifts([]);
      } else {
        // Match employees with fixed shifts
        const fixedShiftsWithEmployees = (fixedData.fixedShifts || []).map((fs: any) => {
          const employee = empData.items?.find((emp: any) => emp.id === fs.employee_id);
          return {
            ...fs,
            employee: employee || { id: fs.employee_id, name: 'Unknown', code: null }
          };
        });
        
        setFixedShifts(fixedShiftsWithEmployees);
        console.log('[FixedShifts] Fixed shifts loaded:', fixedShiftsWithEmployees.length);
      }
      
      setError(''); // Clear any previous errors
    } catch (err) {
      console.error('[FixedShifts] Error loading data:', err);
      setError(`Error loading data: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const addFixedShift = async () => {
    console.log('[FixedShifts] Add button clicked');
    console.log('[FixedShifts] Selected employee:', selectedEmployee);
    console.log('[FixedShifts] Selected shift:', selectedShift);
    
    if (!selectedEmployee) {
      setError('Please select an employee');
      return;
    }

    // Validate dates (required for all fixed shifts)
    if (!startDate || !endDate) {
      setError('يجب تحديد تاريخ البداية والنهاية');
      return;
    }
    if (new Date(startDate) > new Date(endDate)) {
      setError('تاريخ النهاية يجب أن يكون بعد تاريخ البداية');
      return;
    }

    try {
      console.log('[FixedShifts] Sending POST request...');
      const requestBody = {
        employee_id: selectedEmployee,
        shift_type: selectedShift,
        start_date: startDate,
        end_date: endDate
      };
      
      console.log('[FixedShifts] Request body:', requestBody);
      
      const res = await fetch('/api/fixed-shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      console.log('[FixedShifts] Response status:', res.status);
      const data = await res.json();
      console.log('[FixedShifts] Response data:', data);
      
      if (res.ok) {
        console.log('[FixedShifts] Success! Adding to list...');
        // Get employee info for the new fixed shift
        const employee = employees.find(emp => emp.id === selectedEmployee);
        const newFixedShift = {
          ...data.fixedShift,
          employee: employee || { id: selectedEmployee, name: 'Unknown', code: null }
        };
        
        setFixedShifts([...fixedShifts, newFixedShift]);
        setSelectedEmployee('');
        setStartDate('');
        setEndDate('');
        setSuccess('تم إضافة الشفت الثابت بنجاح');
        setError('');
        
        // Reload data to ensure consistency
        setTimeout(() => {
          loadData();
        }, 500);
      } else {
        console.error('[FixedShifts] Error from API:', data.error);
        setError(data.error || 'Failed to add fixed shift');
      }
    } catch (err) {
      console.error('[FixedShifts] Exception:', err);
      setError('Error adding fixed shift');
    }
  };

  const removeFixedShift = async (id: string) => {
    try {
      const res = await fetch(`/api/fixed-shifts/${id}`, {
        method: 'DELETE'
      });

      if (res.ok) {
        setFixedShifts(fixedShifts.filter(fs => fs.id !== id));
        setSuccess('Fixed shift removed successfully');
        setError('');
      } else {
        setError('Failed to remove fixed shift');
      }
    } catch (err) {
      setError('Error removing fixed shift');
    }
  };

  // Filter out employees that already have fixed shifts
  const availableEmployees = employees.filter(emp => 
    !fixedShifts.some(fs => fs.employee_id === emp.id)
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-500 to-indigo-600 rounded-2xl p-6 text-white shadow-lg">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur">
            <span className="text-2xl">🔒</span>
          </div>
          <div>
            <h2 className="text-xl font-bold">تثبيت الشفت للموظفين</h2>
            <p className="text-blue-100 text-sm">حدد موظفين معينين ليكونوا دائمًا في شفت معين</p>
          </div>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle />
          <div className="text-red-700 text-sm">{error}</div>
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4">
          <div className="text-green-700 text-sm">{success}</div>
        </div>
      )}

      {/* Add New Fixed Shift */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <h3 className="text-lg font-semibold text-slate-800 mb-4">إضافة شفت ثابت</h3>
        
        <div className="space-y-4">
          {/* Employee and Shift Selection */}
          <div className="flex flex-col sm:flex-row gap-4">
            <select
              value={selectedEmployee}
              onChange={(e) => setSelectedEmployee(e.target.value)}
              className="flex-1 px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-slate-700"
            >
              <option value="">اختر الموظف</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.id}>
                  {emp.name} {emp.code && `(${emp.code})`}
                </option>
              ))}
            </select>

            <select
              value={selectedShift}
              onChange={(e) => setSelectedShift(e.target.value as 'Morning' | 'Evening')}
              className="px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-slate-700"
            >
              <option value="Morning">صباحي</option>
              <option value="Evening">مسائي</option>
            </select>
          </div>

          {/* Date Range (Required) */}
          <div className="space-y-3 p-4 bg-blue-50 rounded-xl border border-blue-200">
            <div className="flex items-center gap-2 text-sm font-medium text-blue-800 mb-2">
              <span>📅</span>
              <span>فترة التثبيت (إلزامية)</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  من تاريخ <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  إلى تاريخ <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                />
              </div>
            </div>
            <div className="text-xs text-blue-700 mt-2">
              ℹ️ بعد انتهاء الفترة، سيعود النظام تلقائيًا للتناوب الأسبوعي مع منع تكرار نفس الشفت
            </div>
          </div>

          {/* Add Button */}
          <button
            onClick={addFixedShift}
            disabled={!selectedEmployee || !startDate || !endDate}
            className="w-full px-5 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl font-medium shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all"
          >
            <Plus />
            <span>إضافة شفت ثابت</span>
          </button>
        </div>
      </div>

      {/* Fixed Shifts List */}
      {fixedShifts.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <h3 className="text-lg font-semibold text-slate-800 mb-4">الشفتات الثابتة</h3>
          
          <div className="space-y-3">
            {fixedShifts.map((fs) => {
              const formatDate = (dateStr: string) => {
                const date = new Date(dateStr);
                return date.toLocaleDateString('ar-SA', { day: 'numeric', month: 'short' });
              };
              
              return (
                <div
                  key={fs.id}
                  className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200 hover:border-slate-300 transition-colors"
                >
                  <div className="flex items-center gap-4 flex-1">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      fs.shift_type === 'Morning' ? 'bg-amber-100' : 'bg-indigo-100'
                    }`}>
                      <span className={`font-semibold ${
                        fs.shift_type === 'Morning' ? 'text-amber-700' : 'text-indigo-700'
                      }`}>
                        {fs.shift_type === 'Morning' ? 'ص' : 'م'}
                      </span>
                    </div>
                    <div className="flex-1">
                      <div className="font-medium text-slate-800">
                        {fs.employee.name}
                      </div>
                      <div className="text-sm text-slate-600">
                        {fs.employee.code && `كود: ${fs.employee.code} • `}
                        الشفت: {fs.shift_type === 'Morning' ? 'صباحي' : 'مسائي'}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full font-medium">
                          📅
                        </span>
                        <span className="text-xs text-slate-500">
                          {formatDate(fs.start_date)} → {formatDate(fs.end_date)}
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  <button
                    onClick={() => removeFixedShift(fs.id)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="حذف"
                  >
                    <Trash2 />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {fixedShifts.length === 0 && (
        <div className="bg-slate-50 rounded-2xl border border-slate-200 p-8 text-center">
          <div className="w-16 h-16 bg-slate-200 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">📋</span>
          </div>
          <h3 className="text-lg font-medium text-slate-700 mb-2">لا توجد شفتات ثابتة</h3>
          <p className="text-slate-500 text-sm">
            أضف موظفين لتثبيت شفتاتهم باستخدام النموذج أعلاه
          </p>
        </div>
      )}
    </div>
  );
}
