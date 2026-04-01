// ═══════════════════════════════════════════════════════════════════════════
// SCHEDULER CORE - Enterprise Clean System
// ═══════════════════════════════════════════════════════════════════════════
// Philosophy: Deterministic, Predictable, Week-Integrity-First
// Key Principle: Same inputs → Same outputs (no random shuffling)
// Week Rule: Never break a week at month boundary
// ═══════════════════════════════════════════════════════════════════════════

import { format, getDay, addDays } from 'date-fns';

export type ShiftType = 'Morning' | 'Evening';

export interface Employee {
  id: string | number;
  name: string;
  employment_type?: string;
}

export interface FixedShift {
  employee_id: string;
  shift_type: ShiftType;
  start_date: string;
  end_date: string;
}

export interface ScheduleConstraints {
  coverageMorning: number;
  coverageEvening: number;
  useBetweenShift: boolean;
  betweenShiftEmployeeId?: string;
  saturdayOffEmployeeId?: string;
}

export interface WeekInfo {
  weekNumber: number;
  startDate: Date;
  endDate: Date;
  days: Date[];
  isPartial: boolean;  // Week spans month boundary
}

/**
 * Calculate weeks for a given month
 * Weeks are Sat-Thu (Fri is OFF)
 * IMPORTANT: Week never breaks - if it starts in month, it continues even past month end
 */
export function calculateWeeks(year: number, month: number): WeekInfo[] {
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  
  const weeks: WeekInfo[] = [];
  let weekNumber = 1;
  let currentDate = new Date(firstDay);
  
  // Find first Saturday (week start)
  while (getDay(currentDate) !== 6) { // 6 = Saturday
    currentDate = addDays(currentDate, -1);
  }
  
  // Generate weeks
  while (currentDate <= lastDay || weeks.length === 0) {
    const weekStart = new Date(currentDate);
    const weekEnd = addDays(weekStart, 4); // Sat + 4 = Thursday
    
    const days: Date[] = [];
    for (let i = 0; i <= 4; i++) {
      days.push(addDays(weekStart, i));
    }
    
    // Check if week is partial (crosses month boundary)
    const isPartial = 
      weekStart < firstDay || 
      weekEnd > lastDay;
    
    weeks.push({
      weekNumber,
      startDate: weekStart,
      endDate: weekEnd,
      days,
      isPartial
    });
    
    // Move to next week (Saturday)
    currentDate = addDays(weekEnd, 2); // Thu + 2 = Sat
    weekNumber++;
    
    // Stop if we're well past the month
    if (currentDate > addDays(lastDay, 7)) {
      break;
    }
  }
  
  return weeks;
}

/**
 * Build base rotation pattern (deterministic)
 * No randomization - pure rotation based on employee order
 */
export function buildBaseRotation(
  employees: Employee[],
  weeks: WeekInfo[],
  fixedShifts: FixedShift[]
): Map<number, Map<string, ShiftType>> {
  
  const rotation = new Map<number, Map<string, ShiftType>>();
  
  // Build fixed shifts lookup
  const fixedLookup = new Map<string, FixedShift[]>();
  fixedShifts.forEach(fs => {
    const empId = String(fs.employee_id);
    if (!fixedLookup.has(empId)) {
      fixedLookup.set(empId, []);
    }
    fixedLookup.get(empId)!.push(fs);
  });
  
  // Assign shifts week by week
  weeks.forEach((week, weekIndex) => {
    const weekMap = new Map<string, ShiftType>();
    
    employees.forEach((emp, empIndex) => {
      const empId = String(emp.id);
      
      // Check if employee has fixed shift for this week
      const fixed = getFixedShiftForWeek(empId, week, fixedLookup);
      if (fixed) {
        weekMap.set(empId, fixed);
      } else {
        // Simple alternating rotation: even weeks = Morning, odd weeks = Evening
        // Then alternate by employee index
        const baseShift = (weekIndex + empIndex) % 2 === 0 ? 'Morning' : 'Evening';
        weekMap.set(empId, baseShift);
      }
    });
    
    rotation.set(week.weekNumber, weekMap);
  });
  
  return rotation;
}

/**
 * Get fixed shift for employee in specific week
 */
function getFixedShiftForWeek(
  empId: string,
  week: WeekInfo,
  fixedLookup: Map<string, FixedShift[]>
): ShiftType | null {
  const shifts = fixedLookup.get(empId);
  if (!shifts) return null;
  
  // Check if any fixed shift overlaps with this week
  for (const shift of shifts) {
    const startDate = new Date(shift.start_date);
    const endDate = new Date(shift.end_date);
    
    // Check if week overlaps with fixed shift period
    if (week.startDate <= endDate && week.endDate >= startDate) {
      return shift.shift_type;
    }
  }
  
  return null;
}

/**
 * Apply constraints to rotation (coverage, between, etc.)
 * Returns adjusted rotation that meets all requirements
 */
export function applyConstraints(
  baseRotation: Map<number, Map<string, ShiftType>>,
  employees: Employee[],
  constraints: ScheduleConstraints
): Map<number, Map<string, ShiftType>> {
  
  const adjusted = new Map<number, Map<string, ShiftType>>();
  
  baseRotation.forEach((weekMap, weekNum) => {
    const newWeekMap = new Map<string, ShiftType>(weekMap);
    
    // Count current coverage
    let morningCount = 0;
    let eveningCount = 0;
    
    weekMap.forEach(shift => {
      if (shift === 'Morning') morningCount++;
      if (shift === 'Evening') eveningCount++;
    });
    
    // Adjust to meet coverage (if needed)
    // This is a simplified version - production would be more sophisticated
    if (morningCount < constraints.coverageMorning) {
      // Convert some Evening to Morning
      const needed = constraints.coverageMorning - morningCount;
      let converted = 0;
      
      weekMap.forEach((shift, empId) => {
        if (shift === 'Evening' && converted < needed) {
          newWeekMap.set(empId, 'Morning');
          converted++;
        }
      });
    }
    
    if (eveningCount < constraints.coverageEvening) {
      // Convert some Morning to Evening
      const needed = constraints.coverageEvening - eveningCount;
      let converted = 0;
      
      weekMap.forEach((shift, empId) => {
        if (shift === 'Morning' && converted < needed) {
          newWeekMap.set(empId, 'Evening');
          converted++;
        }
      });
    }
    
    adjusted.set(weekNum, newWeekMap);
  });
  
  return adjusted;
}

/**
 * Convert rotation to daily assignments
 * Includes OFF days (Friday) and vacation handling
 */
export function rotationToDailyAssignments(
  rotation: Map<number, Map<string, ShiftType>>,
  weeks: WeekInfo[],
  employees: Employee[],
  vacations: Map<string, Date[]>,
  saturdayOffEmployeeId?: string
): Array<{ employee_id: string; date: string; symbol: string }> {
  
  const assignments: Array<{ employee_id: string; date: string; symbol: string }> = [];
  
  weeks.forEach(week => {
    const weekMap = rotation.get(week.weekNumber);
    if (!weekMap) return;
    
    // Process each day in the week
    week.days.forEach((date, dayIndex) => {
      const dateStr = format(date, 'yyyy-MM-dd');
      const dayOfWeek = getDay(date);
      
      employees.forEach(emp => {
        const empId = String(emp.id);
        const shift = weekMap.get(empId);
        
        // Check vacation
        const empVacations = vacations.get(empId) || [];
        const isOnVacation = empVacations.some(v => 
          format(v, 'yyyy-MM-dd') === dateStr
        );
        
        if (isOnVacation) {
          assignments.push({ employee_id: empId, date: dateStr, symbol: 'V' });
          return;
        }
        
        // Friday is OFF for everyone
        if (dayOfWeek === 5) {
          assignments.push({ employee_id: empId, date: dateStr, symbol: 'O' });
          return;
        }
        
        // Saturday OFF for specific employee
        if (dayOfWeek === 6 && empId === saturdayOffEmployeeId) {
          assignments.push({ employee_id: empId, date: dateStr, symbol: 'O' });
          return;
        }
        
        // Regular shift
        if (shift) {
          const symbol = getShiftSymbol(shift, emp.employment_type);
          assignments.push({ employee_id: empId, date: dateStr, symbol });
        }
      });
      
      // Add Friday explicitly for clarity
      if (dayOfWeek === 5) {
        const friday = addDays(week.endDate, 1);
        const fridayStr = format(friday, 'yyyy-MM-dd');
        
        employees.forEach(emp => {
          assignments.push({ 
            employee_id: String(emp.id), 
            date: fridayStr, 
            symbol: 'O' 
          });
        });
      }
    });
  });
  
  return assignments;
}

/**
 * Get shift symbol based on shift type and employment type
 */
function getShiftSymbol(shift: ShiftType, employmentType?: string): string {
  if (shift === 'Morning') {
    if (employmentType === 'PartTime') return 'PT4';
    if (employmentType === 'Trainee') return 'M2';
    return 'MA1';
  } else {
    if (employmentType === 'PartTime') return 'PT5';
    if (employmentType === 'Trainee') return 'E2';
    return 'EA1';
  }
}

/**
 * Validate schedule meets all constraints
 */
export function validateSchedule(
  assignments: Array<{ employee_id: string; date: string; symbol: string }>,
  constraints: ScheduleConstraints
): { valid: boolean; errors: string[] } {
  
  const errors: string[] = [];
  
  // Group by date
  const byDate = new Map<string, typeof assignments>();
  assignments.forEach(a => {
    if (!byDate.has(a.date)) {
      byDate.set(a.date, []);
    }
    byDate.get(a.date)!.push(a);
  });
  
  // Check coverage for each day
  byDate.forEach((dayAssignments, date) => {
    const morningCount = dayAssignments.filter(a => 
      a.symbol.includes('M') || a.symbol.includes('PT4')
    ).length;
    
    const eveningCount = dayAssignments.filter(a => 
      a.symbol.includes('E') || a.symbol.includes('PT5')
    ).length;
    
    if (morningCount < constraints.coverageMorning) {
      errors.push(`${date}: Morning coverage ${morningCount} < required ${constraints.coverageMorning}`);
    }
    
    if (eveningCount < constraints.coverageEvening) {
      errors.push(`${date}: Evening coverage ${eveningCount} < required ${constraints.coverageEvening}`);
    }
  });
  
  return {
    valid: errors.length === 0,
    errors
  };
}
