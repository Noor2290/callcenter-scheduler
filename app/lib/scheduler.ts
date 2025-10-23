/// app/lib/scheduler.ts
import seedrandom from 'seedrandom';
import {
  eachDayOfInterval,
  endOfMonth,
  format,
  isFriday,
  startOfMonth,
} from 'date-fns';
import supabaseServer from '@/app/lib/supabaseServer';
import { FIXED_RULES, SHIFT_SYMBOL, SPECIAL_SYMBOL } from '@/app/lib/constants';

/**
 * 🎯 POLICY NOTE: Fair & Random Shift Distribution Priority
 *
 * هذا النظام يركز على "عدالة التوزيع الأسبوعي والشهري" بين الموظفات
 * وليس على التغطية اليومية الدقيقة (coverageMorning / coverageEvening).
 *
 * ✅ الهدف:
 * - توزيع عادل وعشوائي مضبوط بالبذرة بين الشفتات Morning / Evening.
 * - مرور كل موظفة على الشفتين بشكل متوازن (مثلًا: أسبوعين صباح + أسبوعين مساء).
 * - احترام allowed_shifts، الإجازات (Vacation)، وطلبات الأوف (OffRequest).
 *
 * ⚠️ ما لا يهم:
 * - قد يحدث نقص أو زيادة في عدد العاملات في بعض الأيام،
 *   وهذا لا يعتبر مشكلة طالما العدالة العامة محفوظة عبر الشهر.
 *
 * 🧩 المنطق المستخدم:
 * - ثبات الشفت داخل الأسبوع (كل موظفة نفس الشفت طوال الأسبوع).
 * - تناوب أسبوعي أو كل أسبوعين بين Morning و Evening.
 * - اختيار الكتل الأسبوعية (1 أو 2) عشوائي لكنه مستقر بالبذرة.
 * - لا إعادة موازنة يومية ولا تصحيح تغطية.
 *
 * ✅ النتيجة:
 * جدول عادل، متوازن، بسيط، ويحافظ على منطق العمل البشري الواقعي
 * حتى لو وُجدت فروقات بسيطة في التغطية اليومية.
 */

// ======= Local minimal types
type EmploymentType = 'FullTime' | 'PartTime' | 'Trainee';
type ShiftName = 'Morning' | 'Evening';
type EmployeeRow = {
  id: string;
  code: string | null;
  name: string;
  employment_type: EmploymentType;
  allowed_shifts?: ShiftName[];
};
type RequestRow = {
  id: string;
  employee_id: string;
  date: string; // 'yyyy-MM-dd'
  type: 'Vacation' | 'OffRequest';
};

type Cell = {
  symbol: string;
  shift?: ShiftName | 'Between';
};

export async function generateSchedule(opts: {
  year: number; // 4-digit
  month: number; // 1..12
  useBetween?: boolean; // optional override
  seed?: string | number;
  invertFirstWeek?: boolean; // optional: invert starting week's shift compared to previous month
}) {
  const { year, month } = opts;
  const sb = supabaseServer();

  // ===== RNG (stable per (seed,year,month))
  const rngSeed = `${opts.seed ?? FIXED_RULES.seed}-${year}-${month}`;
  const rng = seedrandom(String(rngSeed));

  const timings: Record<string, number> = {};
  const tick = (label: string, t0: number) => {
    timings[label] = (timings[label] ?? 0) + (Date.now() - t0);
  };

  // Hard policy overrides
  const ALWAYS_EVENING_IDS = new Set<string>([]); // use DB ids here if needed
  const ALWAYS_EVENING_CODES = new Set<string>(['3979']); // Tooq Almalki (employee code)
  const isAlwaysEveningEmp = (e: EmployeeRow) =>
    ALWAYS_EVENING_IDS.has(e.id) || (e.code != null && ALWAYS_EVENING_CODES.has(String(e.code).trim()));

  const tAll = Date.now();
  console.log('▶️ generateSchedule:start', {
    ym: `${year}-${month}`,
    seed: String(opts.seed ?? FIXED_RULES.seed),
  });

  // ===== Month row
  let t = Date.now();
  const { data: monthRow, error: monthErr } = await (sb as any)
    .from('months')
    .upsert({ year, month, seed: FIXED_RULES.seed }, { onConflict: 'year,month' })
    .select('*')
    .single();
  if (monthErr) throw monthErr;
  tick('monthRow', t);

  // ===== Employees
  t = Date.now();
  const { data: employees, error: empErr } = await sb
    .from('employees')
    .select('id, code, name, employment_type, allowed_shifts, preferred_days_off')
    .order('name', { ascending: true });
  if (empErr) throw empErr;

  const emps: EmployeeRow[] = ((employees ?? []) as any[]).map((e: any) => ({
    ...e,
    allowed_shifts:
      e.allowed_shifts && e.allowed_shifts.length > 0
        ? e.allowed_shifts
        : (['Morning', 'Evening'] as ShiftName[]),
  }));
  const empMap = new Map<string, EmployeeRow>(emps.map((e) => [e.id, e]));
  tick('employees', t);

  // ===== Requests for month
  t = Date.now();
  const start = startOfMonth(new Date(year, month - 1, 1));
  const end = endOfMonth(start);
  const dateISO = (d: Date) => format(d, 'yyyy-MM-dd');

  const { data: reqs, error: reqErr } = await sb
    .from('requests')
    .select('id, employee_id, date, type')
    .gte('date', dateISO(start))
    .lte('date', dateISO(end));
  if (reqErr) throw reqErr;

  const requests: RequestRow[] = (reqs ?? []) as any;
  const reqMap = new Map<string, RequestRow>();
  for (const r of requests) reqMap.set(`${r.employee_id}|${r.date}`, r);
  tick('requests', t);

  // ===== Settings (dynamic)
  t = Date.now();
  const { data: settingsRows, error: settingsErr } = await sb
    .from('settings')
    .select('key,value');
  if (settingsErr) throw settingsErr;

  const settingsMap: Record<string, any> = Object.fromEntries(
    (settingsRows ?? []).map((r: any) => [r.key, r.value]),
  );

  const coverageMorning =
    settingsMap.coverageMorning != null
      ? Number(settingsMap.coverageMorning)
      : 0;
  const coverageEvening =
    settingsMap.coverageEvening != null
      ? Number(settingsMap.coverageEvening)
      : 0;

  const settingsUseBetweenRaw =
    opts.useBetween ?? settingsMap.useBetween ?? settingsMap.useBetweenShift;
  const useBetweenEffective =
    typeof settingsUseBetweenRaw === 'string'
      ? ['true', '1', 'yes', 'y'].includes(settingsUseBetweenRaw.toLowerCase())
      : Boolean(settingsUseBetweenRaw);

  const betweenEmployeeId: string | undefined =
    settingsMap.betweenShiftEmployeeId || // new key from SettingsForm/API
    settingsMap.betweenEmployeeId || // legacy key
    settingsMap.betweenEmpId || // older legacy alias
    undefined;

  // Optional special OFF policy: force Saturday OFF for a specific employee
  const saturdayOffEmployeeId: string | undefined =
    settingsMap.saturdayOffEmployeeId || undefined;

  // Resolve effective Saturday-OFF employee id (by id setting or by name fallback 'Marwa/مروة')
  const saturdayOffEmpIdEffective: string | undefined =
    saturdayOffEmployeeId ||
    emps.find((e) => /marwa|مروة/i.test(e.name))?.id ||
    undefined;

  const BETWEEN_SYMBOL: string = (SPECIAL_SYMBOL as any).Between ?? 'M4A';
  tick('settings', t);

  // ===== Grid init
  const days = eachDayOfInterval({ start, end });
  const grid = new Map<string, Map<string, Cell>>();

  for (const emp of emps) {
    const row = new Map<string, Cell>();
    grid.set(emp.id, row);
    for (const d of days) {
      const iso = dateISO(d);
      const req = reqMap.get(`${emp.id}|${iso}`);
      if (req) {
        row.set(iso, {
          symbol:
            req.type === 'Vacation'
              ? SPECIAL_SYMBOL.Vacation
              : SPECIAL_SYMBOL.Off,
        });
      } else if (isFriday(d) && FIXED_RULES.fridayOff) {
        row.set(iso, { symbol: SPECIAL_SYMBOL.Off }); // الجمعة أوف ثابت
      } else {
        row.set(iso, { symbol: '' });
      }
    }

  }

  // ===== Weeks by calendar: week starts on Saturday, Friday is off
  const isSaturday = (d: Date) => d.getDay() === 6; // Sat
  const weeksMap = new Map<number, Date[]>();
  let wCounter = 0;
  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    if (isSaturday(d) && (weeksMap.get(wCounter)?.length || 0) > 0) {
      wCounter++;
    }
    if (!weeksMap.has(wCounter)) weeksMap.set(wCounter, []);
    weeksMap.get(wCounter)!.push(d);
  }

  

  
  const prevMonthDate = new Date(year, month - 2, 1);
  const prevStart = startOfMonth(prevMonthDate);
  const prevEnd = endOfMonth(prevStart);
  const prevDays = eachDayOfInterval({ start: prevStart, end: prevEnd });
  const prevWeeksMap = new Map<number, Date[]>();
  let pwCounter = 0;
  for (let i = 0; i < prevDays.length; i++) {
    const d = prevDays[i];
    if (isSaturday(d) && (prevWeeksMap.get(pwCounter)?.length || 0) > 0) {
      pwCounter++;
    }
    if (!prevWeeksMap.has(pwCounter)) prevWeeksMap.set(pwCounter, []);
    prevWeeksMap.get(pwCounter)!.push(d);
  }
  const prevWeekKeys = Array.from(prevWeeksMap.keys());
  const prevLastWeekKey = prevWeekKeys.length > 0 ? Math.max(...prevWeekKeys) : undefined;
  const prevLastWeekDays = prevLastWeekKey != null ? prevWeeksMap.get(prevLastWeekKey)!.filter((d) => !isFriday(d)) : [];

  let prevAssignRows: { employee_id: string; date: string; symbol: string }[] = [];
  // Always read previous month assignments for continuity across split weeks
  if (prevLastWeekDays.length > 0) {
    const { data: prevAssignData, error: prevAssignErr } = await (sb as any)
      .from('assignments')
      .select('employee_id,date,symbol')
      .gte('date', format(prevStart, 'yyyy-MM-dd'))
      .lte('date', format(prevEnd, 'yyyy-MM-dd'));
    if (prevAssignErr) throw prevAssignErr;
    prevAssignRows = (prevAssignData ?? []) as any[];
  }

  const prevAssignMap = new Map<string, Map<string, string>>();
  for (const r of prevAssignRows) {
    if (!prevAssignMap.has(r.employee_id)) prevAssignMap.set(r.employee_id, new Map());
    prevAssignMap.get(r.employee_id)!.set(r.date, r.symbol);
  }

  const prevLastWeekShift = new Map<string, ShiftName | undefined>();
  const prevLastWeekHadOff = new Map<string, boolean>();
  if (prevLastWeekDays.length > 0) {
    for (const e of emps) {
      const symMap = prevAssignMap.get(e.id);
      if (!symMap) { prevLastWeekShift.set(e.id, undefined); continue; }
      let mCnt = 0, eCnt = 0;
      let hadOff = false;
      for (const d of prevLastWeekDays) {
        const iso = format(d, 'yyyy-MM-dd');
        const sym = symMap.get(iso);
        if (!sym) continue;
        if (sym === SPECIAL_SYMBOL.Off) { hadOff = true; continue; }
        if (sym === SPECIAL_SYMBOL.Vacation) continue;
        const mCode = (SHIFT_SYMBOL as any)[e.employment_type]['Morning'];
        const eCode = (SHIFT_SYMBOL as any)[e.employment_type]['Evening'];
        if (sym === mCode) mCnt++;
        else if (sym === eCode) eCnt++;
      }
      const decided: ShiftName | undefined = mCnt > eCnt ? 'Morning' : eCnt > mCnt ? 'Evening' : undefined;
      prevLastWeekShift.set(e.id, decided);
      prevLastWeekHadOff.set(e.id, hadOff);
    }
  }

  // ===== History to avoid 3 consecutive weeks on same shift
  const weekHistory = new Map<string, ShiftName[]>(); // empId -> list of week shift

  // ===== Helpers
  const isProtected = (empId: string, iso: string) => {
    const req = reqMap.get(`${empId}|${iso}`);
    return req?.type === 'Vacation' || req?.type === 'OffRequest';
  };
  const isBetweenEmp = (empId: string) =>
    useBetweenEffective && !!betweenEmployeeId && empId === betweenEmployeeId;

  const countOffOnDate = (iso: string) => {
    let cnt = 0;
    for (const e of emps) {
      const c = grid.get(e.id)!.get(iso);
      if (c?.symbol === SPECIAL_SYMBOL.Off) cnt++;
    }
    return cnt;
  };

  // ===== Monthly quotas: aim for half Morning, half Evening per employee across the month's weeks
  const weeksCount = weeksMap.size;
  const remainingMorningWeeks = new Map<string, number>();
  const remainingEveningWeeks = new Map<string, number>();
  for (const e of emps) {
    const allowM = !e.allowed_shifts || e.allowed_shifts.includes('Morning');
    const allowE = !e.allowed_shifts || e.allowed_shifts.includes('Evening');
    let m = Math.floor(weeksCount / 2);
    let ev = weeksCount - m;
    if (isAlwaysEveningEmp(e)) { m = 0; ev = weeksCount; }
    if (!allowM && allowE) { m = 0; ev = weeksCount; }
    if (allowM && !allowE) { m = weeksCount; ev = 0; }
    remainingMorningWeeks.set(e.id, m);
    remainingEveningWeeks.set(e.id, ev);
  }

  // ======= Phase 1: Weekly random assignment (stable within week)
  for (const [w, wDaysFull] of weeksMap) {
    const workDays = wDaysFull.filter((d) => !isFriday(d)); // Friday already off
    const assignWeek = new Map<string, ShiftName>(); // empId -> Morning/Evening
    const weeklyOff = new Map<string, string>(); // empId -> ISO off day chosen
    const monthStart = startOfMonth(new Date(year, month - 1, 1));
    const isContinuingWeek = w === 0 && monthStart.getDay() !== 6; // not Saturday => continue last week's pattern

    const targetM = Math.max(0, Number(coverageMorning) || 0);
    const targetE = Math.max(0, Number(coverageEvening) || 0);

    // Exclude Between globally; we'll refine per-week pool below
    const activeEmps = emps.filter((e) => !isBetweenEmp(e.id));

    // Weekly effective targets
    // Between is an independent shift and does NOT reduce Evening coverage
    const betweenCount = useBetweenEffective && betweenEmployeeId ? 1 : 0;
    const desiredM = Math.max(0, targetM);
    const desiredEBase = Math.max(0, targetE);

    // Build a per-week active pool: exclude employees who are on Vacation for all workDays
    const isFullVacationWeek = (empId: string) => {
      return workDays.every((d) => reqMap.get(`${empId}|${dateISO(d)}`)?.type === 'Vacation');
    };
    const weekActiveEmps = activeEmps.filter((e) => !isFullVacationWeek(e.id));

    // For target sizing, ignore allowed_shifts so we don't undercount capacity.
    // We'll still respect special rules later (e.g., Tooq always Evening),
    // and rebalancing can override allowed_shifts if needed.
    const allowedMorningCount = weekActiveEmps
      .filter((e) => !isAlwaysEveningEmp(e)).length;
    const allowedEveningCount = weekActiveEmps.length;

    // Targets per week with capacity awareness:
    // If total capacity < desiredM + desiredE, prioritize Morning (business rule) and reduce Evening.
    const capacity = weekActiveEmps.length;
    const weekTargetM = Math.min(desiredM, capacity);
    const weekTargetE = Math.min(desiredEBase, Math.max(0, capacity - weekTargetM));
    const remainingCapacity = Math.max(0, capacity - weekTargetM);

    if (allowedMorningCount < desiredM || allowedEveningCount < desiredEBase) {
      const reasons: string[] = [];
      if (allowedMorningCount < desiredM) reasons.push(`allowedMorning=${allowedMorningCount} < desiredM=${desiredM} (STRICT overrides if needed)`);
      if (allowedEveningCount < desiredEBase) reasons.push(`allowedEvening=${allowedEveningCount} < desiredEBase=${desiredEBase} (STRICT overrides if needed)`);
      console.log(`[Week ${w}] targets adjusted:`, {
        requested: { morning: desiredM, evening: desiredEBase },
        betweenCount,
        allowed: { morning: allowedMorningCount, evening: allowedEveningCount },
        capacity,
        effective: { morning: weekTargetM, evening: weekTargetE },
        reasons,
      });
    }

    // Fairness counters
    const mWeeksSoFar = new Map<string, number>();
    const eWeeksSoFar = new Map<string, number>();
    for (const e of activeEmps) {
      const hist = weekHistory.get(e.id) || [];
      mWeeksSoFar.set(
        e.id,
        hist.reduce((a, h) => a + (h === 'Morning' ? 1 : 0), 0),
      );
      eWeeksSoFar.set(
        e.id,
        hist.reduce((a, h) => a + (h === 'Evening' ? 1 : 0), 0),
      );
    }

    const canTake = (e: EmployeeRow, s: ShiftName) => {
      if (e.allowed_shifts && !e.allowed_shifts.includes(s)) return false;
      if (isAlwaysEveningEmp(e) && s !== 'Evening') return false;
      const hist = weekHistory.get(e.id) || [];
      const last1 = hist[hist.length - 1];
      const last2 = hist[hist.length - 2];
      if (last1 === s && last2 === s) return false; // avoid 3 same in a row
      if (w === 0) {
        const prevS = prevLastWeekShift.get(e.id);
        // Policy: next month starts as the inverse of last saved week
        const mustBe: ShiftName | undefined = isAlwaysEveningEmp(e)
          ? 'Evening'
          : (prevS
          ? (prevS === 'Morning' ? 'Evening' : 'Morning')
          : undefined);
        if (mustBe && s !== mustBe) return false;
      }
      // must have remaining quota for this shift this month
      if (s === 'Morning' && (remainingMorningWeeks.get(e.id) || 0) <= 0) return false;
      if (s === 'Evening' && (remainingEveningWeeks.get(e.id) || 0) <= 0) return false;
      return true;
    };

    let morningSet = new Set<string>();
    let eveningSet = new Set<string>();

    if (w === 0) {
      // Week 0: if the month continues a previous week, seed sets by keeping same shifts
      morningSet = new Set<string>();
      eveningSet = new Set<string>();

      if (isContinuingWeek) {
        const keepMorning = weekActiveEmps
          .filter((e) => prevLastWeekShift.get(e.id) === 'Morning')
          .map((e, i) => ({ e, r: rng(`cont-m-${w}-${e.id}-${i}`) }))
          .sort((a, b) => a.r - b.r)
          .map((x) => x.e);
        for (const e of keepMorning) {
          if (morningSet.size >= weekTargetM) break;
          morningSet.add(e.id);
        }
        const keepEvening = weekActiveEmps
          .filter((e) => prevLastWeekShift.get(e.id) === 'Evening' && !morningSet.has(e.id))
          .map((e, i) => ({ e, r: rng(`cont-e-${w}-${e.id}-${i}`) }))
          .sort((a, b) => a.r - b.r)
          .map((x) => x.e);
        for (const e of keepEvening) {
          if (eveningSet.size >= weekTargetE) break;
          eveningSet.add(e.id);
        }
      }

      // Fill remaining slots randomly (respecting quotas history via canTake)
      if (morningSet.size < weekTargetM) {
        const morningCandidates = weekActiveEmps
          .filter((e) => !morningSet.has(e.id) && !eveningSet.has(e.id) && canTake(e, 'Morning'))
          .map((e) => ({ e, r: rng(`wk-m-${w}-${e.id}`) }))
          .sort((a, b) => a.r - b.r)
          .map((x) => x.e);
        for (const e of morningCandidates) {
          if (morningSet.size >= weekTargetM) break;
          morningSet.add(e.id);
        }
      }
      if (eveningSet.size < weekTargetE) {
        const eveningCandidates = weekActiveEmps
          .filter((e) => !morningSet.has(e.id) && !eveningSet.has(e.id) && canTake(e, 'Evening'))
          .map((e) => ({ e, r: rng(`wk-e-${w}-${e.id}`) }))
          .sort((a, b) => a.r - b.r)
          .map((x) => x.e);
        for (const e of eveningCandidates) {
          if (eveningSet.size >= weekTargetE) break;
          eveningSet.add(e.id);
        }
      }

      const notAssigned = weekActiveEmps.filter(
        (e) => !morningSet.has(e.id) && !eveningSet.has(e.id),
      );
      for (const e of notAssigned) {
        const allowM = !e.allowed_shifts || e.allowed_shifts.includes('Morning');
        const allowE = !e.allowed_shifts || e.allowed_shifts.includes('Evening');
        if (morningSet.size < weekTargetM && allowM) {
          morningSet.add(e.id);
          continue;
        }
        if (eveningSet.size < weekTargetE && allowE) {
          eveningSet.add(e.id);
          continue;
        }
      }

      const stillUnassigned = weekActiveEmps.filter(
        (e) => !morningSet.has(e.id) && !eveningSet.has(e.id),
      );
      for (const e of stillUnassigned) {
        const allowM = !e.allowed_shifts || e.allowed_shifts.includes('Morning');
        const allowE = !e.allowed_shifts || e.allowed_shifts.includes('Evening');
        if ((morningSet.size <= eveningSet.size && allowM) || !allowE) {
          morningSet.add(e.id);
        } else if (allowE) {
          eveningSet.add(e.id);
        }
      }

      const STRICT_WEEKLY = true;
      const canTakeLoose = (e: EmployeeRow, s: ShiftName) =>
        !e.allowed_shifts || e.allowed_shifts.includes(s);
      if (morningSet.size < weekTargetM) {
        const movable = weekActiveEmps
          .filter((e) => eveningSet.has(e.id))
          .filter((e) => !isAlwaysEveningEmp(e))
          .filter((e) => STRICT_WEEKLY || canTake(e, 'Morning') || canTakeLoose(e, 'Morning'))
          .map((e, i) => ({ e, r: rng(`mv-em-${w}-${e.id}-${i}`) }))
          .sort((a, b) => a.r - b.r);
        for (const m of movable) {
          if (morningSet.size >= weekTargetM) break;
          eveningSet.delete(m.e.id);
          morningSet.add(m.e.id);
        }
      }

      // Final guard for week 0: ensure always-evening employees are not in morningSet
      for (const e of weekActiveEmps) {
        if (isAlwaysEveningEmp(e)) {
          if (morningSet.has(e.id)) morningSet.delete(e.id);
          eveningSet.add(e.id);
        }
      }
    } else {
      // Weeks > 0: per-employee block pattern (1-week or 2-week blocks), seeded and stable per (emp,year,month)
      morningSet = new Set<string>();
      eveningSet = new Set<string>();
      const desiredByEmp = new Map<string, ShiftName>();
      for (const e of weekActiveEmps) {
        const hist = weekHistory.get(e.id) || [];
        const last1 = hist[hist.length - 1];
        const last2 = hist[hist.length - 2];
        // Fixed block length: 1 week per shift (alternate every week)
        const blockLen = 1;

        // Count current streak length of last1
        let streak = 1;
        for (let i = hist.length - 2; i >= 0; i--) {
          if (hist[i] === last1) streak++; else break;
        }

        // Base desired: stay same until streak reaches blockLen (1), then switch
        let desired: ShiftName = last1 === 'Morning' ? 'Morning' : 'Evening';
        if (isAlwaysEveningEmp(e)) desired = 'Evening';
        if (streak >= blockLen) desired = last1 === 'Morning' ? 'Evening' : 'Morning';

        // Enforce no 3 in a row
        if (last1 && last2 && last1 === last2 && desired === last1) {
          desired = last1 === 'Morning' ? 'Evening' : 'Morning';
        }

        // Respect allowed_shifts
        const allowDesired = !e.allowed_shifts || e.allowed_shifts.includes(desired);
        if (!allowDesired) {
          const other: ShiftName = desired === 'Morning' ? 'Evening' : 'Morning';
          if (!e.allowed_shifts || e.allowed_shifts.includes(other)) {
            desired = other;
          }
        }

        desiredByEmp.set(e.id, desired);
        if (desired === 'Morning') morningSet.add(e.id); else eveningSet.add(e.id);
      }

      // Rebalance to hit targets exactly (respect allowed_shifts)
      const allow = (e: EmployeeRow, s: ShiftName) => {
        if (isAlwaysEveningEmp(e) && s === 'Morning') return false;
        return true; // STRICT otherwise
      };

      // If Morning exceeds target, move some to Evening (prefer those whose desired is Evening)
      if (morningSet.size > weekTargetM) {
        let surplus = weekActiveEmps
          .filter((e) => morningSet.has(e.id) && allow(e, 'Evening') && desiredByEmp.get(e.id) === 'Evening')
          .map((e, i) => ({ e, r: rng(`rb-me-pref-${w}-${e.id}-${i}`) }))
          .sort((a, b) => a.r - b.r);
        if (surplus.length === 0) {
          surplus = weekActiveEmps
            .filter((e) => morningSet.has(e.id) && allow(e, 'Evening'))
            .map((e, i) => ({ e, r: rng(`rb-me-any-${w}-${e.id}-${i}`) }))
            .sort((a, b) => a.r - b.r);
        }
        for (const s of surplus) {
          if (morningSet.size <= weekTargetM) break;
          morningSet.delete(s.e.id);
          eveningSet.add(s.e.id);
        }
      }
      // If Evening exceeds target, move some to Morning (skip always-evening; prefer those whose desired is Morning)
      if (eveningSet.size > weekTargetE) {
        let surplus = weekActiveEmps
          .filter((e) => eveningSet.has(e.id) && allow(e, 'Morning') && desiredByEmp.get(e.id) === 'Morning')
          .map((e, i) => ({ e, r: rng(`rb-em-pref-${w}-${e.id}-${i}`) }))
          .sort((a, b) => a.r - b.r);
        if (surplus.length === 0) {
          surplus = weekActiveEmps
            .filter((e) => eveningSet.has(e.id) && allow(e, 'Morning'))
            .map((e, i) => ({ e, r: rng(`rb-em-any-${w}-${e.id}-${i}`) }))
            .sort((a, b) => a.r - b.r);
        }
        for (const s of surplus) {
          if (eveningSet.size <= weekTargetE) break;
          eveningSet.delete(s.e.id);
          morningSet.add(s.e.id);
        }
      }

      // If Morning still lacks, pull from Evening
      if (morningSet.size < weekTargetM) {
        const needed = weekTargetM - morningSet.size;
        const candidates = weekActiveEmps
          .filter((e) => eveningSet.has(e.id) && allow(e, 'Morning'))
          .map((e, i) => ({ e, r: rng(`rb-need-m-${w}-${e.id}-${i}`) }))
          .sort((a, b) => a.r - b.r)
          .slice(0, needed);
        for (const c of candidates) {
          eveningSet.delete(c.e.id);
          morningSet.add(c.e.id);
        }
      }
      // If Evening still lacks, pull from Morning
      if (eveningSet.size < weekTargetE) {
        const needed = weekTargetE - eveningSet.size;
        const candidates = weekActiveEmps
          .filter((e) => morningSet.has(e.id) && allow(e, 'Evening'))
          .map((e, i) => ({ e, r: rng(`rb-need-e-${w}-${e.id}-${i}`) }))
          .sort((a, b) => a.r - b.r)
          .slice(0, needed);
        for (const c of candidates) {
          morningSet.delete(c.e.id);
          eveningSet.add(c.e.id);
        }
      }

      // Final clamp: enforce exact targets by moving border employees with preference to their desired shift
      // Never move always-evening employees to Morning
      while (eveningSet.size > weekTargetE) {
        let candidate = weekActiveEmps.find((e) => eveningSet.has(e.id) && allow(e, 'Morning') && desiredByEmp.get(e.id) === 'Morning');
        if (!candidate) candidate = weekActiveEmps.find((e) => eveningSet.has(e.id) && allow(e, 'Morning'));
        if (!candidate) break;
        eveningSet.delete(candidate.id);
        morningSet.add(candidate.id);
      }
      while (morningSet.size > weekTargetM) {
        let candidate = weekActiveEmps.find((e) => morningSet.has(e.id) && allow(e, 'Evening') && desiredByEmp.get(e.id) === 'Evening');
        if (!candidate) candidate = weekActiveEmps.find((e) => morningSet.has(e.id) && allow(e, 'Evening'));
        if (!candidate) break;
        morningSet.delete(candidate.id);
        eveningSet.add(candidate.id);
      }

      // Final guard: ensure always-evening employees end up in eveningSet
      for (const e of weekActiveEmps) {
        if (isAlwaysEveningEmp(e)) {
          if (morningSet.has(e.id)) morningSet.delete(e.id);
          eveningSet.add(e.id);
        }
      }
    }

    // Apply weekly assignment to all workdays (initial fill; will be balanced later)
    const setWeek = (ids: Set<string>, s: ShiftName) => {
      for (const id of ids) {
        const emp = empMap.get(id)!;
        const sEff: ShiftName = isAlwaysEveningEmp(emp) ? 'Evening' : s;
        assignWeek.set(id, sEff);
        for (const d of workDays) {
          const iso = dateISO(d);
          const cell = grid.get(emp.id)!.get(iso)!;
          // Overwrite any non-protected day to enforce weekly stability
          if (cell.symbol !== SPECIAL_SYMBOL.Vacation && cell.symbol !== SPECIAL_SYMBOL.Off && !isProtected(emp.id, iso)) {
            cell.symbol = (SHIFT_SYMBOL as any)[emp.employment_type][sEff];
            cell.shift = sEff;
          }
        }
        const hist = weekHistory.get(id) || [];
        hist.push(sEff);
        weekHistory.set(id, hist);
        // decrement remaining monthly quota
        if (sEff === 'Morning') {
          remainingMorningWeeks.set(id, Math.max(0, (remainingMorningWeeks.get(id) || 0) - 1));
        } else {
          remainingEveningWeeks.set(id, Math.max(0, (remainingEveningWeeks.get(id) || 0) - 1));
        }
      }
    };
    setWeek(morningSet, 'Morning');
    setWeek(eveningSet, 'Evening');

    

    // ======= Weekly OFF rule:
    // - Exactly one OFF per employee per week (random day) unless:
    //    * OffRequest exists in this week -> that day is OFF; no extra OFF generated.
    //    * Any Vacation day in this week -> still give one OFF (unless OffRequest used it).
    // - Special policy: Saturday OFF is reserved ONLY for the designated employee.
    // - Cap preference: prefer days with fewer OFFs, but do not hard-block if none available.
    for (const e of emps) {
      const anyVacationThisWeek = workDays.some((d) => {
        const iso = dateISO(d);
        return reqMap.get(`${e.id}|${iso}`)?.type === 'Vacation';
      });

      // OffRequest has priority
      const offReqDate = workDays.find((d) => {
        const iso = dateISO(d);
        return reqMap.get(`${e.id}|${iso}`)?.type === 'OffRequest';
      });
      if (offReqDate) {
        const iso = dateISO(offReqDate);
        const cell = grid.get(e.id)!.get(iso)!;
        cell.symbol = SPECIAL_SYMBOL.Off;
        cell.shift = undefined;
        weeklyOff.set(e.id, iso);
        continue;
      }

      // Fixed Saturday OFF for the designated employee only
      if (saturdayOffEmpIdEffective && e.id === saturdayOffEmpIdEffective) {
        const sat = wDaysFull.find((d) => isSaturday(d));
        if (sat) {
          const iso = dateISO(sat);
          const cell = grid.get(e.id)!.get(iso)!;
          cell.symbol = SPECIAL_SYMBOL.Off;
          cell.shift = undefined;
          weeklyOff.set(e.id, iso);
          continue;
        }
      }

      // Helper to count active shift (excluding Off/Vacation and Between)
      const weeklyShift = assignWeek.get(e.id)!; // Morning/Evening for this week
      const targetForShift = weeklyShift === 'Morning' ? coverageMorning : coverageEvening;
      const countShiftOn = (iso: string, shift: ShiftName) => {
        return emps.filter((emp) => {
          if (isBetweenEmp(emp.id)) return false;
          const c = grid.get(emp.id)!.get(iso)!;
          if (c.symbol === SPECIAL_SYMBOL.Off || c.symbol === SPECIAL_SYMBOL.Vacation) return false;
          return c.shift === shift;
        }).length;
      };

      // Build candidate OFF days
      const candidateInfo = workDays
        .filter((d) => {
          const iso = dateISO(d);
          const c = grid.get(e.id)!.get(iso)!;
          if (c.symbol === SPECIAL_SYMBOL.Vacation) return false;
          if (isProtected(e.id, iso)) return false; // avoid OFF over protected day
          // Exclude Saturday for everyone except the designated employee
          if (!(saturdayOffEmpIdEffective && e.id === saturdayOffEmpIdEffective) && isSaturday(d)) return false;
          return true;
        })
        .map((d, i) => {
          const iso = dateISO(d);
          const current = countShiftOn(iso, weeklyShift);
          const margin = current - Number(targetForShift || 0);
          const offCount = countOffOnDate(iso);
          const preferred = offCount < 2; // prefer days still under the soft cap
          return { d, iso, margin, offCount, preferred, r: rng(`wk-off-bal-${w}-${e.id}-${i}`) };
        });

      // Strictly prefer days where this shift is above target so OFF won't drop below target
      let candidates = candidateInfo
        .filter((x) => x.margin > 0)
        .sort((a, b) => {
          if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
          if (b.margin !== a.margin) return b.margin - a.margin;
          if (a.offCount !== b.offCount) return a.offCount - b.offCount;
          return a.r - b.r;
        })
        .map((x) => x.d);

      // If none are above target, fall back to previous heuristic
      if (candidates.length === 0) {
        candidates = candidateInfo
          .sort((a, b) => {
            if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
            if (b.margin !== a.margin) return b.margin - a.margin;
            if (a.offCount !== b.offCount) return a.offCount - b.offCount;
            return a.r - b.r;
          })
          .map((x) => x.d);
      }

      // Pick the best candidate if any
      if (candidates.length > 0) {
        const iso = dateISO(candidates[0]);
        const cell = grid.get(e.id)!.get(iso)!;
        cell.symbol = SPECIAL_SYMBOL.Off;
        cell.shift = undefined;
        weeklyOff.set(e.id, iso);
      }
    }

    // ======= Phase 2: Enforce weekly shift only (no per-day balancing)
    for (const d of workDays) {
      const iso = dateISO(d);
      // Enforce weekly shift on every non-protected cell to guarantee stability
      for (const e of emps) {
        if (isBetweenEmp(e.id)) continue;
        if (weeklyOff.get(e.id) === iso) continue;
        const cell = grid.get(e.id)!.get(iso)!;
        if (cell.symbol === SPECIAL_SYMBOL.Vacation || cell.symbol === SPECIAL_SYMBOL.Off) continue;
        const weeklyShift = assignWeek.get(e.id);
        if (!weeklyShift) continue;
        const desired = (SHIFT_SYMBOL as any)[e.employment_type][weeklyShift];
        if (cell.symbol !== desired || cell.shift !== weeklyShift) {
          cell.symbol = desired;
          cell.shift = weeklyShift;
        }
      }
      // Assign Between (if enabled) — not counted toward Morning/Evening
      if (useBetweenEffective && betweenEmployeeId) {
        const be = empMap.get(betweenEmployeeId);
        if (be && !isProtected(be.id, iso) && weeklyOff.get(be.id) !== iso) {
          const cell = grid.get(be.id)!.get(iso)!;
          cell.symbol = BETWEEN_SYMBOL;
          cell.shift = 'Between';
        }
      }
    }
  }

  // ===== Persist results (batched upsert)
  const rows: any[] = [];
  for (const emp of emps) {
    for (const d of days) {
      const iso = dateISO(d);
      const cell = grid.get(emp.id)!.get(iso)!;
      let sym = cell.symbol || SPECIAL_SYMBOL.Off;
      // Final safety: enforce always-evening employees to have Evening code if not Off/Vacation/Between
      if (isAlwaysEveningEmp(emp) && sym !== SPECIAL_SYMBOL.Off && sym !== SPECIAL_SYMBOL.Vacation && cell.shift !== 'Between') {
        const mCode = (SHIFT_SYMBOL as any)[emp.employment_type]['Morning'];
        const eCode = (SHIFT_SYMBOL as any)[emp.employment_type]['Evening'];
        if (sym === mCode) sym = eCode;
      }
      rows.push({
        month_id: monthRow.id,
        employee_id: emp.id,
        date: iso,
        symbol: sym,
        code: sym,
      });
    }
  }

  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    await (sb as any)
      .from('assignments')
      .upsert(chunk as any, { onConflict: 'employee_id,date' });
    await new Promise((r) => setTimeout(r, 10)); // small pause to avoid saturation
  }

  const duration = Date.now() - tAll;
  console.log('✅ generateSchedule:done', {
    rows: rows.length,
    duration,
    timings,
  });

  return { ok: true, totalRows: rows.length, duration, timings };
}
