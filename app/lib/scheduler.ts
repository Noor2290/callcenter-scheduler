// -----------------------------------------------------------
//  GENERATE SCHEDULE — HOSPITAL-GRADE v3.0
//  
//  GUARANTEED BEHAVIORS:
//  ✔ Group A size = coverageMorning EXACTLY (from settings)
//  ✔ Group B size = totalEmployees − coverageMorning
//  ✔ Weekly flip pattern: A → B → A → B → ...
//  ✔ OFF/VAC do NOT shift employees or change groups
//  ✔ Continuity between months is preserved
//  ✔ Employee shift flips ONLY when a new global week starts
// -----------------------------------------------------------

import {
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  format,
  getDay
} from "date-fns";

import supabaseServer from "@/app/lib/supabaseServer";

// CONSTANTS
const OFF = "O";
const VAC = "V";

const FT_M = "MA1";
const FT_E = "EA1";

const PT_M = "PT4";
const PT_E = "PT5";

const MARWA_ID = "3864";

// -----------------------------------------------------------
// Helper: Global week index (continuous across months)
// Week starts on Saturday (dow=6)
// -----------------------------------------------------------
const EPOCH_SATURDAY = new Date(2020, 0, 4); // Jan 4, 2020 = Saturday

function globalWeekIndex(date: Date): number {
  const dow = getDay(date);
  const daysFromSat = (dow + 1) % 7;
  const weekStart = new Date(date);
  weekStart.setDate(date.getDate() - daysFromSat);
  weekStart.setHours(0, 0, 0, 0);
  
  const diffMs = weekStart.getTime() - EPOCH_SATURDAY.getTime();
  return Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
}

// -----------------------------------------------------------
// Pick FT/PT symbols based on shift
// -----------------------------------------------------------
function symbolForShift(emp: any, shift: "Morning" | "Evening"): string {
  if (emp.employment_type === "PartTime") {
    return shift === "Morning" ? PT_M : PT_E;
  }
  return shift === "Morning" ? FT_M : FT_E;
}

// -----------------------------------------------------------
// Determine shift from symbol (for reading previous month)
// -----------------------------------------------------------
function shiftFromSymbol(symbol: string): "Morning" | "Evening" | null {
  if (!symbol) return null;
  const upper = symbol.toUpperCase();
  if (upper === OFF || upper === VAC) return null;
  if (["MA1", "MA2", "MA4", "PT4", "M2"].includes(upper) || upper.startsWith("M")) {
    return "Morning";
  }
  if (["EA1", "E2", "E5", "PT5"].includes(upper) || upper.startsWith("E")) {
    return "Evening";
  }
  return null;
}

// -----------------------------------------------------------
// MAIN FUNCTION
// -----------------------------------------------------------
export async function generateSchedule({
  year,
  month
}: {
  year: number;
  month: number;
}) {
  const sb = supabaseServer();

  // =========================================================
  // STEP 1: Load all required data
  // =========================================================
  
  // Load/create month row
  const { data: monthRow, error: monthErr } = await sb
    .from("months")
    .upsert({ year, month }, { onConflict: "year,month" })
    .select("*")
    .single();
  
  if (monthErr || !monthRow) {
    throw new Error(monthErr?.message || "Failed to create month row");
  }

  // Load employees (sorted by name for consistent ordering)
  const { data: empData } = await sb
    .from("employees")
    .select("*")
    .order("name", { ascending: true });
  const employees = empData || [];
  const totalEmployees = employees.length;

  // Load settings
  const { data: settingsData } = await sb.from("settings").select("key, value");
  const settingsMap: Record<string, string> = {};
  for (const s of settingsData || []) {
    if (s.key && s.value !== null) {
      settingsMap[s.key] = s.value;
      settingsMap[s.key.toLowerCase()] = s.value;
    }
  }
  
  const coverageMorning = Number(settingsMap['coverageMorning'] || settingsMap['coveragemorning']) || 5;
  const coverageEvening = Number(settingsMap['coverageEvening'] || settingsMap['coverageevening']) || 6;
  
  console.log('[generateSchedule] Coverage settings:', { coverageMorning, coverageEvening, totalEmployees });

  // Load vacations
  const { data: reqs } = await sb
    .from("requests")
    .select("*")
    .eq("type", "Vacation");

  const vacationMap = new Map<string, Set<string>>();
  for (const r of reqs || []) {
    const iso = format(new Date(r.date), "yyyy-MM-dd");
    const id = String(r.employee_id);
    if (!vacationMap.has(id)) vacationMap.set(id, new Set());
    vacationMap.get(id)!.add(iso);
  }

  const isVacation = (empId: string, dateISO: string): boolean =>
    vacationMap.has(empId) && vacationMap.get(empId)!.has(dateISO);

  // =========================================================
  // STEP 2: Prepare dates and week indices
  // =========================================================
  const start = startOfMonth(new Date(year, month - 1, 1));
  const end = endOfMonth(start);
  const days = eachDayOfInterval({ start, end });
  
  // Find the first Saturday of the month (or use first day if month starts on Saturday)
  const firstDayDow = getDay(start);
  const firstSaturday = firstDayDow === 6 ? start : 
    new Date(start.getFullYear(), start.getMonth(), start.getDate() + (6 - firstDayDow + 7) % 7);
  
  // Get the week index of the first Saturday (this will be our "Week 1")
  const firstFullWeekIdx = globalWeekIndex(firstSaturday);
  
  // For days before the first Saturday, we'll use the same week index as the first Saturday
  // This ensures the partial week at the start is treated as part of Week 1
  const getEffectiveWeekIdx = (date: Date): number => {
    const actualWeekIdx = globalWeekIndex(date);
    // If this day is before the first Saturday, use the first Saturday's week
    if (date < firstSaturday) {
      return firstFullWeekIdx;
    }
    return actualWeekIdx;
  };
  
  // Get unique EFFECTIVE week indices for this month
  const weekIndices = [...new Set(days.map(d => getEffectiveWeekIdx(d)))].sort((a, b) => a - b);
  
  console.log('[generateSchedule] First day of month:', format(start, 'yyyy-MM-dd'), 'dow=', firstDayDow);
  console.log('[generateSchedule] First Saturday:', format(firstSaturday, 'yyyy-MM-dd'));
  console.log('[generateSchedule] Week indices in month:', weekIndices);
  
  // =========================================================
  // STEP 3: Load previous month data for continuity
  // =========================================================
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const lastDayPrevMonth = endOfMonth(new Date(prevYear, prevMonth - 1, 1));
  const prevWeekIdx = globalWeekIndex(lastDayPrevMonth);
  const firstWeekIdx = weekIndices[0];
  const sameWeekAsPrev = firstWeekIdx === prevWeekIdx;
  
  // Load previous month's last shifts
  const { data: prevMonthRow } = await sb
    .from("months")
    .select("id")
    .eq("year", prevYear)
    .eq("month", prevMonth)
    .single();
  
  const prevShiftMap = new Map<string, "Morning" | "Evening">();
  
  if (prevMonthRow) {
    const { data: prevAssigns } = await sb
      .from("assignments")
      .select("employee_id, symbol")
      .eq("month_id", prevMonthRow.id)
      .order("date", { ascending: false });
    
    for (const a of prevAssigns || []) {
      const empId = String(a.employee_id);
      if (prevShiftMap.has(empId)) continue;
      const shift = shiftFromSymbol(a.symbol);
      if (shift) prevShiftMap.set(empId, shift);
    }
  }

  // =========================================================
  // STEP 4: DYNAMIC GROUP CREATION FROM SETTINGS
  // 
  // GUARANTEED RULES:
  // 1. Group A size = EXACTLY coverageMorning (from settings table)
  // 2. Group B size = totalEmployees - coverageMorning
  // 3. Weekly flip: Week1=A→Morning, Week2=B→Morning, Week3=A→Morning...
  // 4. Continuity: preserve shifts from previous month when possible
  // 5. Rebalance: if continuity breaks group sizes, fix them
  // =========================================================
  
  console.log('[generateSchedule] ========================================');
  console.log('[generateSchedule] STEP 4: Creating Dynamic Groups');
  console.log('[generateSchedule] Settings: coverageMorning =', coverageMorning);
  console.log('[generateSchedule] Settings: coverageEvening =', coverageEvening);
  console.log('[generateSchedule] Total employees =', totalEmployees);
  console.log('[generateSchedule] ========================================');
  
  // RULE: Group A MUST have EXACTLY coverageMorning employees
  const groupASize = coverageMorning;
  const groupBSize = totalEmployees - coverageMorning;
  
  console.log('[generateSchedule] Required Group A size:', groupASize);
  console.log('[generateSchedule] Required Group B size:', groupBSize);
  
  // Initialize groups
  let groupA: Set<string> = new Set(); // Morning in Week 1, 3, 5...
  let groupB: Set<string> = new Set(); // Morning in Week 2, 4, 6...
  
  // Check if we have previous month data for continuity
  const hasPrevData = prevShiftMap.size > 0;
  
  if (hasPrevData) {
    console.log('[generateSchedule] Previous month data found, attempting continuity...');
    
    // Determine what shift each employee should have in first week
    // based on previous month's last shift
    const firstWeekShifts = new Map<string, "Morning" | "Evening">();
    
    for (const emp of employees) {
      const empId = String(emp.id);
      const prevShift = prevShiftMap.get(empId);
      
      if (prevShift) {
        if (sameWeekAsPrev) {
          // Same week continues - keep same shift
          firstWeekShifts.set(empId, prevShift);
        } else {
          // New week - flip the shift
          firstWeekShifts.set(empId, prevShift === "Morning" ? "Evening" : "Morning");
        }
      } else {
        // New employee - will be assigned later
        firstWeekShifts.set(empId, "Evening"); // Default
      }
    }
    
    // Count how many want Morning in first week
    const wantMorning: string[] = [];
    const wantEvening: string[] = [];
    
    for (const emp of employees) {
      const empId = String(emp.id);
      if (firstWeekShifts.get(empId) === "Morning") {
        wantMorning.push(empId);
      } else {
        wantEvening.push(empId);
      }
    }
    
    console.log('[generateSchedule] From continuity: want Morning =', wantMorning.length);
    console.log('[generateSchedule] From continuity: want Evening =', wantEvening.length);
    
    // REBALANCE to ensure Group A = coverageMorning EXACTLY
    if (wantMorning.length === groupASize) {
      // Perfect! Use as-is
      groupA = new Set(wantMorning);
      groupB = new Set(wantEvening);
      console.log('[generateSchedule] Perfect match! No rebalancing needed.');
    } else if (wantMorning.length > groupASize) {
      // Too many want Morning - move some to Evening
      const excess = wantMorning.length - groupASize;
      console.log('[generateSchedule] Too many Morning, moving', excess, 'to Evening');
      
      // Keep first groupASize in Morning, move rest to Evening
      for (let i = 0; i < wantMorning.length; i++) {
        if (i < groupASize) {
          groupA.add(wantMorning[i]);
        } else {
          groupB.add(wantMorning[i]);
        }
      }
      // Add all Evening to Group B
      for (const empId of wantEvening) {
        groupB.add(empId);
      }
    } else {
      // Too few want Morning - move some from Evening to Morning
      const deficit = groupASize - wantMorning.length;
      console.log('[generateSchedule] Too few Morning, moving', deficit, 'from Evening');
      
      // All Morning go to Group A
      for (const empId of wantMorning) {
        groupA.add(empId);
      }
      // Move some from Evening to Group A
      for (let i = 0; i < wantEvening.length; i++) {
        if (i < deficit) {
          groupA.add(wantEvening[i]);
        } else {
          groupB.add(wantEvening[i]);
        }
      }
    }
  } else {
    // No previous data - create fresh groups alphabetically
    console.log('[generateSchedule] No previous data, creating fresh groups...');
    
    for (let i = 0; i < employees.length; i++) {
      const empId = String(employees[i].id);
      if (i < groupASize) {
        groupA.add(empId);
      } else {
        groupB.add(empId);
      }
    }
  }
  
  // VERIFY group sizes are correct
  console.log('[generateSchedule] Final Group A size:', groupA.size, '(required:', groupASize, ')');
  console.log('[generateSchedule] Final Group B size:', groupB.size, '(required:', groupBSize, ')');
  
  if (groupA.size !== groupASize) {
    console.error('[generateSchedule] ERROR: Group A size mismatch!');
  }
  
  // Build weekly shift assignments
  // empId -> weekIdx -> shift
  const weeklyShifts = new Map<string, Map<number, "Morning" | "Evening">>();
  
  // Initialize maps for all employees
  for (const emp of employees) {
    weeklyShifts.set(String(emp.id), new Map());
  }
  
  // Assign shifts for each week using the FIXED pattern:
  // Week 1 (wkIndex=0): Group A = Morning, Group B = Evening
  // Week 2 (wkIndex=1): Group A = Evening, Group B = Morning
  // Week 3 (wkIndex=2): Group A = Morning, Group B = Evening
  // ... and so on
  
  for (let wkIndex = 0; wkIndex < weekIndices.length; wkIndex++) {
    const weekIdx = weekIndices[wkIndex];
    
    // Group A is Morning on even wkIndex (0, 2, 4...)
    // Group A is Evening on odd wkIndex (1, 3, 5...)
    const groupAIsMorning = (wkIndex % 2 === 0);
    
    let morningCount = 0;
    let eveningCount = 0;
    
    for (const emp of employees) {
      const empId = String(emp.id);
      const isGroupA = groupA.has(empId);
      
      let shift: "Morning" | "Evening";
      if (isGroupA) {
        shift = groupAIsMorning ? "Morning" : "Evening";
      } else {
        shift = groupAIsMorning ? "Evening" : "Morning";
      }
      
      weeklyShifts.get(empId)!.set(weekIdx, shift);
      
      if (shift === "Morning") morningCount++;
      else eveningCount++;
    }
    
    console.log(`[generateSchedule] Week ${wkIndex + 1} (globalIdx=${weekIdx}): Morning=${morningCount}, Evening=${eveningCount}`);
  }
  
  // Helper function to get employee's shift for a week (IMMUTABLE)
  const getShift = (empId: string, weekIdx: number): "Morning" | "Evening" => {
    return weeklyShifts.get(empId)?.get(weekIdx) || "Morning";
  };

  // =========================================================
  // STEP 5: WEEKLY OFF DISTRIBUTION
  // Each employee gets ONE off day per week (excluding Friday)
  // Distribute evenly across days to minimize daily impact
  // =========================================================
  
  // weekIdx -> empId -> offDateISO
  const weeklyOffDays = new Map<number, Map<string, string>>();
  
  // Build day groups per week (excluding Fridays)
  const weekDayGroups = new Map<number, string[]>();
  for (const d of days) {
    const dow = getDay(d);
    if (dow === 5) continue; // Skip Friday
    
    const wIdx = getEffectiveWeekIdx(d);
    if (!weekDayGroups.has(wIdx)) weekDayGroups.set(wIdx, []);
    weekDayGroups.get(wIdx)!.push(format(d, "yyyy-MM-dd"));
  }
  
  // Assign OFF days for each week
  for (const [weekIdx, availableDays] of weekDayGroups) {
    const offMap = new Map<string, string>();
    weeklyOffDays.set(weekIdx, offMap);
    
    // Count how many OFFs per day (for balancing)
    const dayOffCount = new Map<string, number>();
    for (const d of availableDays) {
      dayOffCount.set(d, 0);
    }
    
    // Separate employees by their shift this week for smarter distribution
    const morningEmps = employees.filter(e => getShift(String(e.id), weekIdx) === "Morning");
    const eveningEmps = employees.filter(e => getShift(String(e.id), weekIdx) === "Evening");
    
    // Assign OFF days - distribute evenly within each shift group
    const assignOff = (empList: any[]) => {
      for (const emp of empList) {
        const empId = String(emp.id);
        
        // Marwa always gets Saturday off
        if (empId === MARWA_ID) {
          const saturday = availableDays.find(d => getDay(new Date(d)) === 6);
          if (saturday) {
            offMap.set(empId, saturday);
            dayOffCount.set(saturday, dayOffCount.get(saturday)! + 1);
            continue;
          }
        }
        
        // Find day with minimum OFF assignments
        let bestDay = availableDays[0];
        let minCount = Infinity;
        
        for (const d of availableDays) {
          const count = dayOffCount.get(d)!;
          if (count < minCount) {
            minCount = count;
            bestDay = d;
          }
        }
        
        offMap.set(empId, bestDay);
        dayOffCount.set(bestDay, dayOffCount.get(bestDay)! + 1);
      }
    };
    
    // Assign OFFs for both groups
    assignOff(morningEmps);
    assignOff(eveningEmps);
  }

  // =========================================================
  // STEP 6: BUILD DAILY ASSIGNMENTS
  // CRITICAL: NO shift swapping allowed here!
  // Just apply: weekly shift + OFF + VAC
  // =========================================================
  
  const rows: any[] = [];

  for (const day of days) {
    const iso = format(day, "yyyy-MM-dd");
    const dow = getDay(day);
    const weekIdx = getEffectiveWeekIdx(day);
    
    // Friday = OFF for everyone
    if (dow === 5) {
      for (const emp of employees) {
        rows.push({
          month_id: monthRow.id,
          employee_id: emp.id,
          date: iso,
          symbol: OFF,
          code: OFF
        });
      }
      continue;
    }
    
    // Get OFF assignments for this week
    const weekOffMap = weeklyOffDays.get(weekIdx) || new Map();
    
    // Build assignments for each employee
    for (const emp of employees) {
      const empId = String(emp.id);
      let symbol: string;
      
      // Priority 1: Vacation
      if (isVacation(empId, iso)) {
        symbol = VAC;
      }
      // Priority 2: Weekly OFF day
      else if (weekOffMap.get(empId) === iso) {
        symbol = OFF;
      }
      // Priority 3: Weekly shift (IMMUTABLE - no changes!)
      else {
        const shift = getShift(empId, weekIdx);
        symbol = symbolForShift(emp, shift);
      }
      
      rows.push({
        month_id: monthRow.id,
        employee_id: emp.id,
        date: iso,
        symbol,
        code: symbol
      });
    }
  }

  // =========================================================
  // STEP 7: Save to database
  // =========================================================
  await sb.from("assignments").delete().eq("month_id", monthRow.id);
  await sb.from("assignments").insert(rows);

  // =========================================================
  // STEP 8: Return result with debug info
  // =========================================================
  return { 
    ok: true,
    debug: {
      totalEmployees,
      coverageMorning,
      coverageEvening,
      groupASize: groupA.size,
      groupBSize: groupB.size,
      weeksInMonth: weekIndices.length,
      vacationDaysLoaded: (reqs || []).length,
      pattern: "Week1: GroupA=Morning, Week2: GroupB=Morning, Week3: GroupA=Morning..."
    }
  };
}
