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

function baseWeekShift(weekIdx: number): ShiftName {
  return weekIdx % 2 === 0 ? 'Morning' : 'Evening';
}

function symbolFor(empType: EmploymentType, shift: ShiftName): string {
  return SHIFT_SYMBOL[empType][shift];
}

export async function generateSchedule(opts: { year: number; month: number; useBetween?: boolean; seed?: string | number }) {
  const { year, month, useBetween = false, seed } = opts;
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

  const days = eachDayOfInterval({ start, end });
  type Cell = { symbol: string; shift?: ShiftName; offCountWeek?: number; offSource?: 'friday' | 'request' | 'random' | 'trim' };
  const grid = new Map<string, Map<string, Cell>>(); // empId -> (dateISO -> Cell)

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

  for (const [wIdx, wDays] of weeks) {
    const base = baseWeekShift(wIdx);
    // Global balancing per week: how many extra offs assigned per weekday (0=Sun..6=Sat)
    const weekOffCountByWeekday = new Map<number, number>();
    // Pre-count OffRequest inside the week (exclude Friday) so we avoid clustering
    for (const emp of emps) {
      for (const d of wDays) {
        if (isFriday(d)) continue;
        const c = grid.get(emp.id)!.get(dateISO(d));
        if (c?.offSource === 'request') {
          const wd = getDay(d);
          weekOffCountByWeekday.set(wd, (weekOffCountByWeekday.get(wd) ?? 0) + 1);
        }
      }
    }
    for (const emp of emps) {
      if (!empOffDayHist.has(emp.id)) empOffDayHist.set(emp.id, new Map());
      // Determine weekly shift considering history and allowed_shifts
      const history = empWeekShiftHistory.get(emp.id) ?? [];
      // Respect a single allowed shift (manual pinning)
      let chosen: ShiftName = base;
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

      // Compute suggested extra off day if allowed
      let extraOffDayISO: string | null = null;
      if (!hasVacation) {
        if (hasOffRequest) {
          extraOffDayISO = null; // already consumed by OffRequest
        } else if (FIXED_RULES.randomWeeklyOff) {
          // Build candidate days: Sat..Thu (exclude Friday)
          const candidates = wDays.filter((d) => getDay(d) !== 5);
          if (candidates.length > 0) {
            const hist = empOffDayHist.get(emp.id)!;
            const preferred = (emp.preferred_days_off ?? []).filter((pd) => pd !== 'Friday');
            const preferredIdx = new Set(preferred);
            const dayName = (d: Date) => ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][getDay(d)];

            // Score each candidate using monthly per-employee history + weekly global count + small RNG
            type Scored = { d: Date; wd: number; score: number };
            const scored: Scored[] = candidates.map((d) => {
              const wd = getDay(d);
              const empHist = hist.get(wd) ?? 0; // month history for this weekday
              const weekBal = weekOffCountByWeekday.get(wd) ?? 0; // how many offs already on this weekday this week
              const prefBonus = preferredIdx.size > 0 ? (preferredIdx.has(dayName(d)) ? -0.25 : 0) : 0; // slight bias only
              // Increase randomness and introduce per-employee-week jitter so offs don't cluster
              const jitter = (rng() + rng(String(emp.id + '-' + wIdx))) * 0.25;
              // weight monthly history more to avoid repetition for same employee; also distribute across the week
              const score = empHist * 2 + weekBal * 1 + jitter + prefBonus;
              return { d, wd, score };
            });
            scored.sort((a, b) => a.score - b.score);
            const pick = scored[0].d;
            extraOffDayISO = dateISO(pick);
            // record in history and week balancing
            const wd = scored[0].wd;
            hist.set(wd, (hist.get(wd) ?? 0) + 1);
            weekOffCountByWeekday.set(wd, (weekOffCountByWeekday.get(wd) ?? 0) + 1);
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
          grid.get(emp.id)!.set(iso, { symbol: SPECIAL_SYMBOL.Off, offSource: 'random' });
          continue;
        }
        grid.get(emp.id)!.set(iso, { symbol: symbolFor(emp.employment_type, chosen), shift: chosen });
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

    // Helper: monthly load count to balance
    const empWorkload = new Map<string, number>();
    for (const emp of emps) {
      let cnt = 0;
      for (const dd of days) {
        const c = grid.get(emp.id)!.get(dateISO(dd))!;
        if (c.symbol && c.symbol !== SPECIAL_SYMBOL.Off && c.symbol !== SPECIAL_SYMBOL.Vacation) cnt += 1;
      }
      empWorkload.set(emp.id, cnt);
    }

    // Fill shortages first
    const assignShift = (shift: ShiftName, need: number) => {
      if (need <= 0) return;
      // candidates are available (not V), allowed for shift, and currently O or empty or other shift if useBetween allows
      const candidates = empCells
        .filter(({ emp, cell }) => cell.symbol !== SPECIAL_SYMBOL.Vacation)
        .filter(({ emp, cell }) => emp.allowed_shifts.includes(shift))
        .filter(({ cell }) => {
          if (!cell.symbol || cell.symbol === SPECIAL_SYMBOL.Off) return true;
          if (useBetween) return true; // allow per-day switching when enabled
          // when disabled, we'll still consider opposite-shift candidates but we will flip their whole week below
          return true;
        })
        .sort((a, b) => (empWorkload.get(a.emp.id)! - empWorkload.get(b.emp.id)!));

      // helper to flip entire week assignment for an employee to target shift
      const flipWeek = (empId: string, anyDateInWeek: Date, toShift: ShiftName) => {
        const wIdx = getWeekIndex(anyDateInWeek);
        const wDays = weeks.get(wIdx) || [];
        for (const wd of wDays) {
          if (isFriday(wd)) continue;
          const ciso = dateISO(wd);
          const c = grid.get(empId)!.get(ciso)!;
          if (c.symbol === SPECIAL_SYMBOL.Off || c.symbol === SPECIAL_SYMBOL.Vacation) continue;
          c.symbol = symbolFor(emps.find(e=>e.id===empId)!.employment_type, toShift);
          c.shift = toShift;
        }
      };

      for (const cand of candidates) {
        if (need <= 0) break;
        const current = cand.cell;
        if (current.symbol === SPECIAL_SYMBOL.Vacation) continue;
        // Ensure weekly off max (Friday + 1) — we cannot count easily here; rely on generation step to keep <=1 extra off.
        if (!current.symbol || current.symbol === SPECIAL_SYMBOL.Off || current.shift === shift || useBetween) {
          current.symbol = symbolFor(cand.emp.employment_type, shift);
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
        need -= 1;
      }
    };

    if (targetM > 0 && mCount < targetM) assignShift('Morning', targetM - mCount);
    if (targetE > 0 && eCount < targetE) assignShift('Evening', targetE - eCount);

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

    // Trim excess by converting to O if above target and respecting weekly off limits (Friday + one extra only)
    const trimShift = (shift: ShiftName, excess: number) => {
      if (excess <= 0) return;
      const candidates = empCells
        .filter(({ cell }) => cell.shift === shift)
        .sort((a, b) => (empWorkload.get(b.emp.id)! - empWorkload.get(a.emp.id)!)); // trim highest load first
      for (const cand of candidates) {
        if (excess <= 0) break;
        // Enforce: max one extra off per week (Friday already counted separately)
        const currentExtraOffs = getWeekExtraOffCount(cand.emp.id, d);
        if (currentExtraOffs >= 1) continue; // skip; would violate weekly off rule
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
