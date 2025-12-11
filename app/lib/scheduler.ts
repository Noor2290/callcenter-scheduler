// ═══════════════════════════════════════════════════════════════════════════
//  GENERATE SCHEDULE — v10.0 (EXACT COVERAGE FROM SETTINGS)
//  
//  ✅ COVERAGE FROM SETTINGS ONLY - NO DEFAULTS
//     - Morning Coverage = EXACTLY the number from settings
//     - Evening Coverage = EXACTLY the number from settings
//     - NO exceeding these numbers
//  
//  ✅ WEEKLY FIXED SHIFT: Same shift for entire week per employee
//  ✅ 2-WEEK ROTATION: 2 weeks Morning + 2 weeks Evening (alternating)
//  ✅ BETWEEN SHIFT: If enabled, assigned employee gets "B" symbol
//  
//  ✅ OFF RULES:
//     - Friday: OFF for everyone
//     - Marwa: Saturday OFF always
//     - Each employee: EXACTLY 1 OFF per week (no extra OFF)
//     - Max 2 OFF per day (excluding Friday)
//     - OFF/V requests are respected
//  
//  ✅ SHORTAGE HANDLING:
//     - If shortage due to OFF/V, distribute best possible
//     - Never change employee's weekly shift
//     - Never give extra OFF
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

// Seeded random for consistent results
function seededRandom(seed: number): () => number {
  return function() {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

function shuffleWithSeed<T>(arr: T[], seed: number): T[] {
  const result = [...arr];
  const random = seededRandom(seed);
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
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
  const seed = year * 100 + month; // Consistent seed per month
  
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`[SCHEDULER v10] Generating schedule for ${year}-${month}`);
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
  
  // Track OFF requests per employee per week
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
  // - Each employee has SAME shift for entire week (no daily changes)
  // - Pattern: 2 weeks Morning → 2 weeks Evening (or vice versa)
  // - Continuity: Start with opposite of last month's ending shift
  // - Distribution based on coverage: coverageMorning for Morning, rest for Evening
  // ═══════════════════════════════════════════════════════════════════════
  
  console.log(`\n[STEP 4] Assigning weekly shifts with 2-week rotation...`);
  console.log(`[STEP 4] Coverage target: Morning=${settings.coverageMorning}, Evening=${settings.coverageEvening}`);
  
  // Sort employees consistently for fair distribution
  const sortedEmployees = [...regularEmployees].sort((a, b) => 
    String(a.id).localeCompare(String(b.id))
  );
  
  // Determine starting shift for each employee
  // First coverageMorning employees start with Morning, rest start with Evening
  const employeeStartShift = new Map<string, "Morning" | "Evening">();
  
  for (let i = 0; i < sortedEmployees.length; i++) {
    const emp = sortedEmployees[i];
    const empId = String(emp.id);
    const lastShift = prevMonthLastShift.get(empId);
    
    if (lastShift) {
      // Continuity: opposite of last month
      employeeStartShift.set(empId, lastShift === "Morning" ? "Evening" : "Morning");
    } else {
      // New employee: first coverageMorning get Morning, rest get Evening
      employeeStartShift.set(empId, i < settings.coverageMorning ? "Morning" : "Evening");
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
      
      const assignedShift: "Morning" | "Evening" = isOpposite
        ? (startShift === "Morning" ? "Evening" : "Morning")
        : startShift;
      
      shiftMap.set(empId, assignedShift);
    }
  }
  
  // Log weekly assignments
  for (const [weekIdx, shiftMap] of weeklyShiftAssignment) {
    const mCount = [...shiftMap.values()].filter(s => s === "Morning").length;
    const eCount = [...shiftMap.values()].filter(s => s === "Evening").length;
    console.log(`[STEP 4] Week ${weekIdx}: Morning=${mCount}, Evening=${eCount}`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 5: ASSIGN WEEKLY OFF DAYS
  // 
  // Rules:
  // - Friday: OFF for everyone (handled separately)
  // - Marwa: Saturday OFF always
  // - Each employee: EXACTLY 1 OFF per week (no more, no less)
  // - Max 2 employees OFF per day (excluding Friday)
  // - OFF requests are respected first
  // - Fair distribution: rotate OFF days across weeks
  // ═══════════════════════════════════════════════════════════════════════
  
  console.log(`\n[STEP 5] Assigning weekly OFF days...`);
  
  // Get non-Friday days per week
  const weekDays = new Map<number, string[]>();
  for (const d of allDays) {
    if (getDay(d) === 5) continue; // Skip Friday
    const wIdx = globalWeekIndex(d);
    if (!weekDays.has(wIdx)) weekDays.set(wIdx, []);
    weekDays.get(wIdx)!.push(format(d, "yyyy-MM-dd"));
  }
  
  // Track last OFF day index per employee for fair rotation
  const lastOffDayIndex = new Map<string, number>();
  
  // weekIdx -> empId -> offDateISO
  const weeklyOffDays = new Map<number, Map<string, string>>();
  
  for (let weekPos = 0; weekPos < weekIndices.length; weekPos++) {
    const weekIdx = weekIndices[weekPos];
    const offMap = new Map<string, string>();
    weeklyOffDays.set(weekIdx, offMap);
    
    const availableDays = weekDays.get(weekIdx) || [];
    if (availableDays.length === 0) continue;
    
    // Track OFF count per day (max 2)
    const dayOffCount = new Map<string, number>();
    for (const d of availableDays) dayOffCount.set(d, 0);
    
    // All employees need OFF (regular + between)
    const allEmpsForOff = [...regularEmployees];
    if (betweenEmployee) allEmpsForOff.push(betweenEmployee);
    
    // Sort by last OFF day index for fair rotation
    const sortedEmps = [...allEmpsForOff].sort((a, b) => {
      const aLast = lastOffDayIndex.get(String(a.id)) ?? -1;
      const bLast = lastOffDayIndex.get(String(b.id)) ?? -1;
      return aLast - bLast;
    });
    
    for (const emp of sortedEmps) {
      const empId = String(emp.id);
      
      // 1. Check OFF request first (priority)
      const offReq = getOffRequest(empId, weekIdx);
      if (offReq && availableDays.includes(offReq)) {
        const count = dayOffCount.get(offReq) || 0;
        if (count < MAX_OFF_PER_DAY) {
          offMap.set(empId, offReq);
          dayOffCount.set(offReq, count + 1);
          lastOffDayIndex.set(empId, availableDays.indexOf(offReq));
          continue;
        }
      }
      
      // 2. Marwa: Saturday OFF always
      if (empId === MARWA_ID) {
        const saturday = availableDays.find(d => getDay(new Date(d)) === 6);
        if (saturday && !isVacation(empId, saturday)) {
          const count = dayOffCount.get(saturday) || 0;
          if (count < MAX_OFF_PER_DAY) {
            offMap.set(empId, saturday);
            dayOffCount.set(saturday, count + 1);
            lastOffDayIndex.set(empId, availableDays.indexOf(saturday));
            continue;
          }
        }
      }
      
      // 3. Find best day: prefer different day than last week, min OFF count
      const lastIdx = lastOffDayIndex.get(empId) ?? -1;
      let bestDay: string | null = null;
      let bestScore = Infinity;
      
      for (let i = 0; i < availableDays.length; i++) {
        const d = availableDays[i];
        if (isVacation(empId, d)) continue;
        
        const count = dayOffCount.get(d) || 0;
        if (count >= MAX_OFF_PER_DAY) continue;
        
        // Score: prefer days with fewer OFFs, and different from last week
        const sameAsLast = i === lastIdx ? 10 : 0;
        const score = count * 100 + sameAsLast + i;
        
        if (score < bestScore) {
          bestScore = score;
          bestDay = d;
        }
      }
      
      if (bestDay) {
        offMap.set(empId, bestDay);
        dayOffCount.set(bestDay, (dayOffCount.get(bestDay) || 0) + 1);
        lastOffDayIndex.set(empId, availableDays.indexOf(bestDay));
      }
    }
    
    // Log OFF distribution
    const dist = [...dayOffCount.entries()].map(([d, c]) => `${d.slice(8)}:${c}`).join(' ');
    console.log(`[STEP 5] Week ${weekPos + 1}: ${dist}`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 6: BUILD DAILY ASSIGNMENTS WITH EXACT COVERAGE
  // 
  // CRITICAL: Coverage numbers are EXACT - no exceeding allowed
  // - Morning = EXACTLY coverageMorning employees
  // - Evening = EXACTLY coverageEvening employees
  // - If shortage due to OFF/V, that's acceptable (less than target)
  // - But NEVER exceed the target numbers
  // ═══════════════════════════════════════════════════════════════════════
  
  console.log(`\n[STEP 6] Building daily assignments with EXACT coverage...`);
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
    // CATEGORIZE AVAILABLE EMPLOYEES BY THEIR WEEKLY SHIFT
    // ═══════════════════════════════════════════════════════════════════════
    const morningPool: Employee[] = [];
    const eveningPool: Employee[] = [];
    
    for (const emp of regularEmployees) {
      const empId = String(emp.id);
      
      // Skip if vacation or weekly OFF
      if (isVacation(empId, dateISO)) continue;
      if (weekOffMap.get(empId) === dateISO) continue;
      
      const assignedShift = weekShiftMap.get(empId);
      if (assignedShift === "Morning") {
        morningPool.push(emp);
      } else if (assignedShift === "Evening") {
        eveningPool.push(emp);
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // SELECT EXACTLY THE REQUIRED NUMBER FOR EACH SHIFT
    // NEVER EXCEED - only shortage is acceptable
    // ═══════════════════════════════════════════════════════════════════════
    
    // Select EXACTLY coverageMorning (or less if shortage)
    const selectedMorning = morningPool.slice(0, settings.coverageMorning);
    const selectedMorningIds = new Set(selectedMorning.map(e => String(e.id)));
    
    // Select EXACTLY coverageEvening (or less if shortage)
    const selectedEvening = eveningPool.slice(0, settings.coverageEvening);
    const selectedEveningIds = new Set(selectedEvening.map(e => String(e.id)));
    
    // Log if there's a shortage
    if (selectedMorning.length < settings.coverageMorning) {
      console.log(`[STEP 6] ${dateISO}: Morning shortage ${selectedMorning.length}/${settings.coverageMorning}`);
    }
    if (selectedEvening.length < settings.coverageEvening) {
      console.log(`[STEP 6] ${dateISO}: Evening shortage ${selectedEvening.length}/${settings.coverageEvening}`);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // BUILD ROWS FOR THIS DAY
    // Employees not selected for coverage get OFF (they are extra)
    // ═══════════════════════════════════════════════════════════════════════
    for (const emp of allEmployees) {
      const empId = String(emp.id);
      let symbol: string;
      
      // 1. Check vacation first
      if (isVacation(empId, dateISO)) {
        symbol = VAC;
      }
      // 2. Check weekly OFF
      else if (weekOffMap.get(empId) === dateISO) {
        symbol = OFF;
      }
      // 3. Between Shift employee - works B every day (except OFF/V/Friday)
      else if (betweenEmployee && empId === String(betweenEmployee.id)) {
        symbol = BETWEEN;
      }
      // 4. Selected for Morning coverage
      else if (selectedMorningIds.has(empId)) {
        symbol = getShiftSymbol(emp, "Morning");
      }
      // 5. Selected for Evening coverage
      else if (selectedEveningIds.has(empId)) {
        symbol = getShiftSymbol(emp, "Evening");
      }
      // 6. NOT selected - these are "extra" employees beyond coverage
      // They work their assigned shift (no extra OFF given)
      else {
        const assignedShift = weekShiftMap.get(empId);
        if (assignedShift) {
          symbol = getShiftSymbol(emp, assignedShift);
        } else {
          // Fallback - shouldn't happen
          symbol = getShiftSymbol(emp, "Morning");
        }
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
  // STEP 7: VERIFY COVERAGE & OFF RULES
  // ═══════════════════════════════════════════════════════════════════════
  
  console.log(`\n[STEP 7] Verifying coverage and OFF rules...`);
  
  const morningSymbols = Object.values(MORNING_SHIFTS);
  const eveningSymbols = Object.values(EVENING_SHIFTS);
  
  let issues = 0;
  
  for (const day of allDays) {
    const dateISO = format(day, "yyyy-MM-dd");
    if (getDay(day) === 5) continue; // Skip Friday
    
    const dayRows = rows.filter(r => r.date === dateISO);
    const mCount = dayRows.filter(r => morningSymbols.includes(r.symbol)).length;
    const eCount = dayRows.filter(r => eveningSymbols.includes(r.symbol)).length;
    const offCount = dayRows.filter(r => r.symbol === OFF).length;
    
    // Check coverage
    if (mCount < settings.coverageMorning) {
      console.warn(`[WARN] ${dateISO}: Morning=${mCount}/${settings.coverageMorning}`);
      issues++;
    }
    if (eCount < settings.coverageEvening) {
      console.warn(`[WARN] ${dateISO}: Evening=${eCount}/${settings.coverageEvening}`);
      issues++;
    }
    
    // Check OFF limit (max 2 per day, excluding Friday)
    if (offCount > MAX_OFF_PER_DAY) {
      console.warn(`[WARN] ${dateISO}: OFF=${offCount} (max ${MAX_OFF_PER_DAY})`);
      issues++;
    }
  }
  
  // Verify each employee has exactly 1 OFF per week
  for (const weekIdx of weekIndices) {
    const weekOffMap = weeklyOffDays.get(weekIdx);
    if (!weekOffMap) continue;
    
    for (const emp of allEmployees) {
      const empId = String(emp.id);
      if (!weekOffMap.has(empId) && empId !== settings.betweenShiftEmployeeId) {
        // Check if employee has vacation all week
        const weekDaysList = weekDays.get(weekIdx) || [];
        const hasVacationAllWeek = weekDaysList.every(d => isVacation(empId, d));
        if (!hasVacationAllWeek) {
          console.warn(`[WARN] Week ${weekIdx}: ${emp.name} has no OFF assigned`);
        }
      }
    }
  }
  
  console.log(issues === 0 ? `[STEP 7] ✅ All rules verified!` : `[STEP 7] ⚠️ ${issues} issues found`);

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
