import { startOfMonth, endOfMonth, eachDayOfInterval, format, addDays, getDay } from "date-fns";
import seedrandom from "seedrandom";
import supabaseServer from "@/app/lib/supabaseServer";

// ******************************
//  CONFIG
// ******************************

const MARWA_ID = "3864"; // مروه
const PART_TIME_CODE = "ولاء الشرفي"; // اسم ولاء أو استخدمي ID لو تريدين

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

  // ----------- استخدم seed جديد لكل توليد -----------
  const rng = seedrandom(`${year}-${month}-${Date.now()}`);

  // ----------- تأكد من وجود row في months -----------
  const { data: monthRow, error: mErr } = await sb
    .from("months")
    .upsert({ year, month }, { onConflict: "year,month" })
    .select("*")
    .single();

  if (mErr) throw mErr;

  // ----------- جلب الموظفات -----------
  const { data: employees } = await sb
    .from("employees")
    .select("*")
    .order("name", { ascending: true });

  // ----------- تحديد ولاء (Part-Time) -----------
  const isPartTime = (emp: any) =>
    emp.name.includes(PART_TIME_CODE) || emp.employment_type === "PartTime";

  // ----------- جلب تغطية الشفتات من الإعدادات -----------
  const { data: settings } = await sb.from("settings").select("key,value");
  const map = Object.fromEntries(settings.map((s) => [s.key, s.value]));

  const coverageMorning = Number(map.morningCoverage) || Number(map.coverageMorning) || 5;
  const coverageEvening = Number(map.eveningCoverage) || Number(map.coverageEvening) || 6;

  // ----------- قراءة آخر أسبوع من الشهر السابق لعكس الشفتات -----------
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

  // ----------- تجهيز التواريخ -----------
  const start = startOfMonth(new Date(year, month - 1, 1));
  const end = endOfMonth(start);
  const days = eachDayOfInterval({ start, end });

  // ----------- تتبع شفتات الأسابيع الجديدة -----------
  const weeklyShift = new Map<string, ("Morning" | "Evening")[]>(); // لكل موظف التاريخ الأسبوعي

  // ----------- تحديد الشفت لكل موظف أسبوعيًا -----------
  const getWeeklyShift = (empId: string, wIdx: number) => {
    const arr = weeklyShift.get(empId) || [];

    // أول أسبوع = قلب آخر أسبوع سابق
    if (wIdx === 0 && prevShift.has(empId)) {
      const ps = prevShift.get(empId)!;
      const flipped = ps === "Morning" ? "Evening" : "Morning";
      arr[wIdx] = flipped;
      weeklyShift.set(empId, arr);
      return flipped;
    }

    // إذا موجود سابقًا
    if (arr[wIdx]) return arr[wIdx];

    // لو آخر أسبوعين متشابهين → قلب
    if (arr.length >= 2 && arr[arr.length - 1] === arr[arr.length - 2]) {
      const flipped = arr[arr.length - 1] === "Morning" ? "Evening" : "Morning";
      arr[wIdx] = flipped;
      weeklyShift.set(empId, arr);
      return flipped;
    }

    // عشوائي Morning / Evening
    const picked = rng() < 0.5 ? "Morning" : "Evening";
    arr[wIdx] = picked;
    weeklyShift.set(empId, arr);
    return picked;
  };

  // ----------- إنتاج جدول العمل -----------
  const rows: any[] = [];

  for (const day of days) {
    const iso = format(day, "yyyy-MM-dd");
    const dow = getDay(day);
    const wIdx = getWeekIndex(day);

    // الجمعة OFF للجميع
    if (dow === 5) {
      for (const emp of employees) {
        rows.push({
          month_id: monthRow.id,
          employee_id: emp.id,
          date: iso,
          symbol: OFF,
          code: OFF,
        });
      }
      continue;
    }

    // السبت OFF لمروه فقط
    if (dow === 6) {
      for (const emp of employees) {
        if (emp.id === MARWA_ID)
          rows.push({ month_id: monthRow.id, employee_id: emp.id, date: iso, symbol: OFF, code: OFF });
        else {
          const shift = getWeeklyShift(emp.id, wIdx);
          const symbol = isPartTime(emp)
            ? shift === "Morning"
              ? MORNING_CODE_PT
              : EVENING_CODE_PT
            : shift === "Morning"
            ? MORNING_CODE_FT
            : EVENING_CODE_FT;

          rows.push({ month_id: monthRow.id, employee_id: emp.id, date: iso, symbol, code: symbol });
        }
      }
      continue;
    }

    // ---- توزيع OFF ----
    const offList = randomPick(
      employees.filter((e) => e.id !== MARWA_ID),
      rng,
      2
    );

    const offSet = new Set(offList.map((e) => e.id));

    // ---- توزيع الصباح / المساء حسب التغطية ----
    const candidates = employees.filter((e) => !offSet.has(e.id));
    const morningStaff = randomPick(candidates, rng, coverageMorning);
    const morningSet = new Set(morningStaff.map((e) => e.id));

    for (const emp of employees) {
      let symbol = OFF;

      if (offSet.has(emp.id)) {
        symbol = OFF;
      } else {
        const weekly = getWeeklyShift(emp.id, wIdx);
        const isMorning = morningSet.has(emp.id);

        const finalShift = isMorning ? "Morning" : "Evening";

        if (isPartTime(emp))
          symbol = finalShift === "Morning" ? MORNING_CODE_PT : EVENING_CODE_PT;
        else symbol = finalShift === "Morning" ? MORNING_CODE_FT : EVENING_CODE_FT;
      }

      rows.push({
        month_id: monthRow.id,
        employee_id: emp.id,
        date: iso,
        symbol,
        code: symbol,
      });
    }
  }

  // ----------- حذف القديم وإدخال الجديد -----------
  await sb.from("assignments").delete().eq("month_id", monthRow.id);
  await sb.from("assignments").insert(rows);

  return { ok: true };
}
