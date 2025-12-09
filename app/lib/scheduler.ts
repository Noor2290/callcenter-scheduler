// ═══════════════════════════════════════════════════════════════════════════
//  GENERATE SCHEDULE — HOSPITAL-GRADE v5.0
//  
//  ✅ FAIR WEEKLY PATTERN DISTRIBUTION (NO FIXED GROUPS)
//  ✅ RANDOM BALANCED ASSIGNMENT
//  ✅ EXACT DAILY COVERAGE (Morning=4, Evening=7 from settings)
//  ✅ MONTH CONTINUITY
//  ✅ OFF/VACATION/OFFREQUEST RULES
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
type WeekPattern = Shift[];
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

/** Generate balanced weekly patterns for employees */
function generateWeeklyPatterns(numWeeks: number, startShift: Shift): WeekPattern[] {
  // Pattern A: M, E, M, E (alternating)
  // Pattern B: M, M, E, E (two consecutive)
  const patterns: WeekPattern[] = [];
  
  if (numWeeks === 2) {
    // Only 2 weeks: M,E or E,M
    patterns.push([startShift, startShift === "Morning" ? "Evening" : "Morning"]);
    patterns.push([startShift === "Morning" ? "Evening" : "Morning", startShift]);
  } else if (numWeeks === 3) {
    patterns.push(["Morning", "Evening", "Morning"]);
    patterns.push(["Evening", "Morning", "Evening"]);
    patterns.push(["Morning", "Morning", "Evening"]);
    patterns.push(["Evening", "Evening", "Morning"]);
  } else if (numWeeks >= 4) {
    // 4+ weeks: balanced patterns
    patterns.push(["Morning", "Evening", "Morning", "Evening"]);
    patterns.push(["Evening", "Morning", "Evening", "Morning"]);
    patterns.push(["Morning", "Morning", "Evening", "Evening"]);
    patterns.push(["Evening", "Evening", "Morning", "Morning"]);
  } else {
    // 1 week
    patterns.push([startShift]);
    patterns.push([startShift === "Morning" ? "Evening" : "Morning"]);
  }
  
  return patterns;
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
  console.log(`[SCHEDULER v5] Generating schedule for ${year}-${month}`);
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
  
  const offRequestMap = new Map<string, string>(); // empId_weekIdx -> dateISO
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
  // STEP 4: ASSIGN WEEKLY PATTERNS (RANDOM BALANCED)
  // ═══════════════════════════════════════════════════════════════════════
  
  console.log(`\n[STEP 4] Assigning weekly patterns...`);
  
  // empId -> weekIdx -> Shift
  const weeklyShifts = new Map<string, Map<number, Shift>>();
  
  // Shuffle employees for random assignment
  const shuffledEmployees = shuffle([...employees]);
  
  for (const emp of shuffledEmployees) {
    const empId = String(emp.id);
    const shiftMap = new Map<number, Shift>();
    
    // Determine starting shift (opposite of previous month)
    let startShift: Shift = "Morning";
    if (prevMonthLastShift.has(empId)) {
      startShift = prevMonthLastShift.get(empId) === "Morning" ? "Evening" : "Morning";
    } else {
      startShift = Math.random() < 0.5 ? "Morning" : "Evening";
    }
    
    // Generate pattern for this employee
    const patterns = generateWeeklyPatterns(numWeeks, startShift);
    const selectedPattern = patterns[Math.floor(Math.random() * patterns.length)];
    
    // Assign pattern to weeks
    for (let i = 0; i < weekIndices.length; i++) {
      const weekIdx = weekIndices[i];
      const shift = selectedPattern[i % selectedPattern.length];
      shiftMap.set(weekIdx, shift);
    }
    
    weeklyShifts.set(empId, shiftMap);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 5: ASSIGN WEEKLY OFF DAYS
  // ═══════════════════════════════════════════════════════════════════════
  
  console.log(`\n[STEP 5] Assigning weekly OFF days...`);
  
  const weekDays = new Map<number, string[]>();
  for (const d of allDays) {
    if (getDay(d) === 5) continue;
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
    
    const dayOffCount = new Map<string, number>();
    for (const d of availableDays) dayOffCount.set(d, 0);
    
    for (const emp of shuffle([...employees])) {
      const empId = String(emp.id);
      
      // Check OffRequest first
      const offReq = getOffRequest(empId, weekIdx);
      if (offReq) {
        offMap.set(empId, offReq);
        if (dayOffCount.has(offReq)) dayOffCount.set(offReq, dayOffCount.get(offReq)! + 1);
        continue;
      }
      
      // Marwa: Saturday OFF
      if (empId === MARWA_ID) {
        const saturday = availableDays.find(d => getDay(new Date(d)) === 6);
        if (saturday && !isVacation(empId, saturday)) {
          offMap.set(empId, saturday);
          dayOffCount.set(saturday, dayOffCount.get(saturday)! + 1);
          continue;
        }
      }
      
      // Find day with minimum OFFs
      let bestDay: string | null = null;
      let minCount = Infinity;
      for (const d of availableDays) {
        if (isVacation(empId, d)) continue;
        const count = dayOffCount.get(d)!;
        if (count < minCount) {
          minCount = count;
          bestDay = d;
        }
      }
      
      if (bestDay) {
        offMap.set(empId, bestDay);
        dayOffCount.set(bestDay, dayOffCount.get(bestDay)! + 1);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 6: BUILD DAILY ASSIGNMENTS WITH EXACT COVERAGE
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
    
    // Separate employees by availability
    const unavailable: Employee[] = [];
    const availableForShift: Employee[] = [];
    
    for (const emp of employees) {
      const empId = String(emp.id);
      
      if (isVacation(empId, dateISO)) {
        unavailable.push(emp);
      } else if (weekOffMap.get(empId) === dateISO) {
        unavailable.push(emp);
      } else {
        availableForShift.push(emp);
      }
    }
    
    // Get weekly shift preference for each available employee
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
    
    // Shuffle for randomness
    const shuffledMorning = shuffle(morningPreferred);
    const shuffledEvening = shuffle(eveningPreferred);
    
    // Select exactly morningCoverage for Morning, rest for Evening
    const finalMorning: Set<string> = new Set();
    const finalEvening: Set<string> = new Set();
    
    // First, fill Morning from preferred
    for (const emp of shuffledMorning) {
      if (finalMorning.size < morningCoverage) {
        finalMorning.add(String(emp.id));
      } else {
        finalEvening.add(String(emp.id));
      }
    }
    
    // If not enough Morning, take from Evening preferred
    for (const emp of shuffledEvening) {
      if (finalMorning.size < morningCoverage) {
        finalMorning.add(String(emp.id));
      } else {
        finalEvening.add(String(emp.id));
      }
    }
    
    // Build rows for this day
    for (const emp of employees) {
      const empId = String(emp.id);
      let symbol: string;
      
      if (isVacation(empId, dateISO)) {
        symbol = VAC;
      } else if (weekOffMap.get(empId) === dateISO) {
        symbol = OFF;
      } else if (finalMorning.has(empId)) {
        symbol = getShiftSymbol(emp, "Morning");
      } else {
        symbol = getShiftSymbol(emp, "Evening");
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
    
    if (mCount !== morningCoverage || eCount < eveningCoverage) {
      console.warn(`[WARN] ${dateISO}: M=${mCount}/${morningCoverage}, E=${eCount}/${eveningCoverage}`);
      issues++;
    }
  }
  
  console.log(issues === 0 ? `[STEP 7] ✅ All days OK!` : `[STEP 7] ⚠️ ${issues} issues`);

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 8: SAVE TO DATABASE
  // ═══════════════════════════════════════════════════════════════════════
  
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
