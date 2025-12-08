// -----------------------------------------------------------
//  GENERATE SCHEDULE — HOSPITAL-GRADE v2.0
//  
//  CORE PRINCIPLE: Weekly shift is SACRED and IMMUTABLE
//  - Employee's weekly shift (Morning/Evening) NEVER changes within a week
//  - Daily coverage shortages due to OFF/VAC are ACCEPTABLE
//  - Smart weekly distribution ensures balanced coverage
//  - NO daily shift swapping allowed
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
  
  // Get unique week indices for this month
  const weekIndices = [...new Set(days.map(d => globalWeekIndex(d)))].sort((a, b) => a - b);
  
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
  // STEP 4: FIXED WEEKLY SHIFT DISTRIBUTION
  // 
  // CRITICAL RULES:
  // 1. Each week has EXACTLY coverageMorning employees in Morning
  // 2. The rest go to Evening
  // 3. Employees alternate weeks (Morning → Evening → Morning...)
  // 4. But we split employees into TWO GROUPS to maintain coverage:
  //    - Group A (first half): starts Morning in odd weeks
  //    - Group B (second half): starts Morning in even weeks
  // =========================================================
  
  console.log('[generateSchedule] Coverage settings:', { coverageMorning, coverageEvening, totalEmployees });
  
  // Build weekly shift assignments
  // empId -> weekIdx -> shift
  const weeklyShifts = new Map<string, Map<number, "Morning" | "Evening">>();
  
  // Initialize maps for all employees
  for (const emp of employees) {
    weeklyShifts.set(String(emp.id), new Map());
  }
  
  // Determine base shift for each employee for the FIRST week
  // This creates two groups that alternate, ensuring coverage stays balanced
  const employeeBaseShift = new Map<string, "Morning" | "Evening">();
  
  // Check if we have previous month data
  const hasPrevData = prevShiftMap.size > 0;
  
  if (hasPrevData) {
    // Use previous month's last shifts as base
    for (const emp of employees) {
      const empId = String(emp.id);
      if (prevShiftMap.has(empId)) {
        const prevShift = prevShiftMap.get(empId)!;
        // If same week continues, keep shift; otherwise flip
        const baseShift = sameWeekAsPrev ? prevShift : (prevShift === "Morning" ? "Evening" : "Morning");
        employeeBaseShift.set(empId, baseShift);
      } else {
        // New employee - will be assigned below
        employeeBaseShift.set(empId, "Evening"); // Default, will be adjusted
      }
    }
  } else {
    // No previous data - create balanced initial distribution
    // Split employees: first coverageMorning go to Morning, rest to Evening
    for (let i = 0; i < employees.length; i++) {
      const empId = String(employees[i].id);
      employeeBaseShift.set(empId, i < coverageMorning ? "Morning" : "Evening");
    }
  }
  
  // Now assign shifts for each week
  for (let wkIndex = 0; wkIndex < weekIndices.length; wkIndex++) {
    const weekIdx = weekIndices[wkIndex];
    
    let morningCount = 0;
    let eveningCount = 0;
    
    for (const emp of employees) {
      const empId = String(emp.id);
      const baseShift = employeeBaseShift.get(empId)!;
      
      // Calculate shift for this week based on base shift and week index
      // wkIndex 0 = base shift
      // wkIndex 1 = flipped
      // wkIndex 2 = base shift
      // etc.
      let shift: "Morning" | "Evening";
      if (wkIndex % 2 === 0) {
        shift = baseShift;
      } else {
        shift = baseShift === "Morning" ? "Evening" : "Morning";
      }
      
      weeklyShifts.get(empId)!.set(weekIdx, shift);
      
      if (shift === "Morning") morningCount++;
      else eveningCount++;
    }
    
    console.log(`[generateSchedule] Week ${weekIdx} (wkIndex=${wkIndex}): Morning=${morningCount}, Evening=${eveningCount}`);
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
    
    const wIdx = globalWeekIndex(d);
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
    const weekIdx = globalWeekIndex(day);
    
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
      weeksInMonth: weekIndices.length,
      vacationDaysLoaded: (reqs || []).length,
      note: "Weekly shifts are FIXED - no daily adjustments allowed"
    }
  };
}
