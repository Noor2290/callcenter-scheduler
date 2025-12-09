// ═══════════════════════════════════════════════════════════════════════════
//  GENERATE SCHEDULE — v7.0 (SETTINGS-BASED COVERAGE)
//  
//  ✅ COVERAGE FROM SETTINGS ONLY (NO DYNAMIC CALCULATION)
//  ✅ FAIRNESS: Equal Morning/Evening distribution per employee
//  ✅ CONTINUITY: Opposite shift from previous month
//  ✅ OFF RULES: Friday all, Marwa Saturday, 1 weekly OFF per employee
//  ✅ NO GROUPS, NO ALPHABETICAL ORDER
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
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════
const OFF = "O";
const VAC = "V";
const FT_MORNING = "MA1";
const FT_EVENING = "EA1";
const PT_MORNING = "PT4";
const PT_EVENING = "PT5";
const MARWA_ID = "3864";
const EPOCH_SATURDAY = new Date(2020, 0, 4);

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════
type Shift = "Morning" | "Evening";

interface Employee {
  id: number | string;
  name: string;
  employment_type?: string;
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
  const isPartTime = emp.employment_type === "PartTime";
  return shift === "Morning" 
    ? (isPartTime ? PT_MORNING : FT_MORNING)
    : (isPartTime ? PT_EVENING : FT_EVENING);
}

function parseShiftFromSymbol(symbol: string): Shift | null {
  if (!symbol) return null;
  const s = symbol.toUpperCase();
  if (s === OFF || s === VAC) return null;
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
  console.log(`[SCHEDULER v6] Generating schedule for ${year}-${month}`);
  console.log(`${'═'.repeat(60)}\n`);

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 1: LOAD DATA
  // ═══════════════════════════════════════════════════════════════════════
  
  const { data: monthRow, error: monthErr } = await sb
    .from("months")
    .upsert({ year, month }, { onConflict: "year,month" })
    .select("*")
    .single();
  
  if (monthErr || !monthRow) throw new Error(monthErr?.message || "Failed to create month");

  const { data: empData } = await sb.from("employees").select("*").order("name");
  const employees: Employee[] = (empData || []) as Employee[];
  console.log(`[STEP 1] Employees: ${employees.length}`);

  const { data: settingsData } = await sb.from("settings").select("key, value");
  const settings: Record<string, string> = {};
  for (const s of settingsData || []) {
    if (s.key) {
      settings[s.key] = s.value;
      settings[s.key.toLowerCase()] = s.value;
    }
  }
  
  const morningCoverage = Number(settings['coverageMorning'] || settings['coveragemorning']) || 4;
  const eveningCoverage = Number(settings['coverageEvening'] || settings['coverageevening']) || 7;
  console.log(`[STEP 1] Coverage: Morning=${morningCoverage}, Evening=${eveningCoverage}`);

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
  
  const prevMonthLastShift = new Map<string, Shift>();
  
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
        if (shift) prevMonthLastShift.set(empId, shift);
      }
    }
  }
  console.log(`[STEP 3] Previous month shifts loaded: ${prevMonthLastShift.size}`);

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 4: TRACK FAIRNESS (Morning/Evening count per employee)
  // 
  // We track how many Morning and Evening shifts each employee has
  // to ensure fair distribution throughout the month.
  // ═══════════════════════════════════════════════════════════════════════
  
  console.log(`\n[STEP 4] Initializing fairness tracking...`);
  console.log(`[STEP 4] Settings: Morning=${morningCoverage}, Evening=${eveningCoverage}`);
  
  // Track shift counts for fairness
  const morningCount = new Map<string, number>();
  const eveningCount = new Map<string, number>();
  
  for (const emp of employees) {
    const empId = String(emp.id);
    morningCount.set(empId, 0);
    eveningCount.set(empId, 0);
  }
  
  // Load previous month last shift for continuity
  // If last shift was Morning → prefer Evening this month start
  // If last shift was Evening → prefer Morning this month start
  const preferredStartShift = new Map<string, Shift>();
  
  for (const emp of employees) {
    const empId = String(emp.id);
    const lastShift = prevMonthLastShift.get(empId);
    if (lastShift) {
      // Opposite of last month
      preferredStartShift.set(empId, lastShift === "Morning" ? "Evening" : "Morning");
    } else {
      // New employee: random start
      preferredStartShift.set(empId, Math.random() < 0.5 ? "Morning" : "Evening");
    }
  }
  
  console.log(`[STEP 4] Continuity loaded for ${prevMonthLastShift.size} employees`);

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 5: ASSIGN WEEKLY OFF DAYS
  // 
  // Rules:
  // - Friday: OFF for everyone (handled in STEP 6)
  // - Marwa: Saturday OFF always
  // - Each employee: 1 OFF per week (random, balanced)
  // - OffRequest = the weekly OFF
  // - Cannot be on Vacation day
  // ═══════════════════════════════════════════════════════════════════════
  
  console.log(`\n[STEP 5] Assigning weekly OFF days...`);
  
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
    
    // Track OFF count per day for balancing
    const dayOffCount = new Map<string, number>();
    for (const d of availableDays) dayOffCount.set(d, 0);
    
    // Process employees in random order
    for (const emp of shuffle([...employees])) {
      const empId = String(emp.id);
      
      // Check OffRequest first
      const offReq = getOffRequest(empId, weekIdx);
      if (offReq && availableDays.includes(offReq)) {
        offMap.set(empId, offReq);
        dayOffCount.set(offReq, (dayOffCount.get(offReq) || 0) + 1);
        continue;
      }
      
      // Marwa: Saturday OFF always
      if (empId === MARWA_ID) {
        const saturday = availableDays.find(d => getDay(new Date(d)) === 6);
        if (saturday && !isVacation(empId, saturday)) {
          offMap.set(empId, saturday);
          dayOffCount.set(saturday, (dayOffCount.get(saturday) || 0) + 1);
          continue;
        }
      }
      
      // Find day with minimum OFFs (balanced distribution)
      let bestDay: string | null = null;
      let minCount = Infinity;
      
      for (const d of availableDays) {
        if (isVacation(empId, d)) continue;
        const count = dayOffCount.get(d) || 0;
        if (count < minCount) {
          minCount = count;
          bestDay = d;
        }
      }
      
      if (bestDay) {
        offMap.set(empId, bestDay);
        dayOffCount.set(bestDay, (dayOffCount.get(bestDay) || 0) + 1);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 6: BUILD DAILY ASSIGNMENTS WITH EXACT COVERAGE
  // 
  // For each day:
  // 1. Friday → OFF for all
  // 2. Vacation → V (excluded from coverage)
  // 3. Weekly OFF → O (excluded from coverage)
  // 4. Available employees → assign Morning/Evening based on weekly pattern
  // 5. Ensure exactly morningCoverage Morning and eveningCoverage Evening
  // ═══════════════════════════════════════════════════════════════════════
  
  console.log(`\n[STEP 6] Building daily assignments with exact coverage...`);
  
  const rows: Array<{
    month_id: string;
    employee_id: number | string;
    date: string;
    symbol: string;
    code: string;
  }> = [];
  
  // Track if this is the first working day (for continuity)
  let isFirstWorkingDay = true;
  
  for (const day of allDays) {
    const dateISO = format(day, "yyyy-MM-dd");
    const dow = getDay(day);
    const weekIdx = globalWeekIndex(day);
    
    // ═══════════════════════════════════════════════════════════════════════
    // FRIDAY: OFF for everyone
    // ═══════════════════════════════════════════════════════════════════════
    if (dow === 5) {
      for (const emp of employees) {
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
    
    // ═══════════════════════════════════════════════════════════════════════
    // CATEGORIZE EMPLOYEES: Vacation, OFF, Available
    // ═══════════════════════════════════════════════════════════════════════
    const availableForShift: Employee[] = [];
    
    for (const emp of employees) {
      const empId = String(emp.id);
      
      if (!isVacation(empId, dateISO) && weekOffMap.get(empId) !== dateISO) {
        availableForShift.push(emp);
      }
    }
    
    const totalAvailable = availableForShift.length;
    
    // ═══════════════════════════════════════════════════════════════════════
    // APPLY COVERAGE FROM SETTINGS (NO DYNAMIC CALCULATION)
    // 
    // Rules:
    // 1. If available >= Morning + Evening → use exact settings
    // 2. If available < Morning + Evening → prioritize Morning, then Evening
    // 3. Never exceed available count
    // ═══════════════════════════════════════════════════════════════════════
    
    // Calculate actual coverage for this day
    let actualMorning = Math.min(morningCoverage, totalAvailable);
    let actualEvening = Math.min(eveningCoverage, totalAvailable - actualMorning);
    
    // Log warning if coverage is impossible
    if (totalAvailable < morningCoverage + eveningCoverage) {
      console.warn(`⚠️ ${dateISO}: Available=${totalAvailable}, Need=${morningCoverage + eveningCoverage}, Actual M=${actualMorning}/E=${actualEvening}`);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // FAIR SELECTION: Sort by least shifts, then by continuity preference
    // ═══════════════════════════════════════════════════════════════════════
    
    // Sort available employees by fairness (least Morning shifts first for Morning selection)
    const sortedForMorning = [...availableForShift].sort((a, b) => {
      const aId = String(a.id);
      const bId = String(b.id);
      const aMorning = morningCount.get(aId) || 0;
      const bMorning = morningCount.get(bId) || 0;
      
      // First: fewer Morning shifts = higher priority
      if (aMorning !== bMorning) return aMorning - bMorning;
      
      // Second: if first working day, prefer those who need opposite of last month
      if (isFirstWorkingDay) {
        const aPref = preferredStartShift.get(aId);
        const bPref = preferredStartShift.get(bId);
        if (aPref === "Morning" && bPref !== "Morning") return -1;
        if (bPref === "Morning" && aPref !== "Morning") return 1;
      }
      
      // Third: random tiebreaker
      return Math.random() - 0.5;
    });
    
    // Select Morning employees
    const finalMorning = new Set<string>();
    for (let i = 0; i < actualMorning && i < sortedForMorning.length; i++) {
      finalMorning.add(String(sortedForMorning[i].id));
    }
    
    // Remaining employees (not in Morning)
    const remainingForEvening = availableForShift.filter(emp => !finalMorning.has(String(emp.id)));
    
    // Sort remaining by fairness (least Evening shifts first)
    const sortedForEvening = [...remainingForEvening].sort((a, b) => {
      const aId = String(a.id);
      const bId = String(b.id);
      const aEvening = eveningCount.get(aId) || 0;
      const bEvening = eveningCount.get(bId) || 0;
      
      // First: fewer Evening shifts = higher priority
      if (aEvening !== bEvening) return aEvening - bEvening;
      
      // Second: if first working day, prefer those who need opposite of last month
      if (isFirstWorkingDay) {
        const aPref = preferredStartShift.get(aId);
        const bPref = preferredStartShift.get(bId);
        if (aPref === "Evening" && bPref !== "Evening") return -1;
        if (bPref === "Evening" && aPref !== "Evening") return 1;
      }
      
      // Third: random tiebreaker
      return Math.random() - 0.5;
    });
    
    // Select Evening employees
    const finalEvening = new Set<string>();
    for (let i = 0; i < actualEvening && i < sortedForEvening.length; i++) {
      finalEvening.add(String(sortedForEvening[i].id));
    }
    
    // Mark first working day as done
    isFirstWorkingDay = false;
    
    // ═══════════════════════════════════════════════════════════════════════
    // BUILD ROWS FOR THIS DAY
    // ═══════════════════════════════════════════════════════════════════════
    for (const emp of employees) {
      const empId = String(emp.id);
      let symbol: string;
      
      if (isVacation(empId, dateISO)) {
        symbol = VAC;
      } else if (weekOffMap.get(empId) === dateISO) {
        symbol = OFF;
      } else if (finalMorning.has(empId)) {
        symbol = getShiftSymbol(emp, "Morning");
        // Update fairness counter
        morningCount.set(empId, (morningCount.get(empId) || 0) + 1);
      } else if (finalEvening.has(empId)) {
        symbol = getShiftSymbol(emp, "Evening");
        // Update fairness counter
        eveningCount.set(empId, (eveningCount.get(empId) || 0) + 1);
      } else {
        // Extra employee: not assigned to Morning or Evening
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
  
  // Log fairness summary
  console.log(`\n[STEP 6] Fairness Summary:`);
  for (const emp of employees) {
    const empId = String(emp.id);
    const m = morningCount.get(empId) || 0;
    const e = eveningCount.get(empId) || 0;
    console.log(`  ${emp.name}: Morning=${m}, Evening=${e}`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 7: VERIFY COVERAGE
  // ═══════════════════════════════════════════════════════════════════════
  
  console.log(`\n[STEP 7] Verifying coverage...`);
  
  let issues = 0;
  for (const day of allDays) {
    const dateISO = format(day, "yyyy-MM-dd");
    if (getDay(day) === 5) continue;
    
    const dayRows = rows.filter(r => r.date === dateISO);
    const mCount = dayRows.filter(r => [FT_MORNING, PT_MORNING].includes(r.symbol)).length;
    const eCount = dayRows.filter(r => [FT_EVENING, PT_EVENING].includes(r.symbol)).length;
    
    if (mCount !== morningCoverage) {
      console.warn(`[WARN] ${dateISO}: Morning=${mCount}/${morningCoverage}`);
      issues++;
    }
    if (eCount < eveningCoverage) {
      console.warn(`[WARN] ${dateISO}: Evening=${eCount}/${eveningCoverage}`);
      issues++;
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
      employees: employees.length,
      morningCoverage,
      eveningCoverage,
      weeks: numWeeks,
      assignments: rows.length,
      issues
    }
  };
}
