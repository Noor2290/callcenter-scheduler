import seedrandom from 'seedrandom';
import {
  addDays,
  eachDayOfInterval,
  endOfMonth,
  format,
  getDay,
  isFriday,
  startOfMonth,
} from 'date-fns';
import supabaseServer from '@/app/lib/supabaseServer';
import { FIXED_RULES, SHIFT_SYMBOL, SPECIAL_SYMBOL, type EmploymentType, type ShiftName } from '@/app/lib/constants';

export type EmployeeRow = {
  id: string;
  code: string | null;
  name: string;
  employment_type: EmploymentType;
  allowed_shifts: ShiftName[];
  preferred_days_off: string[] | null;
};

export type RequestRow = {
  id: string;
  employee_id: string;
  date: string; // YYYY-MM-DD
  type: 'Vacation' | 'OffRequest';
};

function weekIndexFromSaturday(date: Date): number {
  // Stable week index where week starts on Saturday (Sa..Fr)
  // Compute the Saturday of the week for `date` and for the month start, then diff in weeks.
  const first = startOfMonth(date);
  const toSaturdayOffset = (d: Date) => {
    const dow = getDay(d); // 0=Su..6=Sa
    // How many days to subtract to reach Saturday of the same week
    return (dow + 1) % 7; // Su->1, Mo->2, ..., Sa->0
  };
  const weekStartFor = (d: Date) => addDays(d, -toSaturdayOffset(d));
  const baseWeekStart = weekStartFor(first);
  const curWeekStart = weekStartFor(date);
  const diffDays = Math.floor((curWeekStart.getTime() - baseWeekStart.getTime()) / (24 * 3600 * 1000));
  return Math.floor(diffDays / 7);
}

function baseWeekShift(weekIdx: number, invert: boolean = false): ShiftName {
  const baseShift = weekIdx % 2 === 0 ? 'Morning' : 'Evening';
  return invert ? (baseShift === 'Morning' ? 'Evening' : 'Morning') : baseShift;
}

function symbolFor(empType: EmploymentType, shift: ShiftName): string {
  return SHIFT_SYMBOL[empType][shift];
}

export async function generateSchedule(opts: { year: number; month: number; useBetween?: boolean; seed?: string | number; invertFirstWeek?: boolean }) {
  const { year, month, useBetween = false, seed, invertFirstWeek = false } = opts;
  const sb = supabaseServer();

  const rngSeed = (seed ?? FIXED_RULES.seed) + `-${year}-${month}`;
  const rng = seedrandom(String(rngSeed));

  // Ensure month row
  const { data: monthRow, error: monthErr } = await sb
    .from('months')
    .upsert({ year, month, seed: FIXED_RULES.seed }, { onConflict: 'year,month' })
    .select('*')
    .single();
  if (monthErr) throw monthErr;

  // Load employees
  const { data: employees, error: empErr } = await sb
    .from('employees')
    .select('id, code, name, employment_type, allowed_shifts, preferred_days_off')
    .order('name', { ascending: true });
  if (empErr) throw empErr;
  const emps = ((employees ?? []) as EmployeeRow[]).map((e) => ({
    ...e,
    // Normalize missing/empty allowed_shifts to both Morning & Evening so no one is starved of shifts
    allowed_shifts: (e.allowed_shifts && e.allowed_shifts.length > 0) ? e.allowed_shifts : (['Morning','Evening'] as any),
  }));

  // Load requests for this month
  const start = startOfMonth(new Date(year, month - 1, 1));
  const end = endOfMonth(start);
  const { data: reqs, error: reqErr } = await sb
    .from('requests')
    .select('id, employee_id, date, type')
    .gte('date', format(start, 'yyyy-MM-dd'))
    .lte('date', format(end, 'yyyy-MM-dd'));
  if (reqErr) throw reqErr;
  const requests = (reqs ?? []) as RequestRow[];

  // Load dynamic settings (coverage)
  const { data: settingsRows } = await sb.from('settings').select('key,value');
  const settingsMap = Object.fromEntries((settingsRows ?? []).map((r: any) => [r.key, r.value]));
  const coverageMorning = settingsMap.coverageMorning ? Number(settingsMap.coverageMorning) : 0;
  const coverageEvening = settingsMap.coverageEvening ? Number(settingsMap.coverageEvening) : 0;
  // Between-shift controls from settings (UI)
  // useBetween can also be passed via opts; treat settings as default and opts as override/enabler
  const settingsUseBetweenRaw = settingsMap.useBetween;
  const settingsUseBetween = typeof settingsUseBetweenRaw === 'string'
    ? settingsUseBetweenRaw.toLowerCase() === 'true' || settingsUseBetweenRaw === '1'
    : Boolean(settingsUseBetweenRaw);
  const useBetweenEffective = useBetween || settingsUseBetween;
  const betweenEmployeeId: string | undefined = settingsMap.betweenEmployeeId || settingsMap.betweenEmpId || undefined;

  const days = eachDayOfInterval({ start, end });
  type Cell = { symbol: string; shift?: ShiftName; offCountWeek?: number; offSource?: 'friday' | 'request' | 'random' | 'trim' };
  const grid = new Map<string, Map<string, Cell>>(); // empId -> (dateISO -> Cell)

  // Count current OFF (non-Friday) on a specific date across all employees
  const countOffOnDate = (isoDate: string) => {
    let cnt = 0;
    for (const emp of emps) {
      const c = grid.get(emp.id)?.get(isoDate);
      if (c?.symbol === SPECIAL_SYMBOL.Off) cnt += 1;
    }
    return cnt;
  };

  // Pick a fixed weekly symbol variant based on employment type, shift, and week index
  const weeklySymbol = (empType: EmploymentType, shift: ShiftName, weekIdx: number): string => {
    if (empType === 'FullTime') {
      if (shift === 'Morning') {
        const variants = ['MA1','MA2','MA4'];
        return variants[weekIdx % variants.length];
      } else {
        const variants = ['EA1','E2','E5'];
        return variants[weekIdx % variants.length];
      }
    }
    // PartTime and Trainee keep existing mapping
    return SHIFT_SYMBOL[empType][shift];
  };

  // Helper to get week-of-month index (Sat-Thu)
  const weekIndexCache = new Map<string, number>();
  const dateISO = (d: Date) => format(d, 'yyyy-MM-dd');

  // Prepare preferred days map and requests map
  const reqByEmpDate = new Map<string, 'Vacation' | 'OffRequest'>();
  for (const r of requests) {
    reqByEmpDate.set(`${r.employee_id}|${r.date}`, r.type);
  }

  // Track last two week shifts per employee to prevent 3 in a row
  const empWeekShiftHistory = new Map<string, ShiftName[]>();

  for (const emp of emps) {
    const row = new Map<string, Cell>();
    grid.set(emp.id, row);

    // initialize Friday off, apply requests
    for (const d of days) {
      const iso = dateISO(d);
      if (isFriday(d) && FIXED_RULES.fridayOff) {
        row.set(iso, { symbol: SPECIAL_SYMBOL.Off, offSource: 'friday' });
        continue;
      }
      const req = reqByEmpDate.get(`${emp.id}|${iso}`);
      if (req === 'Vacation') {
        row.set(iso, { symbol: SPECIAL_SYMBOL.Vacation });
        continue;
      }
      if (req === 'OffRequest') {
        row.set(iso, { symbol: SPECIAL_SYMBOL.Off, offSource: 'request' });
        continue;
      }
      row.set(iso, { symbol: '' });
    }

  }

  // Split by weeks and assign weekly block shifts + random weekly off
  // week: Sat..Thu
  const getWeekIndex = (d: Date) => {
    const iso = dateISO(d);
    const cached = weekIndexCache.get(iso);
    if (cached !== undefined) return cached;
    const idx = weekIndexFromSaturday(d);
    weekIndexCache.set(iso, idx);
    return idx;
  };

  const weeks = new Map<number, Date[]>();
  for (const d of days) {
    const idx = getWeekIndex(d);
    if (!weeks.has(idx)) weeks.set(idx, []);
    weeks.get(idx)!.push(d);
  }

  // Track off-day distribution per weekday for fairness (per employee, across the whole month)
  // weekday key uses JS getDay(): 0=Sun..6=Sat; Friday=5
  const empOffDayHist = new Map<string, Map<number, number>>();

  // Per-employee phase to randomize weekly base shift parity
  const empPhase = new Map<string, number>();
  for (const e of emps) empPhase.set(e.id, rng(String('phase-' + e.id)) < 0.5 ? 0 : 1);

  for (const [wIdx, wDays] of weeks) {
    // إذا كان هذا هو الأسبوع الأول وكان invertFirstWeek = true، نقوم بعكس الوردية
    const shouldInvert = invertFirstWeek && wIdx === 0;
    const base = baseWeekShift(wIdx, shouldInvert);
    // Global balancing per week: track OFF load per day (non-Friday) and build a guaranteed extra-off plan
    const weekOffCountByWeekday = new Map<number, number>();
    const nonFridayDays = wDays.filter((d) => !isFriday(d));
    // initialize counts with OffRequest already marked
    for (const emp of emps) {
      for (const d of nonFridayDays) {
        const c = grid.get(emp.id)!.get(dateISO(d));
        if (c?.offSource === 'request') {
          const wd = getDay(d);
          weekOffCountByWeekday.set(wd, (weekOffCountByWeekday.get(wd) ?? 0) + 1);
        }
      }
    }
    // Build a per-week plan: each eligible employee gets one extra OFF day
    // Pass 1: حد أقصى 1 أوف مخطط لكل يوم لتجنّب تشبّع أيام الأسبوع مبكراً
    // Pass 2: توزيع الباقي مع السماح حتى 2 في اليوم
    const weekExtraOffPlan = new Map<string, string>(); // empId -> iso date
    const eligibleEmps = emps
      .filter((emp) => {
        // skip if any Vacation in this week
        const hasVacation = wDays.some((d) => (grid.get(emp.id)!.get(dateISO(d))?.symbol === SPECIAL_SYMBOL.Vacation));
        if (hasVacation) return false;
        // skip if any OffRequest in this week
        const hasOffReq = wDays.some((d) => grid.get(emp.id)!.get(dateISO(d))?.offSource === 'request');
        return !hasOffReq;
      });
    // Randomize employees order to avoid grouping
    const shuffledEmps = eligibleEmps
      .map((e) => ({ e, r: rng(String('w' + wIdx + '-' + e.id)) }))
      .sort((a, b) => a.r - b.r)
      .map((x) => x.e);
    // Randomize weekday order per week
    const weekdayOrder = nonFridayDays
      .map((d) => ({ d, r: rng(String('wd' + wIdx + '-' + d.toISOString())) }))
      .sort((a, b) => a.r - b.r)
      .map((x) => x.d);
    let dayPtr = 0;
    const leftovers: typeof shuffledEmps = [];
    const tryAssignWithCap = (empsList: typeof shuffledEmps, perDayCap: number) => {
      for (const emp of empsList) {
        if (weekExtraOffPlan.has(emp.id)) continue;
        let assigned: string | null = null;
        // Prefer the day with the lowest current weekly OFF load
        const orderedByLoad = [...weekdayOrder].sort((a, b) => (weekOffCountByWeekday.get(getDay(a)) ?? 0) - (weekOffCountByWeekday.get(getDay(b)) ?? 0));
        for (let k = 0; k < orderedByLoad.length; k++) {
          const d = orderedByLoad[(dayPtr + k) % orderedByLoad.length];
          const iso = dateISO(d);
          const wd = getDay(d);
          // respect global daily cap 2 and per-week per-day cap
          const c = grid.get(emp.id)!.get(iso)!;
          if (c.symbol === '' && countOffOnDate(iso) < 2 && (weekOffCountByWeekday.get(wd) ?? 0) < perDayCap) {
            assigned = iso;
            weekOffCountByWeekday.set(wd, (weekOffCountByWeekday.get(wd) ?? 0) + 1);
            break;
          }
        }
        if (assigned) {
          weekExtraOffPlan.set(emp.id, assigned);
          dayPtr = (dayPtr + 1) % Math.max(1, weekdayOrder.length);
        } else {
          leftovers.push(emp);
        }
      }
    };
    // Pass 1: allow max 1 per weekday
    tryAssignWithCap(shuffledEmps, 1);
    // Pass 2: assign leftovers allowing up to 2 per weekday
    if (leftovers.length > 0) {
      tryAssignWithCap(leftovers, 2);
    }
    for (const emp of emps) {
      if (!empOffDayHist.has(emp.id)) empOffDayHist.set(emp.id, new Map());
      // Determine weekly shift considering history and allowed_shifts
      const history = empWeekShiftHistory.get(emp.id) ?? [];
      // Respect a single allowed shift (manual pinning)
      // Randomized weekly choice with bias نحو التناوب لتفادي تجمّع مجموعات ثابتة
      let chosen: ShiftName;
      const last = history[history.length - 1];
      const coin = rng(String('wk' + wIdx + '-' + emp.id));
      if (history.length >= 2 && history.slice(-2).every((s) => s === 'Morning')) {
        chosen = 'Evening';
      } else if (history.length >= 2 && history.slice(-2).every((s) => s === 'Evening')) {
        chosen = 'Morning';
      } else if (last) {
        // 60% نغيّر الشفت عن الأسبوع الماضي، 40% نبقيه
        chosen = coin < 0.6 ? (last === 'Morning' ? 'Evening' : 'Morning') : last;
      } else {
        chosen = coin < 0.5 ? 'Morning' : 'Evening';
      }
      if ((emp.allowed_shifts?.length ?? 0) === 1) {
        chosen = emp.allowed_shifts[0];
      }
      if (!emp.allowed_shifts.includes(chosen)) {
        // choose the other one if allowed
        const alt: ShiftName = chosen === 'Morning' ? 'Evening' : 'Morning';
        if (emp.allowed_shifts.includes(alt)) chosen = alt;
      }
      if (history.length >= 2 && history.slice(-2).every((s) => s === chosen)) {
        // flip to avoid >2 consecutive
        chosen = chosen === 'Morning' ? 'Evening' : 'Morning';
        // still must respect allowed
        if (!emp.allowed_shifts.includes(chosen)) {
          // fallback: keep original if both disallowed, leave empty (only fill coverage later)
          chosen = base;
        }
      }
      history.push(chosen);
      empWeekShiftHistory.set(emp.id, history);

      // Does week contain any Vacation for this employee?
      const hasVacation = wDays.some((d) => (grid.get(emp.id)!.get(dateISO(d))?.symbol === SPECIAL_SYMBOL.Vacation));
      // Is there OffRequest inside week? (exclude Friday, check source)
      const hasOffRequest = wDays.some((d) => {
        if (isFriday(d)) return false;
        const cell = grid.get(emp.id)!.get(dateISO(d));
        return cell?.offSource === 'request';
      });

      // Compute suggested extra off day if allowed (use precomputed weekly plan)
      let extraOffDayISO: string | null = null;
      if (!hasVacation) {
        if (hasOffRequest) {
          extraOffDayISO = null; // already consumed by OffRequest
        } else if (FIXED_RULES.randomWeeklyOff) {
          extraOffDayISO = weekExtraOffPlan.get(emp.id) ?? null;
          if (extraOffDayISO) {
            const d = new Date(extraOffDayISO);
            const wd = getDay(d);
            const hist = empOffDayHist.get(emp.id)!;
            hist.set(wd, (hist.get(wd) ?? 0) + 1);
          }
        }
      }

      // Fill the week with chosen shift except: Vacation, OffRequest, Friday, extraOff
      for (const d of wDays) {
        const iso = dateISO(d);
        const cell = grid.get(emp.id)!.get(iso)!;
        if (cell.symbol === SPECIAL_SYMBOL.Vacation || cell.symbol === SPECIAL_SYMBOL.Off) continue;
        if (isFriday(d)) continue;
        if (extraOffDayISO && iso === extraOffDayISO) {
          // Respect daily OFF cap (max 2, excluding Friday)
          if (countOffOnDate(iso) < 2) {
            grid.get(emp.id)!.set(iso, { symbol: SPECIAL_SYMBOL.Off, offSource: 'random' });
          }
          continue;
        }
        const wIdxLocal = getWeekIndex(d);
        const sym = weeklySymbol(emp.employment_type, chosen, wIdxLocal);
        grid.get(emp.id)!.set(iso, { symbol: sym, shift: chosen });
      }

      // Safety guard: ensure at least ONE working day in this week for the employee if possible
      // (avoid cases where an employee ends up with only Off/Vacation due to requests or trimming later)
      const nonFridayWorkableDays = wDays.filter((d) => !isFriday(d));
      const hasAnyWork = nonFridayWorkableDays.some((d) => {
        const c = grid.get(emp.id)!.get(dateISO(d))!;
        return c.symbol && c.symbol !== SPECIAL_SYMBOL.Off && c.symbol !== SPECIAL_SYMBOL.Vacation;
      });
      if (!hasAnyWork) {
        // pick the earliest non-request, non-vacation, non-Friday day and assign chosen shift
        for (const d of nonFridayWorkableDays) {
          const iso = dateISO(d);
          const c = grid.get(emp.id)!.get(iso)!;
          if (c.symbol === '' || c.symbol === SPECIAL_SYMBOL.Off) {
            grid.get(emp.id)!.set(iso, { symbol: symbolFor(emp.employment_type, chosen), shift: chosen });
            break;
          }
        }
      }
    }
  }

  // Precompute monthly workload (number of working days per employee) once for fairness heuristics
  const empWorkload = new Map<string, number>();
  for (const emp of emps) {
    let cnt = 0;
    for (const dd of days) {
      const c = grid.get(emp.id)!.get(dateISO(dd))!;
      if (c.symbol && c.symbol !== SPECIAL_SYMBOL.Off && c.symbol !== SPECIAL_SYMBOL.Vacation) cnt += 1;
    }
    empWorkload.set(emp.id, cnt);
  }

  // Coverage balancing per day
  for (const d of days) {
    const iso = dateISO(d);
    if (isFriday(d)) continue; // already off

    // Collect current state
    type EmpDay = { emp: EmployeeRow; cell: Cell };
    const empCells: EmpDay[] = emps.map((e) => ({ emp: e, cell: grid.get(e.id)!.get(iso)! }));

    const countBy = (shift: ShiftName) => empCells.filter((ed) => ed.cell.shift === shift).length;
    let mCount = countBy('Morning');
    let eCount = countBy('Evening');

    const targetM = coverageMorning || 0;
    const targetE = coverageEvening || 0;

    // Helper to count current extra off (non-Friday) for an employee in a given week
    const getWeekExtraOffCount = (empId: string, anyDateInWeek: Date) => {
      const wIdx = getWeekIndex(anyDateInWeek);
      const wDays = weeks.get(wIdx) || [];
      let cnt = 0;
      for (const wd of wDays) {
        if (isFriday(wd)) continue;
        const c = grid.get(empId)!.get(dateISO(wd))!;
        if (c.symbol === SPECIAL_SYMBOL.Off) cnt += 1;
      }
      return cnt;
    };

    // Helper to flip entire week assignment for an employee to target shift (usable by assign/trim)
    const flipWeek = (empId: string, anyDateInWeek: Date, toShift: ShiftName) => {
      const wIdx = getWeekIndex(anyDateInWeek);
      const wDays = weeks.get(wIdx) || [];
      for (const wd of wDays) {
        if (isFriday(wd)) continue;
        const ciso = dateISO(wd);
        const c = grid.get(empId)!.get(ciso)!;
        if (c.symbol === SPECIAL_SYMBOL.Off || c.symbol === SPECIAL_SYMBOL.Vacation) continue;
        const empType = emps.find(e=>e.id===empId)!.employment_type;
        c.symbol = weeklySymbol(empType, toShift, wIdx);
        c.shift = toShift;
      }
    };

    // Fill shortages first
    const assignShift = (shift: ShiftName, need: number) => {
      if (need <= 0) return;
      // helper: detect employee's weekly shift for the week of date d
      const getEmpWeekShift = (empId: string, anyDateInWeek: Date): ShiftName | undefined => {
        const wIdx = getWeekIndex(anyDateInWeek);
        const wDays = weeks.get(wIdx) || [];
        for (const wd of wDays) {
          if (isFriday(wd)) continue;
          const c = grid.get(empId)!.get(dateISO(wd))!;
          if (c.shift) return c.shift;
        }
        return undefined;
      };

      // Early direct assignment for the designated between-shift employee (single-day switch, no week flip)
      if (useBetweenEffective && betweenEmployeeId && need > 0) {
        const ed = empCells.find(x => x.emp.id === betweenEmployeeId);
        if (ed && ed.cell.symbol !== SPECIAL_SYMBOL.Vacation && ed.cell.offSource !== 'request') {
          // bypass allowed_shifts for the designated employee
          if (ed.cell.shift !== shift || !ed.cell.symbol || ed.cell.symbol === SPECIAL_SYMBOL.Off) {
            const wIdxForAssign = getWeekIndex(d);
            ed.cell.symbol = weeklySymbol(ed.emp.employment_type, shift, wIdxForAssign);
            ed.cell.shift = shift;
            need -= 1;
          }
        }
      }
      // candidates are available (not V), allowed for shift, and currently O or empty or other shift if useBetween allows
      let candidates = empCells
        .filter(({ emp, cell }) => cell.symbol !== SPECIAL_SYMBOL.Vacation)
        .filter(({ emp, cell }) => emp.allowed_shifts.includes(shift) || useBetweenEffective)
        .filter(({ cell }) => {
          // exclude Off that came from an explicit request
          if (cell.symbol === SPECIAL_SYMBOL.Off && cell.offSource === 'request') return false;
          if (!cell.symbol || cell.symbol === SPECIAL_SYMBOL.Off) return true;
          if (useBetweenEffective) return true; // allow per-day switching when enabled (for all employees)
          // when disabled, we'll still consider opposite-shift candidates but we will flip their whole week below
          return true;
        })
        .map(ed => ({ ...ed, weekShift: getEmpWeekShift(ed.emp.id, d) }))
        // keep only employees whose weekly shift equals the target to preserve weekly stability,
        // except the designated between-shift employee when enabled
        .filter((ed: any) => (useBetweenEffective) || ed.weekShift === shift)
        .sort((a: any, b: any) => {
          // hard priority: between-shift employee first when enabled
          if (useBetweenEffective && betweenEmployeeId) {
            const aIs = a.emp.id === betweenEmployeeId ? 1 : 0;
            const bIs = b.emp.id === betweenEmployeeId ? 1 : 0;
            if (aIs !== bIs) return bIs - aIs;
          }
          // priority: empty first, then Off that won't remove the only weekly extra off, ثم يوم عمل
          const canUseOff = (ed: any) => ed.cell.symbol === SPECIAL_SYMBOL.Off && ed.cell.offSource !== 'request' && getWeekExtraOffCount(ed.emp.id, d) > 1;
          const rank = (ed: any) => {
            if (!ed.cell.symbol) return 0; // empty
            if (canUseOff(ed)) return 1; // off but not the only one this week
            return 2; // working day
          };
          const ra = rank(a), rb = rank(b);
          if (ra !== rb) return ra - rb;
          return (empWorkload.get(a.emp.id)! - empWorkload.get(b.emp.id)!);
        });

      // (last-resort) flipping is available via outer flipWeek

      // If no suitable candidates found, fall back to flipping a full week for fairness
      if (candidates.length === 0) {
        const opp = empCells.filter(({ emp, cell }) => emp.allowed_shifts.includes(shift) && cell.symbol !== SPECIAL_SYMBOL.Vacation);
        for (const cand of opp) {
          if (need <= 0) break;
          // avoid flipping the designated between-shift employee if enabled, unless last resort
          if (useBetweenEffective && betweenEmployeeId && cand.emp.id === betweenEmployeeId) continue;
          flipWeek(cand.emp.id, d, shift);
          need -= 1;
        }
        return;
      }

      for (const cand of candidates as any) {
        if (need <= 0) break;
        const current = cand.cell;
        if (current.symbol === SPECIAL_SYMBOL.Vacation) continue;
        // Ensure weekly off max (Friday + 1) — we cannot count easily here; rely on generation step to keep <=1 extra off.
        if (!current.symbol || current.symbol === SPECIAL_SYMBOL.Off || current.shift === shift) {
          const wIdxForAssign = getWeekIndex(d);
          current.symbol = weeklySymbol(cand.emp.employment_type, shift, wIdxForAssign);
          current.shift = shift;
        } else {
          // If between is enabled and this is the designated employee, switch the single day without flipping the whole week
          if (useBetweenEffective && betweenEmployeeId && cand.emp.id === betweenEmployeeId) {
            const wIdxForAssign = getWeekIndex(d);
            current.symbol = weeklySymbol(cand.emp.employment_type, shift, wIdxForAssign);
            current.shift = shift;
          } else {
            // per-day between is disabled and candidate is on opposite shift; flip full week to preserve weekly-block rule
            const opposite: ShiftName = current.shift === 'Morning' ? 'Evening' : 'Morning';
            if (opposite !== shift) {
              // should not happen
            } else {
              flipWeek(cand.emp.id, d, shift);
            }
          }
        }
        need -= 1;
      }

      // If still short, flip additional employees' weeks from the opposite shift until target is met
      if (need > 0) {
        const oppPool = empCells
          .filter(({ emp, cell }) => emp.allowed_shifts.includes(shift))
          .filter(({ cell }) => cell.symbol !== SPECIAL_SYMBOL.Vacation)
          .map(ed => ({ ...ed, weekShift: getEmpWeekShift(ed.emp.id, d) }))
          .filter((ed: any) => ed.weekShift && ed.weekShift !== shift);
        // prefer lower workload to keep fairness
        oppPool.sort((a: any, b: any) => (empWorkload.get(a.emp.id)! - empWorkload.get(b.emp.id)!));
        for (const ed of oppPool) {
          if (need <= 0) break;
          // skip days where the cell is Off due to request
          if (ed.cell.symbol === SPECIAL_SYMBOL.Off && ed.cell.offSource === 'request') continue;
          // avoid flipping the designated between-shift employee if enabled, unless last resort
          if (useBetweenEffective && betweenEmployeeId && ed.emp.id === betweenEmployeeId) continue;
          flipWeek(ed.emp.id, d, shift);
          need -= 1;
        }
      }
    };

    if (targetM > 0 && mCount < targetM) assignShift('Morning', targetM - mCount);
    if (targetE > 0 && eCount < targetE) assignShift('Evening', targetE - eCount);

    // Trim excess by converting to O if above target and respecting weekly off limits (Friday + one extra only)
    const trimShift = (shift: ShiftName, excess: number) => {
      if (excess <= 0) return;
      const candidates = empCells
        .filter(({ emp, cell }) => cell.shift === shift)
        .sort((a, b) => (empWorkload.get(b.emp.id)! - empWorkload.get(a.emp.id)!)); // trim highest load first
      for (const cand of candidates) {
        if (excess <= 0) break;
        // Enforce: max one extra off per week (Friday already counted separately)
        const currentExtraOffs = getWeekExtraOffCount(cand.emp.id, d);
        // Prefer not to violate weekly off rule; we'll try alternate action below if blocked
        // Respect daily OFF cap (<=2 per day, excluding Friday)
        const isoDay = iso;
        if (countOffOnDate(isoDay) >= 2 || currentExtraOffs >= 1) {
          // Fallback: flip to opposite shift if that shift still needs coverage
          const opposite: ShiftName = shift === 'Morning' ? 'Evening' : 'Morning';
          const curM = countBy('Morning');
          const curE = countBy('Evening');
          const needOpp = opposite === 'Morning' ? (targetM - curM) : (targetE - curE);
          if (needOpp > 0) {
            // avoid OffRequest/Vacation and preserve weekly stability via full-week flip
            if (cand.cell.symbol !== SPECIAL_SYMBOL.Vacation && cand.cell.offSource !== 'request') {
              flipWeek(cand.emp.id, d, opposite);
              excess -= 1; // one slot removed from current shift
              continue;
            }
          }
          // if no room on opposite shift, skip and try next candidate
          continue;
        }
        cand.cell.symbol = SPECIAL_SYMBOL.Off;
        cand.cell.shift = undefined;
        cand.cell.offSource = 'trim';
        excess -= 1;
      }
    };

    mCount = countBy('Morning');
    eCount = countBy('Evening');
    if (targetM > 0 && mCount > targetM) trimShift('Morning', mCount - targetM);
    if (targetE > 0 && eCount > targetE) trimShift('Evening', eCount - targetE);

    // Final enforcement: strictly clamp day counts to targets when possible
    mCount = countBy('Morning');
    eCount = countBy('Evening');
    let safeguard = 0;
    while (safeguard++ < 20) {
      if (targetM && targetE) {
        // Case 1: Evening over, Morning under -> flip one E->M
        if (eCount > targetE && mCount < targetM) {
          const pool = empCells
            .filter(({ emp, cell }) => cell.shift === 'Evening' && emp.allowed_shifts.includes('Morning'))
            .filter(({ cell }) => cell.symbol !== SPECIAL_SYMBOL.Vacation && cell.offSource !== 'request');
          if (pool.length === 0) break;
          pool.sort((a, b) => (empWorkload.get(a.emp.id)! - empWorkload.get(b.emp.id)!));
          flipWeek(pool[0].emp.id, d, 'Morning');
        }
        // Case 2: Evening over, Morning equals target -> try make one Evening Off (respect caps if possible)
        else if (eCount > targetE && mCount === targetM) {
          const pool = empCells
            .filter(({ emp, cell }) => cell.shift === 'Evening')
            .filter(({ cell }) => cell.symbol !== SPECIAL_SYMBOL.Vacation && cell.offSource !== 'request');
          if (pool.length === 0) break;
          pool.sort((a, b) => (empWorkload.get(b.emp.id)! - empWorkload.get(a.emp.id)!));
          const pick = pool[0];
          const canOffToday = countOffOnDate(iso) < 2;
          const wOff = getWeekExtraOffCount(pick.emp.id, d);
          if (canOffToday && wOff < 1) {
            pick.cell.symbol = SPECIAL_SYMBOL.Off;
            pick.cell.shift = undefined;
            pick.cell.offSource = 'trim';
          } else if (canOffToday) {
            // last resort: allow extra weekly off to enforce target
            pick.cell.symbol = SPECIAL_SYMBOL.Off;
            pick.cell.shift = undefined;
            pick.cell.offSource = 'trim';
          } else {
            // if off cap reached, break to avoid infinite loop
            break;
          }
        }
        // Case 3: Evening over, Morning over -> make one Morning Off then flip one Evening->Morning
        else if (eCount > targetE && mCount > targetM) {
          const mPool = empCells
            .filter(({ emp, cell }) => cell.shift === 'Morning')
            .filter(({ cell }) => cell.symbol !== SPECIAL_SYMBOL.Vacation && cell.offSource !== 'request');
          const ePool = empCells
            .filter(({ emp, cell }) => cell.shift === 'Evening' && emp.allowed_shifts.includes('Morning'))
            .filter(({ cell }) => cell.symbol !== SPECIAL_SYMBOL.Vacation && cell.offSource !== 'request');
          if (mPool.length === 0 || ePool.length === 0) break;
          const canOffToday = countOffOnDate(iso) < 2;
          if (!canOffToday) break;
          mPool.sort((a, b) => (empWorkload.get(b.emp.id)! - empWorkload.get(a.emp.id)!));
          const mPick = mPool[0];
          mPick.cell.symbol = SPECIAL_SYMBOL.Off;
          mPick.cell.shift = undefined;
          mPick.cell.offSource = 'trim';
          ePool.sort((a, b) => (empWorkload.get(a.emp.id)! - empWorkload.get(b.emp.id)!));
          flipWeek(ePool[0].emp.id, d, 'Morning');
        }
        // Mirror for Morning over target
        else if (mCount > targetM && eCount < targetE) {
          const pool = empCells
            .filter(({ emp, cell }) => cell.shift === 'Morning' && emp.allowed_shifts.includes('Evening'))
            .filter(({ cell }) => cell.symbol !== SPECIAL_SYMBOL.Vacation && cell.offSource !== 'request');
          if (pool.length === 0) break;
          pool.sort((a, b) => (empWorkload.get(a.emp.id)! - empWorkload.get(b.emp.id)!));
          flipWeek(pool[0].emp.id, d, 'Evening');
        } else if (mCount > targetM && eCount === targetE) {
          const pool = empCells
            .filter(({ emp, cell }) => cell.shift === 'Morning')
            .filter(({ cell }) => cell.symbol !== SPECIAL_SYMBOL.Vacation && cell.offSource !== 'request');
          if (pool.length === 0) break;
          const canOffToday = countOffOnDate(iso) < 2;
          if (!canOffToday) break;
          pool.sort((a, b) => (empWorkload.get(b.emp.id)! - empWorkload.get(a.emp.id)!));
          const pick = pool[0];
          pick.cell.symbol = SPECIAL_SYMBOL.Off;
          pick.cell.shift = undefined;
          pick.cell.offSource = 'trim';
        } else if (mCount > targetM && eCount > targetE) {
          const ePool = empCells
            .filter(({ emp, cell }) => cell.shift === 'Evening')
            .filter(({ cell }) => cell.symbol !== SPECIAL_SYMBOL.Vacation && cell.offSource !== 'request');
          const mPool = empCells
            .filter(({ emp, cell }) => cell.shift === 'Morning' && emp.allowed_shifts.includes('Evening'))
            .filter(({ cell }) => cell.symbol !== SPECIAL_SYMBOL.Vacation && cell.offSource !== 'request');
          if (ePool.length === 0 || mPool.length === 0) break;
          const canOffToday = countOffOnDate(iso) < 2;
          if (!canOffToday) break;
          ePool.sort((a, b) => (empWorkload.get(b.emp.id)! - empWorkload.get(a.emp.id)!));
          const ePick = ePool[0];
          ePick.cell.symbol = SPECIAL_SYMBOL.Off;
          ePick.cell.shift = undefined;
          ePick.cell.offSource = 'trim';
          mPool.sort((a, b) => (empWorkload.get(a.emp.id)! - empWorkload.get(b.emp.id)!));
          flipWeek(mPool[0].emp.id, d, 'Evening');
        } else {
          break;
        }
      } else {
        break;
      }
      // refresh counts after each flip
      mCount = countBy('Morning');
      eCount = countBy('Evening');
    }
  }

  // Persist assignments for the month
  const rows: { month_id: string; employee_id: string; date: string; symbol: string; code: string }[] = [];
  for (const emp of emps) {
    for (const d of days) {
      const iso = dateISO(d);
      const cell = grid.get(emp.id)!.get(iso)!;
      const sym = cell.symbol || SPECIAL_SYMBOL.Off; // default empty to Off
      rows.push({ month_id: monthRow.id, employee_id: emp.id, date: iso, symbol: sym, code: sym });
    }
  }

  // Clear existing month entries and insert fresh
  await sb.from('assignments').delete().eq('month_id', monthRow.id);
  if (rows.length > 0) {
    const { error: insErr } = await sb.from('assignments').insert(rows);
    if (insErr) throw insErr;
  }

  return { ok: true };
}
