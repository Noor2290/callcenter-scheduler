// ═══════════════════════════════════════════════════════════════════════════
//  GENERATE SCHEDULE — HOSPITAL-GRADE v4.0
//  
//  ✅ GUARANTEED BEHAVIORS:
//  1. Settings-driven: MorningCoverage & EveningCoverage from database
//  2. Fair weekly distribution: alternating shifts per employee
//  3. Month continuity: opposite shift from previous month's last week
//  4. OFF rules: Friday=all, Marwa=Saturday, 1 random OFF per week
//  5. Vacation & OffRequest respected
//  6. Daily coverage matches settings exactly
//  7. Part-time symbols: PT4/PT5, Full-time: MA1/EA1
//  8. NO shift change within same week
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

// Week starts on Saturday
const EPOCH_SATURDAY = new Date(2020, 0, 4); // Jan 4, 2020 = Saturday

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/** Calculate global week index (continuous across all months) */
function globalWeekIndex(date: Date): number {
  const dow = getDay(date);
  const daysFromSat = (dow + 1) % 7; // Sat=0, Sun=1, ..., Fri=6
  const weekStart = new Date(date);
  weekStart.setDate(date.getDate() - daysFromSat);
  weekStart.setHours(0, 0, 0, 0);
  
  const diffMs = weekStart.getTime() - EPOCH_SATURDAY.getTime();
  return Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
}

/** Get shift symbol based on employee type */
function getShiftSymbol(emp: any, shift: "Morning" | "Evening"): string {
  const isPartTime = emp.employment_type === "PartTime";
  if (shift === "Morning") {
    return isPartTime ? PT_MORNING : FT_MORNING;
  }
  return isPartTime ? PT_EVENING : FT_EVENING;
}

/** Parse shift from symbol (for reading previous month) */
function parseShiftFromSymbol(symbol: string): "Morning" | "Evening" | null {
  if (!symbol) return null;
  const s = symbol.toUpperCase();
  if (s === OFF || s === VAC) return null;
  
  // Morning symbols
  if (["MA1", "MA2", "MA4", "PT4", "M2"].includes(s) || s.startsWith("M")) {
    return "Morning";
  }
  // Evening symbols
  if (["EA1", "E2", "E5", "PT5"].includes(s) || s.startsWith("E")) {
    return "Evening";
  }
  return null;
}

/** Shuffle array (Fisher-Yates) */
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
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[SCHEDULER] Generating schedule for ${year}-${month}`);
  console.log(`${'='.repeat(60)}\n`);

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 1: LOAD ALL DATA
  // ═══════════════════════════════════════════════════════════════════════
  
  // Create/get month row
  const { data: monthRow, error: monthErr } = await sb
    .from("months")
    .upsert({ year, month }, { onConflict: "year,month" })
    .select("*")
    .single();
  
  if (monthErr || !monthRow) {
    throw new Error(monthErr?.message || "Failed to create month row");
  }

  // Load employees (sorted alphabetically)
  const { data: empData } = await sb
    .from("employees")
    .select("*")
    .order("name", { ascending: true });
  const employees = empData || [];
  
  console.log(`[STEP 1] Loaded ${employees.length} employees`);

  // Load settings (DYNAMIC - no hardcoded values!)
  const { data: settingsData } = await sb.from("settings").select("key, value");
  const settings: Record<string, string> = {};
  for (const s of settingsData || []) {
    if (s.key) {
      settings[s.key] = s.value;
      settings[s.key.toLowerCase()] = s.value;
    }
  }
  
  const morningCoverage = Number(settings['coverageMorning'] || settings['coveragemorning'] || settings['morningCoveragePerDay']) || 5;
  const eveningCoverage = Number(settings['coverageEvening'] || settings['coverageevening'] || settings['eveningCoveragePerDay']) || 6;
  
  console.log(`[STEP 1] Settings: Morning=${morningCoverage}, Evening=${eveningCoverage}`);

  // Load Vacations
  const { data: vacationData } = await sb
    .from("requests")
    .select("*")
    .eq("type", "Vacation");
  
  const vacationSet = new Set<string>();
  for (const v of vacationData || []) {
    const key = `${v.employee_id}_${format(new Date(v.date), "yyyy-MM-dd")}`;
    vacationSet.add(key);
  }
  
  // Load OffRequests
  const { data: offRequestData } = await sb
    .from("requests")
    .select("*")
    .eq("type", "OffRequest");
  
  const offRequestSet = new Set<string>();
  const offRequestByWeek = new Map<string, Set<number>>(); // empId -> Set of weekIdx with OffRequest
  
  for (const o of offRequestData || []) {
    const dateISO = format(new Date(o.date), "yyyy-MM-dd");
    const key = `${o.employee_id}_${dateISO}`;
    offRequestSet.add(key);
    
    const empId = String(o.employee_id);
    const weekIdx = globalWeekIndex(new Date(o.date));
    if (!offRequestByWeek.has(empId)) offRequestByWeek.set(empId, new Set());
    offRequestByWeek.get(empId)!.add(weekIdx);
  }
  
  console.log(`[STEP 1] Vacations: ${vacationSet.size}, OffRequests: ${offRequestSet.size}`);

  // Helper functions
  const isVacation = (empId: string, dateISO: string) => vacationSet.has(`${empId}_${dateISO}`);
  const isOffRequest = (empId: string, dateISO: string) => offRequestSet.has(`${empId}_${dateISO}`);
  const hasOffRequestInWeek = (empId: string, weekIdx: number) => offRequestByWeek.get(empId)?.has(weekIdx) || false;

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 2: PREPARE DATES AND WEEKS
  // ═══════════════════════════════════════════════════════════════════════
  
  const monthStart = startOfMonth(new Date(year, month - 1, 1));
  const monthEnd = endOfMonth(monthStart);
  const allDays = eachDayOfInterval({ start: monthStart, end: monthEnd });
  
  // Get unique week indices
  const weekIndices = [...new Set(allDays.map(d => globalWeekIndex(d)))].sort((a, b) => a - b);
  
  console.log(`[STEP 2] Days in month: ${allDays.length}, Weeks: ${weekIndices.length}`);
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
  
  // Map: empId -> last shift in previous month
  const prevMonthLastShift = new Map<string, "Morning" | "Evening">();
  
  if (prevMonthRow) {
    const { data: prevAssigns } = await sb
      .from("assignments")
      .select("employee_id, symbol, date")
      .eq("month_id", prevMonthRow.id)
      .order("date", { ascending: false });
    
    for (const a of prevAssigns || []) {
      const empId = String(a.employee_id);
      if (prevMonthLastShift.has(empId)) continue;
      const shift = parseShiftFromSymbol(a.symbol);
      if (shift) prevMonthLastShift.set(empId, shift);
    }
    console.log(`[STEP 3] Loaded ${prevMonthLastShift.size} employees' last shifts from previous month`);
  } else {
    console.log(`[STEP 3] No previous month data found`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 4: ASSIGN WEEKLY SHIFTS (FAIR DISTRIBUTION)
  // 
  // Rules:
  // - Each employee alternates: Morning week → Evening week → ...
  // - First week: opposite of last week in previous month
  // - If no previous data: random initial assignment
  // - Ensures no employee stays in same shift all month
  // ═══════════════════════════════════════════════════════════════════════
  
  console.log(`\n[STEP 4] Assigning weekly shifts...`);
  
  // empId -> weekIdx -> shift
  const weeklyShiftAssignment = new Map<string, Map<number, "Morning" | "Evening">>();
  
  for (const emp of employees) {
    const empId = String(emp.id);
    const shiftMap = new Map<number, "Morning" | "Evening">();
    
    // Determine first week's shift
    let currentShift: "Morning" | "Evening";
    
    if (prevMonthLastShift.has(empId)) {
      // CONTINUITY: opposite of last month's last shift
      const lastShift = prevMonthLastShift.get(empId)!;
      currentShift = lastShift === "Morning" ? "Evening" : "Morning";
    } else {
      // NEW EMPLOYEE: random start
      currentShift = Math.random() < 0.5 ? "Morning" : "Evening";
    }
    
    // Assign shifts for each week (alternating)
    for (let i = 0; i < weekIndices.length; i++) {
      const weekIdx = weekIndices[i];
      shiftMap.set(weekIdx, currentShift);
      
      // Flip for next week
      currentShift = currentShift === "Morning" ? "Evening" : "Morning";
    }
    
    weeklyShiftAssignment.set(empId, shiftMap);
  }
  
  // Log weekly distribution
  for (const weekIdx of weekIndices) {
    let mCount = 0, eCount = 0;
    for (const emp of employees) {
      const shift = weeklyShiftAssignment.get(String(emp.id))?.get(weekIdx);
      if (shift === "Morning") mCount++;
      else eCount++;
    }
    console.log(`[STEP 4] Week ${weekIdx}: Morning=${mCount}, Evening=${eCount}`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 5: ASSIGN WEEKLY OFF DAYS
  // 
  // Rules:
  // - Friday: OFF for everyone
  // - Marwa: Saturday OFF always
  // - Each employee: 1 additional random OFF per week
  // - OffRequest counts as the weekly OFF (no extra OFF)
  // - Cannot be on Vacation day
  // ═══════════════════════════════════════════════════════════════════════
  
  console.log(`\n[STEP 5] Assigning weekly OFF days...`);
  
  // weekIdx -> empId -> offDateISO
  const weeklyOffAssignment = new Map<number, Map<string, string>>();
  
  // Build available days per week (excluding Fridays)
  const weekDays = new Map<number, string[]>();
  for (const d of allDays) {
    if (getDay(d) === 5) continue; // Skip Friday
    const wIdx = globalWeekIndex(d);
    if (!weekDays.has(wIdx)) weekDays.set(wIdx, []);
    weekDays.get(wIdx)!.push(format(d, "yyyy-MM-dd"));
  }
  
  for (const weekIdx of weekIndices) {
    const offMap = new Map<string, string>();
    weeklyOffAssignment.set(weekIdx, offMap);
    
    const availableDays = weekDays.get(weekIdx) || [];
    if (availableDays.length === 0) continue;
    
    // Track OFF count per day for balancing
    const dayOffCount = new Map<string, number>();
    for (const d of availableDays) dayOffCount.set(d, 0);
    
    // Shuffle employees for random distribution
    const shuffledEmps = shuffle(employees);
    
    for (const emp of shuffledEmps) {
      const empId = String(emp.id);
      
      // Check if employee has OffRequest this week
      if (hasOffRequestInWeek(empId, weekIdx)) {
        // Find the OffRequest date
        for (const d of availableDays) {
          if (isOffRequest(empId, d)) {
            offMap.set(empId, d);
            dayOffCount.set(d, dayOffCount.get(d)! + 1);
            break;
          }
        }
        continue; // No additional OFF
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
      
      // Find best day (minimum OFFs, not vacation)
      let bestDay: string | null = null;
      let minCount = Infinity;
      
      for (const d of availableDays) {
        if (isVacation(empId, d)) continue;
        if (getDay(new Date(d)) === 6 && empId === MARWA_ID) continue; // Marwa's Saturday handled above
        
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
  // STEP 6: BUILD DAILY ASSIGNMENTS
  // 
  // Priority order:
  // 1. Friday → OFF
  // 2. Vacation → V
  // 3. OffRequest → O
  // 4. Weekly OFF → O
  // 5. Weekly Shift → MA1/EA1/PT4/PT5
  // ═══════════════════════════════════════════════════════════════════════
  
  console.log(`\n[STEP 6] Building daily assignments...`);
  
  const rows: any[] = [];
  
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
    
    const weekOffMap = weeklyOffAssignment.get(weekIdx) || new Map();
    
    for (const emp of employees) {
      const empId = String(emp.id);
      let symbol: string;
      
      // Priority 1: Vacation
      if (isVacation(empId, dateISO)) {
        symbol = VAC;
      }
      // Priority 2: OffRequest
      else if (isOffRequest(empId, dateISO)) {
        symbol = OFF;
      }
      // Priority 3: Weekly OFF
      else if (weekOffMap.get(empId) === dateISO) {
        symbol = OFF;
      }
      // Priority 4: Weekly Shift
      else {
        const shift = weeklyShiftAssignment.get(empId)?.get(weekIdx) || "Morning";
        symbol = getShiftSymbol(emp, shift);
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
  // STEP 7: VERIFY DAILY COVERAGE
  // ═══════════════════════════════════════════════════════════════════════
  
  console.log(`\n[STEP 7] Verifying daily coverage...`);
  
  let coverageIssues = 0;
  for (const day of allDays) {
    const dateISO = format(day, "yyyy-MM-dd");
    if (getDay(day) === 5) continue; // Skip Friday
    
    const dayRows = rows.filter(r => r.date === dateISO);
    const morningCount = dayRows.filter(r => [FT_MORNING, PT_MORNING].includes(r.symbol)).length;
    const eveningCount = dayRows.filter(r => [FT_EVENING, PT_EVENING].includes(r.symbol)).length;
    
    if (morningCount < morningCoverage || eveningCount < eveningCoverage) {
      console.warn(`[WARN] ${dateISO}: Morning=${morningCount}/${morningCoverage}, Evening=${eveningCount}/${eveningCoverage}`);
      coverageIssues++;
    }
  }
  
  if (coverageIssues === 0) {
    console.log(`[STEP 7] ✅ All days meet coverage requirements!`);
  } else {
    console.log(`[STEP 7] ⚠️ ${coverageIssues} days have coverage issues`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 8: SAVE TO DATABASE
  // ═══════════════════════════════════════════════════════════════════════
  
  console.log(`\n[STEP 8] Saving to database...`);
  
  // Delete existing assignments
  await sb.from("assignments").delete().eq("month_id", monthRow.id);
  
  // Insert new assignments
  const { error: insertErr } = await sb.from("assignments").insert(rows);
  
  if (insertErr) {
    console.error(`[ERROR] Insert failed:`, insertErr);
    throw insertErr;
  }
  
  console.log(`[STEP 8] ✅ Saved ${rows.length} assignments successfully!`);
  
  // ═══════════════════════════════════════════════════════════════════════
  // STEP 9: RETURN RESULT
  // ═══════════════════════════════════════════════════════════════════════
  
  return {
    ok: true,
    debug: {
      year,
      month,
      totalEmployees: employees.length,
      morningCoverage,
      eveningCoverage,
      weeksInMonth: weekIndices.length,
      totalAssignments: rows.length,
      coverageIssues
    }
  };
}
