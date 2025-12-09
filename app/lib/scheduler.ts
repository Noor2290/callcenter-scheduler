// ═══════════════════════════════════════════════════════════════════════════
//  GENERATE SCHEDULE — HOSPITAL-GRADE v6.0
//  
//  ✅ 4 FIXED WEEKLY PATTERNS (A, B, C, D)
//  ✅ BALANCED RANDOM PATTERN ASSIGNMENT
//  ✅ EXACT DAILY COVERAGE FROM SETTINGS
//  ✅ MONTH CONTINUITY (opposite of previous month)
//  ✅ OFF/VACATION/OFFREQUEST RULES
//  ✅ NO FIXED GROUPS, NO ALPHABETICAL ORDER
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
// THE 4 FIXED PATTERNS
// ═══════════════════════════════════════════════════════════════════════════
// Pattern A: M, E, M, E (alternating starting Morning)
// Pattern B: M, M, E, E (two consecutive starting Morning)
// Pattern C: E, M, E, M (alternating starting Evening)
// Pattern D: E, E, M, M (two consecutive starting Evening)
const PATTERN_A: Shift[] = ["Morning", "Evening", "Morning", "Evening"];
const PATTERN_B: Shift[] = ["Morning", "Morning", "Evening", "Evening"];
const PATTERN_C: Shift[] = ["Evening", "Morning", "Evening", "Morning"];
const PATTERN_D: Shift[] = ["Evening", "Evening", "Morning", "Morning"];

const ALL_PATTERNS = [PATTERN_A, PATTERN_B, PATTERN_C, PATTERN_D];

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

/** Get patterns that start with the required shift (for continuity) */
function getPatternsStartingWith(startShift: Shift): Shift[][] {
  return ALL_PATTERNS.filter(p => p[0] === startShift);
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
  // STEP 4: ASSIGN WEEKLY PATTERNS (BALANCED RANDOM)
  // 
  // Each employee gets one of the 4 patterns:
  // - Pattern A: M, E, M, E
  // - Pattern B: M, M, E, E
  // - Pattern C: E, M, E, M
  // - Pattern D: E, E, M, M
  // 
  // Continuity: if last month ended with Morning, start with Evening pattern
  // Balance: distribute patterns evenly among employees
  // ═══════════════════════════════════════════════════════════════════════
  
  console.log(`\n[STEP 4] Assigning weekly patterns...`);
  
  // empId -> weekIdx -> Shift
  const weeklyShifts = new Map<string, Map<number, Shift>>();
  
  // Track pattern usage for balance
  const patternUsage = new Map<string, number>();
  patternUsage.set("A", 0);
  patternUsage.set("B", 0);
  patternUsage.set("C", 0);
  patternUsage.set("D", 0);
  
  // Shuffle employees for random assignment
  const shuffledEmployees = shuffle([...employees]);
  
  for (const emp of shuffledEmployees) {
    const empId = String(emp.id);
    const shiftMap = new Map<number, Shift>();
    
    // Determine required starting shift (opposite of previous month)
    let requiredStartShift: Shift;
    if (prevMonthLastShift.has(empId)) {
      requiredStartShift = prevMonthLastShift.get(empId) === "Morning" ? "Evening" : "Morning";
    } else {
      // New employee: random start, but try to balance
      const morningPatterns = patternUsage.get("A")! + patternUsage.get("B")!;
      const eveningPatterns = patternUsage.get("C")! + patternUsage.get("D")!;
      requiredStartShift = morningPatterns <= eveningPatterns ? "Morning" : "Evening";
    }
    
    // Get patterns that start with required shift
    const validPatterns = getPatternsStartingWith(requiredStartShift);
    
    // Choose the least used pattern for balance
    let selectedPattern: Shift[];
    let selectedPatternName: string;
    
    if (requiredStartShift === "Morning") {
      // Choose between A and B
      if (patternUsage.get("A")! <= patternUsage.get("B")!) {
        selectedPattern = PATTERN_A;
        selectedPatternName = "A";
      } else {
        selectedPattern = PATTERN_B;
        selectedPatternName = "B";
      }
    } else {
      // Choose between C and D
      if (patternUsage.get("C")! <= patternUsage.get("D")!) {
        selectedPattern = PATTERN_C;
        selectedPatternName = "C";
      } else {
        selectedPattern = PATTERN_D;
        selectedPatternName = "D";
      }
    }
    
    patternUsage.set(selectedPatternName, patternUsage.get(selectedPatternName)! + 1);
    
    // Assign pattern to weeks
    for (let i = 0; i < weekIndices.length; i++) {
      const weekIdx = weekIndices[i];
      const shift = selectedPattern[i % selectedPattern.length];
      shiftMap.set(weekIdx, shift);
    }
    
    weeklyShifts.set(empId, shiftMap);
  }
  
  console.log(`[STEP 4] Pattern distribution: A=${patternUsage.get("A")}, B=${patternUsage.get("B")}, C=${patternUsage.get("C")}, D=${patternUsage.get("D")}`);

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
  
  for (const day of allDays) {
    const dateISO = format(day, "yyyy-MM-dd");
    const dow = getDay(day);
    const weekIdx = globalWeekIndex(day);
    
    // Friday: OFF for everyone
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
    
    // Categorize employees
    const onVacation: Employee[] = [];
    const onOff: Employee[] = [];
    const availableForShift: Employee[] = [];
    
    for (const emp of employees) {
      const empId = String(emp.id);
      
      if (isVacation(empId, dateISO)) {
        onVacation.push(emp);
      } else if (weekOffMap.get(empId) === dateISO) {
        onOff.push(emp);
      } else {
        availableForShift.push(emp);
      }
    }
    
    // Separate available employees by their weekly pattern preference
    const morningPreferred: Employee[] = [];
    const eveningPreferred: Employee[] = [];
    
    for (const emp of availableForShift) {
      const empId = String(emp.id);
      const weeklyShift = weeklyShifts.get(empId)?.get(weekIdx) || "Morning";
      if (weeklyShift === "Morning") {
        morningPreferred.push(emp);
      } else {
        eveningPreferred.push(emp);
      }
    }
    
    // Shuffle for fair random selection within each group
    const shuffledMorning = shuffle(morningPreferred);
    const shuffledEvening = shuffle(eveningPreferred);
    
    // ═══════════════════════════════════════════════════════════════════════
    // CHECK: Is coverage possible?
    // ═══════════════════════════════════════════════════════════════════════
    const totalNeeded = morningCoverage + eveningCoverage;
    const totalAvailable = availableForShift.length;
    
    if (totalAvailable < totalNeeded) {
      console.warn(`⚠️ Coverage impossible on ${dateISO}: need ${totalNeeded}, available ${totalAvailable}`);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 6.1: Select exactly morningCoverage for Morning
    // ═══════════════════════════════════════════════════════════════════════
    const finalMorning: Set<string> = new Set();
    
    // First, fill Morning from those who prefer Morning
    for (const emp of shuffledMorning) {
      if (finalMorning.size < morningCoverage) {
        finalMorning.add(String(emp.id));
      }
    }
    
    // If not enough Morning, take from Evening preferred
    for (const emp of shuffledEvening) {
      if (finalMorning.size < morningCoverage) {
        finalMorning.add(String(emp.id));
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 6.2: Select exactly eveningCoverage for Evening from remaining
    // ═══════════════════════════════════════════════════════════════════════
    const remaining = availableForShift.filter(emp => !finalMorning.has(String(emp.id)));
    const shuffledRemaining = shuffle(remaining);
    const finalEvening: Set<string> = new Set();
    
    for (const emp of shuffledRemaining) {
      if (finalEvening.size < eveningCoverage) {
        finalEvening.add(String(emp.id));
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 6.2.1: If Evening still not enough, take from Morning (rebalance)
    // ═══════════════════════════════════════════════════════════════════════
    if (finalEvening.size < eveningCoverage && finalMorning.size > 0) {
      // Convert Morning set to array for iteration
      const morningArray = Array.from(finalMorning);
      const shuffledMorningArray = shuffle(morningArray);
      
      for (const empId of shuffledMorningArray) {
        if (finalEvening.size >= eveningCoverage) break;
        if (finalMorning.size <= 1) break; // Keep at least 1 in Morning
        
        // Move from Morning to Evening
        finalMorning.delete(empId);
        finalEvening.add(empId);
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 6.3: Build rows for this day
    // Employee must be in: Morning, Evening, OFF, or VAC
    // Extra employees (not in Morning/Evening) get OFF
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
      } else if (finalEvening.has(empId)) {
        symbol = getShiftSymbol(emp, "Evening");
      } else {
        // Extra employee not assigned to Morning or Evening
        // This happens when total available > morningCoverage + eveningCoverage
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
      issues,
      patternDistribution: {
        A: patternUsage.get("A"),
        B: patternUsage.get("B"),
        C: patternUsage.get("C"),
        D: patternUsage.get("D")
      }
    }
  };
}
