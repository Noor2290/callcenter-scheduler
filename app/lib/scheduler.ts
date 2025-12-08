// -----------------------------------------------------------
//  GENERATE SCHEDULE — FINAL VERSION (Hospital-Grade)
//  Weekly fixed shifts: Week Morning → Week Evening → repeat
//  OFF once per week, VAC overrides, coverage auto-fix
//  CONTINUOUS WEEKS: weekIndex is global across months
// -----------------------------------------------------------

import {
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  format,
  getDay,
  startOfWeek,
  differenceInWeeks
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
// Base date: 2020-01-04 (first Saturday of 2020)
// -----------------------------------------------------------
const EPOCH_SATURDAY = new Date(2020, 0, 4); // Jan 4, 2020 = Saturday

function globalWeekIndex(date: Date): number {
  // Get the Saturday of the week containing this date
  const dow = getDay(date); // 0=Sun, 6=Sat
  const daysFromSat = (dow + 1) % 7; // Saturday=0, Sun=1, Mon=2...
  const weekStart = new Date(date);
  weekStart.setDate(date.getDate() - daysFromSat);
  weekStart.setHours(0, 0, 0, 0);
  
  // Calculate weeks since epoch
  const diffMs = weekStart.getTime() - EPOCH_SATURDAY.getTime();
  return Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
}

// -----------------------------------------------------------
// Pick FT/PT symbols
// -----------------------------------------------------------
function symbolForShift(emp: any, shift: "Morning" | "Evening") {
  if (emp.employment_type === "PartTime") {
    return shift === "Morning" ? PT_M : PT_E;
  }
  return shift === "Morning" ? FT_M : FT_E;
}

// -----------------------------------------------------------
// Determine shift from symbol
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

  // Load month row
  const { data: monthRow, error: monthErr } = await sb
    .from("months")
    .upsert({ year, month }, { onConflict: "year,month" })
    .select("*")
    .single();
  
  if (monthErr || !monthRow) {
    throw new Error(monthErr?.message || "Failed to create month row");
  }

  // Employees
  const { data: empData } = await sb
    .from("employees")
    .select("*")
    .order("name", { ascending: true });
  const employees = empData || [];

  // Load settings
  const { data: settings } = await sb.from("settings").select("*");
  const map = Object.fromEntries((settings || []).map((s: any) => [s.key, s.value]));
  const coverageMorning = Number(map.coverageMorning) || 5;
  const coverageEvening = Number(map.coverageEvening) || 6;

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

  const isVacation = (id: string, iso: string) =>
    vacationMap.has(id) && vacationMap.get(id)!.has(iso);

  // -----------------------------------------------------------
  // LOAD PREVIOUS MONTH'S LAST WEEK SHIFTS
  // -----------------------------------------------------------
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  
  // Get last day of previous month
  const lastDayPrevMonth = endOfMonth(new Date(prevYear, prevMonth - 1, 1));
  const prevWeekIdx = globalWeekIndex(lastDayPrevMonth);
  
  // Load previous month's assignments for the last week
  const { data: prevMonthRow } = await sb
    .from("months")
    .select("id")
    .eq("year", prevYear)
    .eq("month", prevMonth)
    .single();
  
  // Map: empId -> last shift in previous month
  const prevShiftMap = new Map<string, "Morning" | "Evening">();
  
  if (prevMonthRow) {
    const { data: prevAssigns } = await sb
      .from("assignments")
      .select("employee_id, date, symbol")
      .eq("month_id", prevMonthRow.id)
      .order("date", { ascending: false });
    
    // Get the last working shift for each employee
    for (const a of prevAssigns || []) {
      const empId = String(a.employee_id);
      if (prevShiftMap.has(empId)) continue; // already got their last shift
      
      const shift = shiftFromSymbol(a.symbol);
      if (shift) {
        prevShiftMap.set(empId, shift);
      }
    }
  }
  
  // -----------------------------------------------------------
  // DETERMINE BASE SHIFT FOR FIRST WEEK
  // If previous month exists, flip the shift for continuity
  // -----------------------------------------------------------
  const firstDayOfMonth = startOfMonth(new Date(year, month - 1, 1));
  const firstWeekIdx = globalWeekIndex(firstDayOfMonth);
  
  // Check if first day is in same week as last day of prev month
  const sameWeekAsPrev = firstWeekIdx === prevWeekIdx;
  
  // Build employee shift map for this month
  // empId -> globalWeekIdx -> shift
  const empWeekShift = new Map<string, Map<number, "Morning" | "Evening">>();
  
  for (const emp of employees) {
    const empId = String(emp.id);
    const weekMap = new Map<number, "Morning" | "Evening">();
    
    // If we have previous month data
    if (prevShiftMap.has(empId)) {
      const prevShift = prevShiftMap.get(empId)!;
      
      if (sameWeekAsPrev) {
        // Same week continues - keep same shift
        weekMap.set(firstWeekIdx, prevShift);
      } else {
        // New week - flip the shift
        weekMap.set(firstWeekIdx, prevShift === "Morning" ? "Evening" : "Morning");
      }
    }
    
    empWeekShift.set(empId, weekMap);
  }
  
  // Function to get shift for employee in a given week
  const getWeeklyShift = (empId: string, empIndex: number, weekIdx: number): "Morning" | "Evening" => {
    const weekMap = empWeekShift.get(empId);
    
    if (weekMap && weekMap.has(weekIdx)) {
      return weekMap.get(weekIdx)!;
    }
    
    // Check previous week
    if (weekMap && weekMap.has(weekIdx - 1)) {
      const prevWeekShift = weekMap.get(weekIdx - 1)!;
      const newShift = prevWeekShift === "Morning" ? "Evening" : "Morning";
      weekMap.set(weekIdx, newShift);
      return newShift;
    }
    
    // No previous data - use alternating based on employee index and week
    const shift = (empIndex + weekIdx) % 2 === 0 ? "Morning" : "Evening";
    if (weekMap) weekMap.set(weekIdx, shift);
    return shift;
  };

  // Prepare dates
  const start = startOfMonth(new Date(year, month - 1, 1));
  const end = endOfMonth(start);
  const days = eachDayOfInterval({ start, end });

  // -----------------------------------------------------------
  // WEEKLY OFF ASSIGNMENT
  // -----------------------------------------------------------
  const weeklyOff = new Map<number, Map<string, string>>();

  for (const d of days) {
    const wIdx = globalWeekIndex(d);
    if (!weeklyOff.has(wIdx)) weeklyOff.set(wIdx, new Map());
  }

  // Assign Fridays OFF
  for (const d of days) {
    const dow = getDay(d);
    const iso = format(d, "yyyy-MM-dd");
    const wIdx = globalWeekIndex(d);

    if (dow === 5) {
      employees.forEach((e) => weeklyOff.get(wIdx)!.set(String(e.id), iso));
      continue;
    }
  }

  // Build weekday groups (excluding Friday)
  const weekGroups = new Map<number, string[]>();
  for (const d of days) {
    const dow = getDay(d);
    if (dow === 5) continue;

    const wIdx = globalWeekIndex(d);
    if (!weekGroups.has(wIdx)) weekGroups.set(wIdx, []);
    weekGroups.get(wIdx)!.push(format(d, "yyyy-MM-dd"));
  }

  // Assign OFF weekly
  for (const [wIdx, dayList] of weekGroups) {
    const offMap = weeklyOff.get(wIdx)!;
    const counters = new Map(dayList.map((d) => [d, 0]));

    for (const emp of employees) {
      const id = String(emp.id);

      // Marwa OFF always Saturday
      if (id === MARWA_ID) {
        const sat = dayList.find((d) => getDay(new Date(d)) === 6);
        if (sat) {
          offMap.set(id, sat);
          counters.set(sat, counters.get(sat)! + 1);
          continue;
        }
      }

      // Pick day with least OFF assignments
      let bestDay = null;
      let best = Infinity;

      for (const d of dayList) {
        const c = counters.get(d)!;
        if (c < best) {
          best = c;
          bestDay = d;
        }
      }

      offMap.set(id, bestDay!);
      counters.set(bestDay!, counters.get(bestDay!)! + 1);
    }
  }

  // -----------------------------------------------------------
  // BUILD ASSIGNMENTS
  // -----------------------------------------------------------
  const rows: any[] = [];

  for (const day of days) {
    const iso = format(day, "yyyy-MM-dd");
    const dow = getDay(day);
    const wIdx = globalWeekIndex(day);

    const offMap = weeklyOff.get(wIdx)!;

    // Friday OFF for all
    if (dow === 5) {
      employees.forEach((e) =>
        rows.push({
          month_id: monthRow.id,
          employee_id: e.id,
          date: iso,
          symbol: OFF,
          code: OFF
        })
      );
      continue;
    }

    // OFF + VAC sets
    const offSet = new Set(
      [...offMap.entries()]
        .filter(([_, d]) => d === iso)
        .map(([id]) => id)
    );

    const available = employees.filter((e, idx) => {
      const id = String(e.id);
      if (offSet.has(id)) return false;
      if (isVacation(id, iso)) return false;
      return true;
    });

    // Weekly shift base assignment
    let morning: any[] = [];
    let evening: any[] = [];

    employees.forEach((emp, i) => {
      const id = String(emp.id);
      if (offSet.has(id) || isVacation(id, iso)) return;

      const shift = getWeeklyShift(id, i, wIdx);
      if (shift === "Morning") morning.push(emp);
      else evening.push(emp);
    });

    // Coverage fix
    while (morning.length < coverageMorning && evening.length > 0) {
      morning.push(evening.shift());
    }

    while (morning.length > coverageMorning) {
      evening.unshift(morning.pop());
    }

    const morningSet = new Set(morning.map((e) => String(e.id)));

    // Write rows
    for (const emp of employees) {
      const id = String(emp.id);
      let symbol = "";

      if (isVacation(id, iso)) {
        symbol = VAC;
      } else if (offSet.has(id)) {
        symbol = OFF;
      } else {
        const shift = morningSet.has(id) ? "Morning" : "Evening";
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

  // Save assignments
  await sb.from("assignments").delete().eq("month_id", monthRow.id);
  await sb.from("assignments").insert(rows);

  return { 
    ok: true,
    debug: {
      totalEmployees: employees.length,
      coverageMorning,
      coverageEvening,
      vacationDaysLoaded: (reqs || []).length
    }
  };
}
