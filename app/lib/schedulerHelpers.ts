// Helper functions for scheduler with temporary fixed shift support

/**
 * Check if a date is within a date range
 */
export function isDateInRange(date: Date, startDate: string, endDate: string): boolean {
  const dateStr = formatDate(date);
  return dateStr >= startDate && dateStr <= endDate;
}

/**
 * Format date to YYYY-MM-DD
 */
export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get the effective shift for an employee on a specific date
 * Considers both permanent and temporary fixed shifts
 */
export function getEffectiveFixedShift(
  employeeId: string,
  date: Date,
  permanentFixedShifts: Map<string, 'Morning' | 'Evening'>,
  temporaryFixedShifts: Map<string, { shift_type: 'Morning' | 'Evening'; start_date: string; end_date: string }>
): 'Morning' | 'Evening' | null {
  // Check temporary fixed shifts first (higher priority during their period)
  const tempShift = temporaryFixedShifts.get(employeeId);
  if (tempShift && isDateInRange(date, tempShift.start_date, tempShift.end_date)) {
    return tempShift.shift_type;
  }
  
  // Check permanent fixed shifts
  return permanentFixedShifts.get(employeeId) || null;
}

/**
 * Smart Weekly Rotation Recovery
 * After a temporary fixed shift ends, flip the shift if it would repeat
 */
export function applySmartRecovery(
  employeeId: string,
  scheduledShift: 'Morning' | 'Evening',
  lastShiftInFixedPeriod: 'Morning' | 'Evening' | null
): 'Morning' | 'Evening' {
  // If there was a temporary fixed shift and the scheduled shift is the same
  // flip it to prevent two consecutive weeks with the same shift
  if (lastShiftInFixedPeriod && scheduledShift === lastShiftInFixedPeriod) {
    return scheduledShift === 'Morning' ? 'Evening' : 'Morning';
  }
  
  return scheduledShift;
}

/**
 * Get the last shift type for an employee from a temporary fixed period
 * Returns the shift type if the period just ended, null otherwise
 */
export function getLastShiftFromFixedPeriod(
  employeeId: string,
  currentWeekStartDate: Date,
  temporaryFixedShifts: Map<string, { shift_type: 'Morning' | 'Evening'; start_date: string; end_date: string }>
): 'Morning' | 'Evening' | null {
  const tempShift = temporaryFixedShifts.get(employeeId);
  if (!tempShift) return null;
  
  const currentWeekStr = formatDate(currentWeekStartDate);
  const endDate = tempShift.end_date;
  
  // Check if the fixed period ended in the previous week
  // (current week is after the end date)
  if (currentWeekStr > endDate) {
    // Calculate if it ended recently (within the last 7 days)
    const endDateObj = new Date(endDate);
    const daysSinceEnd = Math.floor((currentWeekStartDate.getTime() - endDateObj.getTime()) / (1000 * 60 * 60 * 24));
    
    // If it ended within the last week, return the shift type for smart recovery
    if (daysSinceEnd >= 0 && daysSinceEnd <= 7) {
      return tempShift.shift_type;
    }
  }
  
  return null;
}
