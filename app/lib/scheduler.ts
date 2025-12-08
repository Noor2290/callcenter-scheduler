import { startOfMonth, endOfMonth, eachDayOfInterval, format, addDays, getDay } from "date-fns";
import seedrandom from "seedrandom";
import supabaseServer from "@/app/lib/supabaseServer";

// ******************************
//  CONFIG
// ******************************

const MARWA_ID = "3864"; // مروه

const MORNING_CODE_FT = "MA1";
const EVENING_CODE_FT = "EA1";

const MORNING_CODE_PT = "PT4";
const EVENING_CODE_PT = "PT5";

const OFF = "O";
const VAC = "V";

// ******************************
//  HELPERS
// ******************************

function getWeekIndex(date: Date) {
  const dow = getDay(date); // 0=Sun..6=Sat
  const offset = (dow + 1) % 7; // السبت = 0
  const first = startOfMonth(date);
  const firstOffset = (getDay(first) + 1) % 7;
  const base = addDays(first, -firstOffset);
  const weekStart = addDays(date, -offset);
  return Math.floor((weekStart.getTime() - base.getTime()) / (7 * 86400000));
}

function randomPick(arr: any[], rng: any, count: number) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, count);
}

// ******************************
//  MAIN FUNCTION
// ******************************

export async function generateSchedule({ year, month }: { year: number; month: number }) {
  const sb = supabaseServer();

  const rng = seedrandom(`${year}-${month}-${Date.now()}`);

  // ----------- months row -----------
  const { data: monthRow, error: mErr } = await sb
    .from("months")
    .upsert({ year, month }, { onConflict: "year,month" })
    .select("*")
    .single();
  if (mErr) throw mErr;

  // ----------- employees -----------
  const { data: employeesData } = await sb
    .from("employees")
    .select("*")
    .order("name", { ascending: true });
  const employees = employeesData || [];

  // أي موظفة Part-Time بناء على نوع التوظيف فقط
  const isPartTime = (emp: any) => emp.employment_type === "PartTime";

  // ----------- settings -----------
  const { data: settingsData } = await sb.from("settings").select("key,value");
  const settings = settingsData || [];
  const map = Object.fromEntries(settings.map((s: any) => [s.key, s.value]));

  const coverageMorning = Number(map.morningCoverage) || Number(map.coverageMorning) || 5;
  const coverageEvening = Number(map.eveningCoverage) || Number(map.coverageEvening) || 6;

  // ----------- previous month flip -----------
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;

  const { data: prevAssignments } = await sb.rpc("get_last_week_assignments", {
    y: prevYear,
    m: prevMonth,
  });

  const prevShift = new Map<string, "Morning" | "Evening">();

  if (prevAssignments) {
    for (const a of prevAssignments) {
      const sym = a.symbol;

      if (sym === OFF || sym === VAC) continue;

      let shift: "Morning" | "Evening" | null = null;
      if (["MA1", "MA2", "MA4", "PT4"].includes(sym)) shift = "Morning";
      else if (["EA1", "E2", "E5", "PT5"].includes(sym)) shift = "Evening";

      if (shift) prevShift.set(a.employee_id, shift);
    }
  }

  // ----------- prepare dates -----------
  const start = startOfMonth(new Date(year, month - 1, 1));
  const end = endOfMonth(start);
  const days = eachDayOfInterval({ start, end });

  const weeklyShift = new Map<string, ("Morning" | "Evening")[]>();

  const getWeeklyShift = (empId: string, wIdx: number) => {
    const arr = weeklyShift.get(empId) || [];

    if (wIdx === 0 && prevShift.has(empId)) {
      const ps = prevShift.get(empId)!;
      const flipped = ps === "Morning" ? "Evening" : "Morning";
      arr[wIdx] = flipped;
      weeklyShift.set(empId, arr);
      return flipped;
    }

    if (arr[wIdx]) return arr[wIdx];

    if (arr.length >= 2 && arr[arr.length - 1] === arr[arr.length - 2]) {
      const flipped = arr[arr.length - 1] === "Morning" ? "Evening" : "Morning";
      arr[wIdx] = flipped;
      weeklyShift.set(empId, arr);
      return flipped;
    }

    const picked = rng() < 0.5 ? "Morning" : "Evening";
    arr[wIdx] = picked;
    weeklyShift.set(empId, arr);
    return picked;
  };

  // **********************************************
  //   توزيع الأوف الأسبوعي: كل موظفة يوم واحد OFF في الأسبوع (غير الجمعة)
  //   مع ضمان توزيع متوازن (أقل عدد OFF في كل يوم)
  // **********************************************

  // نجمع الأسابيع وأيامها (بدون الجمعة)
  const weekDaysMap = new Map<number, Date[]>(); // weekIndex -> أيام العمل (سبت-خميس)
  for (const day of days) {
    const dow = getDay(day);
    if (dow === 5) continue; // الجمعة نتجاهلها هنا
    const wIdx = getWeekIndex(day);
    if (!weekDaysMap.has(wIdx)) weekDaysMap.set(wIdx, []);
    weekDaysMap.get(wIdx)!.push(day);
  }

  // لكل أسبوع، نوزّع يوم أوف واحد لكل موظفة
  // weeklyOffDay: Map<weekIndex, Map<empId, dateISO>>
  const weeklyOffDay = new Map<number, Map<string, string>>();

  // حساب الحد الأقصى للـ OFF في اليوم الواحد
  // المتاحين = إجمالي الموظفات - عدد OFF
  // لازم المتاحين >= coverageMorning + coverageEvening
  const totalEmployees = employees.length;
  const requiredAvailable = coverageMorning + coverageEvening;
  const maxOffPerDay = Math.max(1, totalEmployees - requiredAvailable);

  for (const [wIdx, wDays] of weekDaysMap) {
    const offMap = new Map<string, string>();
    weeklyOffDay.set(wIdx, offMap);

    // عداد لكل يوم: كم موظفة أخذت OFF فيه
    const dayOffCount = new Map<string, number>();
    for (const d of wDays) {
      dayOffCount.set(format(d, "yyyy-MM-dd"), 0);
    }

    // نخلط الموظفات عشوائياً
    const shuffledEmps = [...employees];
    for (let i = shuffledEmps.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffledEmps[i], shuffledEmps[j]] = [shuffledEmps[j], shuffledEmps[i]];
    }

    // مروه دائماً السبت (dow=6) إذا موجود في هذا الأسبوع
    const saturdayInWeek = wDays.find(d => getDay(d) === 6);
    const saturdayISO = saturdayInWeek ? format(saturdayInWeek, "yyyy-MM-dd") : null;

    for (const emp of shuffledEmps) {
      const empIdStr = String(emp.id);
      if (empIdStr === MARWA_ID && saturdayISO) {
        // مروه أوفها السبت
        offMap.set(empIdStr, saturdayISO);
        dayOffCount.set(saturdayISO, (dayOffCount.get(saturdayISO) || 0) + 1);
      } else {
        // اختر اليوم اللي فيه أقل عدد OFF (مع عدم تجاوز الحد الأقصى)
        let bestDay: string | null = null;
        let minCount = Infinity;

        for (const d of wDays) {
          const iso = format(d, "yyyy-MM-dd");
          const count = dayOffCount.get(iso) || 0;
          if (count < maxOffPerDay && count < minCount) {
            minCount = count;
            bestDay = iso;
          }
        }

        // لو كل الأيام وصلت الحد الأقصى، اختر أي يوم بأقل عدد
        if (!bestDay) {
          for (const d of wDays) {
            const iso = format(d, "yyyy-MM-dd");
            const count = dayOffCount.get(iso) || 0;
            if (count < minCount) {
              minCount = count;
              bestDay = iso;
            }
          }
        }

        if (bestDay) {
          offMap.set(empIdStr, bestDay);
          dayOffCount.set(bestDay, (dayOffCount.get(bestDay) || 0) + 1);
        }
      }
    }
  }

  // **********************************************
  //          GENERATE DAILY ASSIGNMENTS
  // **********************************************

  const rows: any[] = [];

  for (const day of days) {
    const iso = format(day, "yyyy-MM-dd");
    const dow = getDay(day);
    const wIdx = getWeekIndex(day);

    // -------- الجمعة OFF للجميع --------
    if (dow === 5) {
      for (const emp of employees) {
        rows.push({ month_id: monthRow.id, employee_id: emp.id, date: iso, symbol: OFF, code: OFF });
      }
      continue;
    }

    // -------- تحديد من عندها OFF اليوم (من التوزيع الأسبوعي) --------
    const offMapThisWeek = weeklyOffDay.get(wIdx) || new Map();
    const offSet = new Set<string>();
    for (const [empId, offDate] of offMapThisWeek) {
      if (offDate === iso) offSet.add(String(empId));
    }

    // ==========================
    //     توزيع Morning / Evening حسب الإعدادات
    // ==========================

    const available = employees.filter((e: any) => !offSet.has(String(e.id)));

    // --- اختر morning بالضبط حسب الإعداد ---
    const morningCount = Math.min(coverageMorning, available.length);
    const morningStaff = randomPick(available, rng, morningCount);
    
    // --- الباقي كلهم evening ---
    const eveningStaff = available.filter((e: any) => !morningStaff.includes(e));

    const morningSet = new Set(morningStaff.map((e: any) => String(e.id)));
    const eveningSet = new Set(eveningStaff.map((e: any) => String(e.id)));

    // ==========================
    //     Apply final assignments
    // ==========================
    for (const emp of employees) {
      let symbol = OFF;
      const empIdStr = String(emp.id);

      if (!offSet.has(empIdStr)) {
        let finalShift: "Morning" | "Evening";

        if (morningSet.has(empIdStr)) {
          finalShift = "Morning";
        } else {
          finalShift = "Evening";
        }

        symbol = isPartTime(emp)
          ? finalShift === "Morning"
            ? MORNING_CODE_PT
            : EVENING_CODE_PT
          : finalShift === "Morning"
          ? MORNING_CODE_FT
          : EVENING_CODE_FT;
      }

      rows.push({ month_id: monthRow.id, employee_id: emp.id, date: iso, symbol, code: symbol });
    }
  }

  // ----------- حذف القديم وإدخال الجديد -----------
  await sb.from("assignments").delete().eq("month_id", monthRow.id);
  await sb.from("assignments").insert(rows);

  return { ok: true };
}
