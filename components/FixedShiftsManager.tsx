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
  employee: Employee;
}

export default function FixedShiftsManager() {
  const [fixedShifts, setFixedShifts] = useState<FixedShift[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [selectedShift, setSelectedShift] = useState<'Morning' | 'Evening'>('Morning');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      // Load fixed shifts
      const fixedRes = await fetch('/api/fixed-shifts');
      const fixedData = await fixedRes.json();
      
      // Load employees
      const empRes = await fetch('/api/employees');
      const empData = await empRes.json();
      
      if (fixedRes.ok && empRes.ok) {
        setFixedShifts(fixedData.fixedShifts || []);
        setEmployees(empData.items || []);
      } else {
        setError('Failed to load data');
      }
    } catch (err) {
      setError('Error loading data');
    } finally {
      setLoading(false);
    }
  };

  const addFixedShift = async () => {
    if (!selectedEmployee) {
      setError('Please select an employee');
      return;
    }

    // Check if employee already has a fixed shift
    if (fixedShifts.some(fs => fs.employee_id === selectedEmployee)) {
      setError('This employee already has a fixed shift');
      return;
    }

    try {
      const res = await fetch('/api/fixed-shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: selectedEmployee,
          shift_type: selectedShift
        })
      });

      const data = await res.json();
      
      if (res.ok) {
        setFixedShifts([...fixedShifts, data.fixedShift]);
        setSelectedEmployee('');
        setSuccess('Fixed shift added successfully');
        setError('');
      } else {
        setError(data.error || 'Failed to add fixed shift');
      }
    } catch (err) {
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
        
        <div className="flex flex-col sm:flex-row gap-4">
          <select
            value={selectedEmployee}
            onChange={(e) => setSelectedEmployee(e.target.value)}
            className="flex-1 px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-slate-700"
          >
            <option value="">اختر الموظف</option>
            {availableEmployees.map(emp => (
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

          <button
            onClick={addFixedShift}
            disabled={!selectedEmployee}
            className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl font-medium shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all"
          >
            <Plus />
            <span>إضافة</span>
          </button>
        </div>
      </div>

      {/* Fixed Shifts List */}
      {fixedShifts.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <h3 className="text-lg font-semibold text-slate-800 mb-4">الشفتات الثابتة</h3>
          
          <div className="space-y-3">
            {fixedShifts.map((fs) => (
              <div
                key={fs.id}
                className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                    <span className="text-blue-600 font-semibold">
                      {fs.shift_type === 'Morning' ? 'ص' : 'م'}
                    </span>
                  </div>
                  <div>
                    <div className="font-medium text-slate-800">
                      {fs.employee.name}
                    </div>
                    <div className="text-sm text-slate-600">
                      {fs.employee.code && `كود: ${fs.employee.code} • `}
                      الشفت: {fs.shift_type === 'Morning' ? 'صباحي' : 'مسائي'}
                    </div>
                  </div>
                </div>
                
                <button
                  onClick={() => removeFixedShift(fs.id)}
                  className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                >
                  <Trash2 />
                </button>
              </div>
            ))}
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
