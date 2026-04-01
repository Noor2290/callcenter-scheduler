// ═══════════════════════════════════════════════════════════════════════════
// VARIATION STRATEGIES - Enterprise Smart Scheduler
// ═══════════════════════════════════════════════════════════════════════════
// Purpose: Generate truly different schedules while maintaining constraints
// Philosophy: Deterministic but varied (same strategy + params = same output)
// ═══════════════════════════════════════════════════════════════════════════

export enum VariationStrategy {
  ROTATION_OFFSET = 'rotation_offset',    // Shift starting point of rotation
  GROUP_SWAP = 'group_swap',              // Swap employee groups
  INVERSION = 'inversion',                // Flip Morning ↔ Evening
  PATTERN_SHIFT = 'pattern_shift'         // Move schedule forward/backward
}

export interface VariationParams {
  strategy: VariationStrategy;
  offset?: number;        // For ROTATION_OFFSET and PATTERN_SHIFT
  groupSize?: number;     // For GROUP_SWAP
  seed?: number;          // For deterministic randomization
}

export interface ScheduleData {
  employeeIds: string[];
  weeklyAssignments: Map<number, Map<string, 'Morning' | 'Evening'>>;
  fixedShifts: Map<string, { shift_type: 'Morning' | 'Evening'; start_date: string; end_date: string }[]>;
}

/**
 * Apply variation strategy to base schedule
 * Returns modified schedule that respects all constraints
 */
export function applyVariation(
  baseSchedule: ScheduleData,
  params: VariationParams
): ScheduleData {
  switch (params.strategy) {
    case VariationStrategy.ROTATION_OFFSET:
      return applyRotationOffset(baseSchedule, params.offset || 1);
    
    case VariationStrategy.GROUP_SWAP:
      return applyGroupSwap(baseSchedule, params.groupSize || 2);
    
    case VariationStrategy.INVERSION:
      return applyInversion(baseSchedule);
    
    case VariationStrategy.PATTERN_SHIFT:
      return applyPatternShift(baseSchedule, params.offset || 1);
    
    default:
      return baseSchedule;
  }
}

/**
 * STRATEGY 1: Rotation Offset
 * Shift the starting point of the employee rotation cycle
 * Example: Instead of starting with employee #1, start with employee #3
 */
function applyRotationOffset(
  schedule: ScheduleData,
  offset: number
): ScheduleData {
  const { employeeIds, weeklyAssignments, fixedShifts } = schedule;
  
  // Create new employee order by rotating the array
  const rotatedIds = [
    ...employeeIds.slice(offset),
    ...employeeIds.slice(0, offset)
  ];
  
  // Rebuild weekly assignments with new order
  const newWeeklyAssignments = new Map<number, Map<string, 'Morning' | 'Evening'>>();
  
  weeklyAssignments.forEach((weekMap, weekNum) => {
    const newWeekMap = new Map<string, 'Morning' | 'Evening'>();
    
    employeeIds.forEach((oldId, oldIndex) => {
      const newIndex = (oldIndex + offset) % employeeIds.length;
      const newId = rotatedIds[newIndex];
      const shift = weekMap.get(oldId);
      
      // Skip if employee has fixed shift for this week
      if (shift && !hasFixedShiftForWeek(newId, weekNum, fixedShifts)) {
        newWeekMap.set(newId, shift);
      }
    });
    
    newWeeklyAssignments.set(weekNum, newWeekMap);
  });
  
  return {
    employeeIds: rotatedIds,
    weeklyAssignments: newWeeklyAssignments,
    fixedShifts
  };
}

/**
 * STRATEGY 2: Group Swap
 * Divide employees into groups and swap their shift assignments
 * Example: Group A (Morning) ↔ Group B (Evening)
 */
function applyGroupSwap(
  schedule: ScheduleData,
  groupSize: number
): ScheduleData {
  const { employeeIds, weeklyAssignments, fixedShifts } = schedule;
  
  // Divide employees into groups
  const groups: string[][] = [];
  for (let i = 0; i < employeeIds.length; i += groupSize) {
    groups.push(employeeIds.slice(i, i + groupSize));
  }
  
  // Create swap map (Group 0 ↔ Group 1, Group 2 ↔ Group 3, etc.)
  const swapMap = new Map<string, string>();
  for (let i = 0; i < groups.length - 1; i += 2) {
    const group1 = groups[i];
    const group2 = groups[i + 1];
    
    if (group2) {
      for (let j = 0; j < Math.min(group1.length, group2.length); j++) {
        swapMap.set(group1[j], group2[j]);
        swapMap.set(group2[j], group1[j]);
      }
    }
  }
  
  // Apply swaps to weekly assignments
  const newWeeklyAssignments = new Map<number, Map<string, 'Morning' | 'Evening'>>();
  
  weeklyAssignments.forEach((weekMap, weekNum) => {
    const newWeekMap = new Map<string, 'Morning' | 'Evening'>();
    
    weekMap.forEach((shift, empId) => {
      const swappedId = swapMap.get(empId) || empId;
      
      // Only swap if neither employee has fixed shift
      if (!hasFixedShiftForWeek(empId, weekNum, fixedShifts) &&
          !hasFixedShiftForWeek(swappedId, weekNum, fixedShifts)) {
        newWeekMap.set(swappedId, shift);
      } else {
        newWeekMap.set(empId, shift);
      }
    });
    
    newWeeklyAssignments.set(weekNum, newWeekMap);
  });
  
  return {
    employeeIds,
    weeklyAssignments: newWeeklyAssignments,
    fixedShifts
  };
}

/**
 * STRATEGY 3: Inversion
 * Flip all Morning ↔ Evening assignments
 * Maintains balance but creates completely different schedule
 */
function applyInversion(schedule: ScheduleData): ScheduleData {
  const { employeeIds, weeklyAssignments, fixedShifts } = schedule;
  
  const newWeeklyAssignments = new Map<number, Map<string, 'Morning' | 'Evening'>>();
  
  weeklyAssignments.forEach((weekMap, weekNum) => {
    const newWeekMap = new Map<string, 'Morning' | 'Evening'>();
    
    weekMap.forEach((shift, empId) => {
      // Don't invert if employee has fixed shift
      if (!hasFixedShiftForWeek(empId, weekNum, fixedShifts)) {
        const invertedShift = shift === 'Morning' ? 'Evening' : 'Morning';
        newWeekMap.set(empId, invertedShift);
      } else {
        newWeekMap.set(empId, shift);
      }
    });
    
    newWeeklyAssignments.set(weekNum, newWeekMap);
  });
  
  return {
    employeeIds,
    weeklyAssignments: newWeeklyAssignments,
    fixedShifts
  };
}

/**
 * STRATEGY 4: Pattern Shift
 * Move entire schedule forward or backward by N weeks
 * Useful for adapting to different month start days
 */
function applyPatternShift(
  schedule: ScheduleData,
  weekOffset: number
): ScheduleData {
  const { employeeIds, weeklyAssignments, fixedShifts } = schedule;
  
  const newWeeklyAssignments = new Map<number, Map<string, 'Morning' | 'Evening'>>();
  const weekNumbers = Array.from(weeklyAssignments.keys()).sort((a, b) => a - b);
  const totalWeeks = weekNumbers.length;
  
  weeklyAssignments.forEach((weekMap, oldWeekNum) => {
    // Calculate new week number (with wrapping)
    const oldIndex = weekNumbers.indexOf(oldWeekNum);
    const newIndex = (oldIndex + weekOffset + totalWeeks) % totalWeeks;
    const newWeekNum = weekNumbers[newIndex];
    
    const newWeekMap = new Map<string, 'Morning' | 'Evening'>();
    
    weekMap.forEach((shift, empId) => {
      // Only shift if no fixed shift conflict
      if (!hasFixedShiftForWeek(empId, newWeekNum, fixedShifts)) {
        newWeekMap.set(empId, shift);
      }
    });
    
    newWeeklyAssignments.set(newWeekNum, newWeekMap);
  });
  
  return {
    employeeIds,
    weeklyAssignments: newWeeklyAssignments,
    fixedShifts
  };
}

/**
 * Helper: Check if employee has fixed shift for a specific week
 */
function hasFixedShiftForWeek(
  empId: string,
  weekNum: number,
  fixedShifts: Map<string, { shift_type: 'Morning' | 'Evening'; start_date: string; end_date: string }[]>
): boolean {
  const shifts = fixedShifts.get(empId);
  if (!shifts || shifts.length === 0) return false;
  
  // This is a simplified check - in production, you'd compare actual dates
  // For now, we assume if employee has any fixed shift, we respect it
  return shifts.length > 0;
}

/**
 * Get human-readable strategy description
 */
export function getStrategyDescription(strategy: VariationStrategy): string {
  const descriptions = {
    [VariationStrategy.ROTATION_OFFSET]: 'تغيير نقطة بداية الدورة',
    [VariationStrategy.GROUP_SWAP]: 'تبديل مجموعات الموظفين',
    [VariationStrategy.INVERSION]: 'عكس الشفتات (صباح ↔ مساء)',
    [VariationStrategy.PATTERN_SHIFT]: 'تحريك الجدول أسبوع للأمام/الخلف'
  };
  
  return descriptions[strategy] || strategy;
}

/**
 * Get all available strategies
 */
export function getAllStrategies(): VariationStrategy[] {
  return [
    VariationStrategy.ROTATION_OFFSET,
    VariationStrategy.GROUP_SWAP,
    VariationStrategy.INVERSION,
    VariationStrategy.PATTERN_SHIFT
  ];
}
