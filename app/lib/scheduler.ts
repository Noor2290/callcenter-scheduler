// ═══════════════════════════════════════════════════════════════════════════
//  GENERATE SCHEDULE — v8.0 (WEEKLY ROTATION + BETWEEN SHIFT)
//  
//  ✅ COVERAGE FROM SETTINGS ONLY (coverageMorning, coverageEvening)
//  ✅ WEEKLY FIXED SHIFT: Same shift for entire week per employee
//  ✅ 2-WEEK ROTATION: 2 weeks Morning + 2 weeks Evening (alternating)
//  ✅ BETWEEN SHIFT: If enabled, assigned employee gets "B" on extra coverage days
//  ✅ OFF RULES: Friday all, Marwa Saturday, 1 weekly OFF per employee (max 2/day)
//  ✅ CONTINUITY: Opposite shift pattern from previous month
// ═══════════════════════════════════════════════════════════════════════════

import {
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  format,
  getDay
} from "date-fns";

import supabaseServer from "@/app/lib/supabaseServer";

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS - SHIFT SYMBOLS
// ═══════════════════════════════════════════════════════════════════════════
const OFF = "O";
const VAC = "V";
const BETWEEN = "B";

// Morning shifts: MA1, MA2, M2, PT4
const MORNING_SHIFTS = {
  FullTime: "MA1",
  PartTime: "PT4",
  Trainee: "M2"
};

// Evening shifts: EA1, E5, E2, MA4, PT5
const EVENING_SHIFTS = {
  FullTime: "EA1",
  PartTime: "PT5",
  Trainee: "E2"
};

const MARWA_ID = "3864";
const EPOCH_SATURDAY = new Date(2020, 0, 4);
const MAX_OFF_PER_DAY = 2;

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════
type Shift = "Morning" | "Evening" | "Between";

interface Employee {
  id: number | string;
  name: string;
  employment_type?: string;
}

interface Settings {
  coverageMorning: number;
  coverageEvening: number;
  useBetweenShift: boolean;
  betweenShiftEmployeeId: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function globalWeekIndex(date: Date): number {
  const dow = getDay(date);
  const daysFromSat = (dow + 1) % 7;
  const weekStart = new Date(date);
  weekStart.setDate(date.getDate() - daysFromSat);
  weekStart.setHours(0, 0, 0, 0);
  const diffMs = weekStart.getTime() - EPOCH_SATURDAY.getTime();
  return Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
}

function getShiftSymbol(emp: Employee, shift: Shift): string {
  const empType = emp.employment_type || "FullTime";
  if (shift === "Between") return BETWEEN;
  if (shift === "Morning") {
    return MORNING_SHIFTS[empType as keyof typeof MORNING_SHIFTS] || MORNING_SHIFTS.FullTime;
  }
  return EVENING_SHIFTS[empType as keyof typeof EVENING_SHIFTS] || EVENING_SHIFTS.FullTime;
}

function parseShiftFromSymbol(symbol: string): Shift | null {
  if (!symbol) return null;
  const s = symbol.toUpperCase();
  if (s === OFF || s === VAC) return null;
  if (s === BETWEEN || s === "B") return "Between";
  if (["MA1", "MA2", "MA4", "PT4", "M2"].includes(s) || s.startsWith("M")) return "Morning";
  if (["EA1", "E2", "E5", "PT5"].includes(s) || s.startsWith("E")) return "Evening";
  return null;
}

function shuffle<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN FUNCTION
// ═══════════════════════════════════════════════════════════════════════════
export async function generateSchedule({
  year,
  month
}: {
  year: number;
  month: number;
}) {
  const sb = supabaseServer();
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`[SCHEDULER v8] Generating schedule for ${year}-${month}`);
  console.log(`${'═'.repeat(60)}\n`);

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 1: LOAD DATA FROM DATABASE
  // ═══════════════════════════════════════════════════════════════════════
  
  const { data: monthRow, error: monthErr } = await sb
    .from("months")
    .upsert({ year, month }, { onConflict: "year,month" })
    .select("*")
    .single();
  
  if (monthErr || !monthRow) throw new Error(monthErr?.message || "Failed to create month");

  // Load employees
  const { data: empData } = await sb.from("employees").select("*").order("name");
  const allEmployees: Employee[] = (empData || []) as Employee[];
  console.log(`[STEP 1] Total Employees: ${allEmployees.length}`);

  // Load settings from database (ONLY SOURCE OF TRUTH)
  const { data: settingsData } = await sb.from("settings").select("key, value");
  const settingsMap: Record<string, string> = {};
  for (const s of settingsData || []) {
    if (s.key) {
      settingsMap[s.key] = s.value ?? "";
    }
  }
  
  // Parse settings - NO DEFAULT VALUES, must come from settings
  const settings: Settings = {
    coverageMorning: Number(settingsMap['coverageMorning']) || 0,
    coverageEvening: Number(settingsMap['coverageEvening']) || 0,
    useBetweenShift: settingsMap['useBetweenShift'] === 'true',
    betweenShiftEmployeeId: settingsMap['betweenShiftEmployeeId'] || null
  };
  
  console.log(`[STEP 1] Settings from DB:`);
  console.log(`  - Morning Coverage: ${settings.coverageMorning}`);
  console.log(`  - Evening Coverage: ${settings.coverageEvening}`);
  console.log(`  - Use Between Shift: ${settings.useBetweenShift}`);
  console.log(`  - Between Shift Employee ID: ${settings.betweenShiftEmployeeId || 'N/A'}`);

  // Validate settings
  if (settings.coverageMorning === 0 || settings.coverageEvening === 0) {
    throw new Error("Coverage settings not configured. Please set Morning and Evening coverage in Shift Settings.");
  }

  // Separate Between Shift employee from regular employees
  let betweenEmployee: Employee | null = null;
  let regularEmployees: Employee[] = allEmployees;
  
  if (settings.useBetweenShift && settings.betweenShiftEmployeeId) {
    betweenEmployee = allEmployees.find(e => String(e.id) === settings.betweenShiftEmployeeId) || null;
    if (betweenEmployee) {
      regularEmployees = allEmployees.filter(e => String(e.id) !== settings.betweenShiftEmployeeId);
      console.log(`[STEP 1] Between Shift Employee: ${betweenEmployee.name}`);
    }
  }
  
  console.log(`[STEP 1] Regular Employees: ${regularEmployees.length}`);

  // Load Vacations & OffRequests
  const { data: vacationData } = await sb.from("requests").select("*").eq("type", "Vacation");
  const { data: offRequestData } = await sb.from("requests").select("*").eq("type", "OffRequest");
  
  const vacationSet = new Set<string>();
  for (const v of vacationData || []) {
    vacationSet.add(`${v.employee_id}_${format(new Date(v.date), "yyyy-MM-dd")}`);
  }
  
  const offRequestMap = new Map<string, string>();
  for (const o of offRequestData || []) {
    const dateISO = format(new Date(o.date), "yyyy-MM-dd");
    const weekIdx = globalWeekIndex(new Date(o.date));
    offRequestMap.set(`${o.employee_id}_${weekIdx}`, dateISO);
  }

  const isVacation = (empId: string, dateISO: string) => vacationSet.has(`${empId}_${dateISO}`);
  const getOffRequest = (empId: string, weekIdx: number) => offRequestMap.get(`${empId}_${weekIdx}`);

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 2: PREPARE DATES & WEEKS
  // ═══════════════════════════════════════════════════════════════════════
  
  const monthStart = startOfMonth(new Date(year, month - 1, 1));
  const monthEnd = endOfMonth(monthStart);
  const allDays = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const weekIndices = [...new Set(allDays.map(d => globalWeekIndex(d)))].sort((a, b) => a - b);
  const numWeeks = weekIndices.length;
  
  console.log(`[STEP 2] Days: ${allDays.length}, Weeks: ${numWeeks}`);
  console.log(`[STEP 2] Week indices: ${weekIndices.join(', ')}`);

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 3: LOAD PREVIOUS MONTH FOR CONTINUITY
  // ═══════════════════════════════════════════════════════════════════════
  
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  
  const { data: prevMonthRow } = await sb
    .from("months")
    .select("id")
    .eq("year", prevYear)
    .eq("month", prevMonth)
    .single();
  
  // Track last 2-week block shift for each employee
  const prevMonthLastShift = new Map<string, "Morning" | "Evening">();
  
  if (prevMonthRow) {
    const { data: prevAssigns } = await sb
      .from("assignments")
      .select("employee_id, symbol")
      .eq("month_id", prevMonthRow.id)
      .order("date", { ascending: false });
    
    for (const a of prevAssigns || []) {
      const empId = String(a.employee_id);
      if (!prevMonthLastShift.has(empId)) {
        const shift = parseShiftFromSymbol(a.symbol);
        if (shift === "Morning" || shift === "Evening") {
          prevMonthLastShift.set(empId, shift);
        }
      }
    }
  }
  console.log(`[STEP 3] Previous month shifts loaded: ${prevMonthLastShift.size}`);

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 4: ASSIGN WEEKLY SHIFTS (2-WEEK ROTATION PATTERN)
  // 
  // Rules:
  // - Each employee has SAME shift for entire week
  // - Pattern: 2 weeks Morning → 2 weeks Evening (or vice versa)
  // - Continuity: Start with opposite of last month's ending shift
  // - Half employees start Morning, half start Evening
  // ═══════════════════════════════════════════════════════════════════════
  
  console.log(`\n[STEP 4] Assigning weekly shifts with 2-week rotation...`);
  
  // Determine starting shift for each employee based on continuity
  const employeeStartShift = new Map<string, "Morning" | "Evening">();
  
  // Split employees into two groups for balanced rotation
  const shuffledEmployees = shuffle([...regularEmployees]);
  const halfCount = Math.ceil(shuffledEmployees.length / 2);
  
  for (let i = 0; i < shuffledEmployees.length; i++) {
    const emp = shuffledEmployees[i];
    const empId = String(emp.id);
    const lastShift = prevMonthLastShift.get(empId);
    
    if (lastShift) {
      // Continuity: opposite of last month
      employeeStartShift.set(empId, lastShift === "Morning" ? "Evening" : "Morning");
    } else {
      // New employee: alternate based on position
      employeeStartShift.set(empId, i < halfCount ? "Morning" : "Evening");
    }
  }
  
  // Build weekly shift assignment: weekIdx -> empId -> shift
  const weeklyShiftAssignment = new Map<number, Map<string, "Morning" | "Evening">>();
  
  for (let weekPos = 0; weekPos < weekIndices.length; weekPos++) {
    const weekIdx = weekIndices[weekPos];
    const shiftMap = new Map<string, "Morning" | "Evening">();
    weeklyShiftAssignment.set(weekIdx, shiftMap);
    
    for (const emp of regularEmployees) {
      const empId = String(emp.id);
      const startShift = employeeStartShift.get(empId) || "Morning";
      
      // 2-week rotation: weeks 0-1 = startShift, weeks 2-3 = opposite, etc.
      const twoWeekBlock = Math.floor(weekPos / 2);
      const isOpposite = twoWeekBlock % 2 === 1;
      
      let assignedShift: "Morning" | "Evening";
      if (isOpposite) {
        assignedShift = startShift === "Morning" ? "Evening" : "Morning";
      } else {
        assignedShift = startShift;
      }
      
      shiftMap.set(empId, assignedShift);
    }
  }
  
  // Log weekly assignments
  for (const [weekIdx, shiftMap] of weeklyShiftAssignment) {
    const morningCount = [...shiftMap.values()].filter(s => s === "Morning").length;
    const eveningCount = [...shiftMap.values()].filter(s => s === "Evening").length;
    console.log(`[STEP 4] Week ${weekIdx}: Morning=${morningCount}, Evening=${eveningCount}`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 5: ASSIGN WEEKLY OFF DAYS (MAX 2 PER DAY)
  // 
  // Rules:
  // - Friday: OFF for everyone
  // - Marwa: Saturday OFF always
  // - Each employee: 1 OFF per week (excluding Friday)
  // - Max 2 employees OFF per day (excluding Friday)
  // - OffRequest takes priority
  // ═══════════════════════════════════════════════════════════════════════
  
  console.log(`\n[STEP 5] Assigning weekly OFF days (max ${MAX_OFF_PER_DAY} per day)...`);
  
  // Get non-Friday days per week
  const weekDays = new Map<number, string[]>();
  for (const d of allDays) {
    if (getDay(d) === 5) continue; // Skip Friday
    const wIdx = globalWeekIndex(d);
    if (!weekDays.has(wIdx)) weekDays.set(wIdx, []);
    weekDays.get(wIdx)!.push(format(d, "yyyy-MM-dd"));
  }
  
  // weekIdx -> empId -> offDateISO
  const weeklyOffDays = new Map<number, Map<string, string>>();
  
  for (const weekIdx of weekIndices) {
    const offMap = new Map<string, string>();
    weeklyOffDays.set(weekIdx, offMap);
    
    const availableDays = weekDays.get(weekIdx) || [];
    if (availableDays.length === 0) continue;
    
    // Track OFF count per day for balancing (max 2)
    const dayOffCount = new Map<string, number>();
    for (const d of availableDays) dayOffCount.set(d, 0);
    
    // Process employees in random order
    const employeesToProcess = shuffle([...regularEmployees]);
    if (betweenEmployee) employeesToProcess.push(betweenEmployee);
    
    for (const emp of employeesToProcess) {
      const empId = String(emp.id);
      
      // Check OffRequest first
      const offReq = getOffRequest(empId, weekIdx);
      if (offReq && availableDays.includes(offReq)) {
        const currentCount = dayOffCount.get(offReq) || 0;
        if (currentCount < MAX_OFF_PER_DAY) {
          offMap.set(empId, offReq);
          dayOffCount.set(offReq, currentCount + 1);
          continue;
        }
      }
      
      // Marwa: Saturday OFF always
      if (empId === MARWA_ID) {
        const saturday = availableDays.find(d => getDay(new Date(d)) === 6);
        if (saturday && !isVacation(empId, saturday)) {
          const currentCount = dayOffCount.get(saturday) || 0;
          if (currentCount < MAX_OFF_PER_DAY) {
            offMap.set(empId, saturday);
            dayOffCount.set(saturday, currentCount + 1);
            continue;
          }
        }
      }
      
      // Find day with minimum OFFs (max 2 per day)
      let bestDay: string | null = null;
      let minCount = Infinity;
      
      for (const d of availableDays) {
        if (isVacation(empId, d)) continue;
        const count = dayOffCount.get(d) || 0;
        if (count < MAX_OFF_PER_DAY && count < minCount) {
          minCount = count;
          bestDay = d;
        }
      }
      
      if (bestDay) {
        offMap.set(empId, bestDay);
        dayOffCount.set(bestDay, (dayOffCount.get(bestDay) || 0) + 1);
      }
    }
    
    // Log OFF distribution for this week
    const offDistribution = [...dayOffCount.entries()].map(([d, c]) => `${d.slice(5)}:${c}`).join(', ');
    console.log(`[STEP 5] Week ${weekIdx} OFF distribution: ${offDistribution}`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 6: BUILD DAILY ASSIGNMENTS WITH EXACT COVERAGE
  // 
  // For each day:
  // 1. Friday → OFF for all
  // 2. Vacation → V
  // 3. Weekly OFF → O
  // 4. Between Shift employee → B (when needed for extra coverage)
  // 5. Regular employees → Morning/Evening based on weekly assignment
  // 6. Ensure exactly coverageMorning Morning and coverageEvening Evening
  // ═══════════════════════════════════════════════════════════════════════
  
  console.log(`\n[STEP 6] Building daily assignments with exact coverage...`);
  console.log(`[STEP 6] Target: Morning=${settings.coverageMorning}, Evening=${settings.coverageEvening}`);
  
  const rows: Array<{
    month_id: string;
    employee_id: number | string;
    date: string;
    symbol: string;
    code: string;
  }> = [];
  
  for (const day of allDays) {
    const dateISO = format(day, "yyyy-MM-dd");
    const dow = getDay(day);
    const weekIdx = globalWeekIndex(day);
    
    // ═══════════════════════════════════════════════════════════════════════
    // FRIDAY: OFF for everyone
    // ═══════════════════════════════════════════════════════════════════════
    if (dow === 5) {
      for (const emp of allEmployees) {
        rows.push({
          month_id: monthRow.id,
          employee_id: emp.id,
          date: dateISO,
          symbol: OFF,
          code: OFF
        });
      }
      continue;
    }
    
    const weekOffMap = weeklyOffDays.get(weekIdx) || new Map();
    const weekShiftMap = weeklyShiftAssignment.get(weekIdx) || new Map();
    
    // ═══════════════════════════════════════════════════════════════════════
    // CATEGORIZE EMPLOYEES BY THEIR WEEKLY SHIFT
    // ═══════════════════════════════════════════════════════════════════════
    const morningEmployees: Employee[] = [];
    const eveningEmployees: Employee[] = [];
    
    for (const emp of regularEmployees) {
      const empId = String(emp.id);
      
      // Skip if vacation or OFF
      if (isVacation(empId, dateISO)) continue;
      if (weekOffMap.get(empId) === dateISO) continue;
      
      const assignedShift = weekShiftMap.get(empId);
      if (assignedShift === "Morning") {
        morningEmployees.push(emp);
      } else if (assignedShift === "Evening") {
        eveningEmployees.push(emp);
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // APPLY EXACT COVERAGE FROM SETTINGS
    // ═══════════════════════════════════════════════════════════════════════
    
    // Select exactly coverageMorning from morning pool
    const finalMorning = morningEmployees.slice(0, settings.coverageMorning);
    const finalMorningIds = new Set(finalMorning.map(e => String(e.id)));
    
    // Select exactly coverageEvening from evening pool
    const finalEvening = eveningEmployees.slice(0, settings.coverageEvening);
    const finalEveningIds = new Set(finalEvening.map(e => String(e.id)));
    
    // Check if we need extra coverage (Between Shift)
    const morningShortage = settings.coverageMorning - finalMorning.length;
    const eveningShortage = settings.coverageEvening - finalEvening.length;
    const needsBetween = (morningShortage > 0 || eveningShortage > 0) && betweenEmployee;
    
    // Log coverage status
    if (morningShortage > 0 || eveningShortage > 0) {
      console.warn(`⚠️ ${dateISO}: Morning=${finalMorning.length}/${settings.coverageMorning}, Evening=${finalEvening.length}/${settings.coverageEvening}`);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // BUILD ROWS FOR THIS DAY
    // ═══════════════════════════════════════════════════════════════════════
    for (const emp of allEmployees) {
      const empId = String(emp.id);
      let symbol: string;
      
      // Between Shift employee handling
      if (betweenEmployee && empId === String(betweenEmployee.id)) {
        if (isVacation(empId, dateISO)) {
          symbol = VAC;
        } else if (weekOffMap.get(empId) === dateISO) {
          symbol = OFF;
        } else if (needsBetween) {
          symbol = BETWEEN;
        } else {
          symbol = OFF; // No extra coverage needed
        }
      }
      // Regular employees
      else if (isVacation(empId, dateISO)) {
        symbol = VAC;
      } else if (weekOffMap.get(empId) === dateISO) {
        symbol = OFF;
      } else if (finalMorningIds.has(empId)) {
        symbol = getShiftSymbol(emp, "Morning");
      } else if (finalEveningIds.has(empId)) {
        symbol = getShiftSymbol(emp, "Evening");
      } else {
        // Employee assigned to a shift but not selected for coverage today
        symbol = OFF;
      }
      
      rows.push({
        month_id: monthRow.id,
        employee_id: emp.id,
        date: dateISO,
        symbol,
        code: symbol
      });
    }
  }
  
  console.log(`[STEP 6] Total assignments: ${rows.length}`);

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 7: VERIFY COVERAGE
  // ═══════════════════════════════════════════════════════════════════════
  
  console.log(`\n[STEP 7] Verifying coverage...`);
  
  const morningSymbols = Object.values(MORNING_SHIFTS);
  const eveningSymbols = Object.values(EVENING_SHIFTS);
  
  let issues = 0;
  for (const day of allDays) {
    const dateISO = format(day, "yyyy-MM-dd");
    if (getDay(day) === 5) continue;
    
    const dayRows = rows.filter(r => r.date === dateISO);
    const mCount = dayRows.filter(r => morningSymbols.includes(r.symbol)).length;
    const eCount = dayRows.filter(r => eveningSymbols.includes(r.symbol)).length;
    const bCount = dayRows.filter(r => r.symbol === BETWEEN).length;
    
    if (mCount !== settings.coverageMorning) {
      console.warn(`[WARN] ${dateISO}: Morning=${mCount}/${settings.coverageMorning}`);
      issues++;
    }
    if (eCount !== settings.coverageEvening) {
      console.warn(`[WARN] ${dateISO}: Evening=${eCount}/${settings.coverageEvening}`);
      issues++;
    }
    if (bCount > 0) {
      console.log(`[INFO] ${dateISO}: Between=${bCount}`);
    }
  }
  
  console.log(issues === 0 ? `[STEP 7] ✅ All days meet coverage!` : `[STEP 7] ⚠️ ${issues} coverage issues`);

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 8: SAVE TO DATABASE
  // ═══════════════════════════════════════════════════════════════════════
  
  console.log(`\n[STEP 8] Saving to database...`);
  
  await sb.from("assignments").delete().eq("month_id", monthRow.id);
  const { error: insertErr } = await sb.from("assignments").insert(rows);
  
  if (insertErr) throw insertErr;
  console.log(`[STEP 8] ✅ Saved ${rows.length} assignments!`);

  return {
    ok: true,
    debug: {
      year,
      month,
      employees: allEmployees.length,
      regularEmployees: regularEmployees.length,
      betweenEmployee: betweenEmployee?.name || null,
      coverageMorning: settings.coverageMorning,
      coverageEvening: settings.coverageEvening,
      useBetweenShift: settings.useBetweenShift,
      weeks: numWeeks,
      assignments: rows.length,
      issues
    }
  };
}
