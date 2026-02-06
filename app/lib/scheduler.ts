// ═══════════════════════════════════════════════════════════════════════════
//  GENERATE SCHEDULE — v12.0 (PREVIEW + RANDOM SEED)
//  
//  ❗ هذا الملف يتبع التعليمات الرئيسية فقط - لا منطق قديم
//  
//  📌 التغطية من الإعدادات فقط (بدون defaults):
//     - Morning Coverage = بالضبط العدد المحدد (لا زيادة، لا نقصان)
//     - Evening Coverage = بالضبط العدد المحدد (لا زيادة، لا نقصان)
//  
//  📌 نظام التوزيع الفردي (2+2):
//     - كل موظفة تُحدد أسابيعها بشكل مستقل وعشوائي
//     - كل موظفة = 2 أسابيع صباح + 2 أسابيع مساء
//     - الاختيار عشوائي لكل موظفة باستخدام seed
//     - الشفت ثابت طوال الأسبوع
//     - التغطية اليومية تُطبق بعد تحديد الشفتات
//  
//  📌 قواعد الإجازات:
//     - الجمعة: OFF للجميع
//     - مروة (Marwa Alrehaili): السبت OFF دائماً
//     - كل موظفة: OFF واحد فقط أسبوعياً
//     - حد أقصى 2 OFF في اليوم (عدا الجمعة)
//     - لا OFF إضافي أبداً
//     - طلبات OFF/V المسبقة تُحترم
//  
//  📌 Between Shift:
//     - إذا ON: للموظفة المحددة فقط
//     - إذا OFF: لا يستخدم نهائياً
//  
//  📌 الشفتات المسموحة فقط:
//     صباح: MA1, MA2, M2, PT4
//     مساء: EA1, E5, E2, MA4, PT5
//     ليل: MA3
//     إجازة: O, V
//  
//  📌 وضع Preview:
//     - preview=true: يولّد جدول بدون حفظ
//     - seed عشوائي: كل ضغطة "توليد" تعطي نتيجة مختلفة
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
const BETWEEN = "B";

// الشفتات المسموحة فقط
const MORNING_SHIFTS: Record<string, string> = {
  FullTime: "MA1",
  PartTime: "PT4",
  Trainee: "M2"
};

const EVENING_SHIFTS: Record<string, string> = {
  FullTime: "EA1",
  PartTime: "PT5",
  Trainee: "E2"
};

const MARWA_NAME = "Marwa Alrehaili"; // اسم مروة للبحث
const MAX_OFF_PER_DAY = 2;

// ═══════════════════════════════════════════════════════════════════════════
// SEEDED RANDOM - لتوليد جداول مختلفة مع كل seed
// ═══════════════════════════════════════════════════════════════════════════
function seededRandom(seed: number): () => number {
  return function() {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

function shuffleWithSeed<T>(arr: T[], seed: number): T[] {
  const result = [...arr];
  const random = seededRandom(seed);
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════
type ShiftType = "Morning" | "Evening";

interface Employee {
  id: number | string;
  name: string;
  employment_type?: string;
}

interface Settings {
  coverageMorning: number;
  coverageEvening: number;
  useBetweenShift: boolean;
  betweenShiftEmployeeId: string | null;
  weekStartDay?: number; // 0-6 (اختياري)
}

interface DayAssignment {
  month_id: string;
  employee_id: string;
  date: string;
  symbol: string;
  code: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

// حساب رقم الأسبوع الحقيقي (السبت بداية الأسبوع)
function getWeekIndex(date: Date, monthStart: Date): number {
  // أول سبت في الشهر
  let firstSaturday = new Date(monthStart);
  while (firstSaturday.getDay() !== 6) {
    firstSaturday.setDate(firstSaturday.getDate() + 1);
  }
  if (date < firstSaturday) return 1;
  // الفرق بالأيام
  const diff = Math.floor((date.getTime() - firstSaturday.getTime()) / (1000 * 60 * 60 * 24));
  return 1 + Math.floor(diff / 7) + 1;
}

// الحصول على رمز الشفت حسب نوع الموظفة
function getShiftSymbol(emp: Employee, shiftType: ShiftType): string {
  const empType = emp.employment_type || "FullTime";
  if (shiftType === "Morning") {
    return MORNING_SHIFTS[empType] || MORNING_SHIFTS.FullTime;
  }
  return EVENING_SHIFTS[empType] || EVENING_SHIFTS.FullTime;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN FUNCTION
// ═══════════════════════════════════════════════════════════════════════════
export async function generateSchedule({
  year,
  month,
  preview = false,
  seed,
  lastWeekShifts,
  weekStartDay
}: {
  year: number;
  month: number;
  preview?: boolean;  // true = لا يحفظ في DB
  seed?: number;      // seed عشوائي لتوليد جداول مختلفة
  lastWeekShifts?: Record<string, 'Morning' | 'Evening'>;
  weekStartDay?: number;
}) {
  const sb = supabaseServer();
  
  // إذا لم يتم تمرير seed، نستخدم وقت عشوائي
  const actualSeed = seed ?? Date.now();
  
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`[SCHEDULER v12] إنشاء جدول ${year}-${month}`);
  console.log(`[MODE] ${preview ? 'PREVIEW (بدون حفظ)' : 'SAVE (حفظ في DB)'}`);
  console.log(`[SEED] ${actualSeed}`);
  console.log(`${'═'.repeat(60)}\n`);

  // ═══════════════════════════════════════════════════════════════════════
  // الخطوة 1: تحميل البيانات من قاعدة البيانات
  // ═══════════════════════════════════════════════════════════════════════
  
  // إنشاء/تحديث سجل الشهر
  const { data: monthRow, error: monthErr } = await sb
    .from("months")
    .upsert({ year, month }, { onConflict: "year,month" })
    .select("*")
    .single();
  
  if (monthErr || !monthRow) {
    throw new Error(monthErr?.message || "فشل في إنشاء سجل الشهر");
  }

  // تحميل الموظفات
  const { data: empData } = await sb.from("employees").select("*").order("name");
  const allEmployees: Employee[] = (empData || []) as Employee[];
  console.log(`[1] عدد الموظفات: ${allEmployees.length}`);

  // تحميل الإعدادات (المصدر الوحيد للحقيقة)
  const { data: settingsData } = await sb.from("settings").select("key, value");
  const settingsMap: Record<string, string> = {};
  for (const s of settingsData || []) {
    if (s.key) settingsMap[s.key] = s.value ?? "";
  }
  
  const settings: Settings = {
    coverageMorning: Number(settingsMap['coverageMorning']) || 0,
    coverageEvening: Number(settingsMap['coverageEvening']) || 0,
    useBetweenShift: settingsMap['useBetweenShift'] === 'true',
    betweenShiftEmployeeId: settingsMap['betweenShiftEmployeeId'] || null,
    weekStartDay: settingsMap['weekStartDay'] !== undefined ? Number(settingsMap['weekStartDay']) : 6
  };

  
  console.log(`[1] الإعدادات:`);
  console.log(`    - تغطية الصباح: ${settings.coverageMorning}`);
  console.log(`    - تغطية المساء: ${settings.coverageEvening}`);
  console.log(`    - Between Shift: ${settings.useBetweenShift ? 'ON' : 'OFF'}`);

  // التحقق من الإعدادات
  if (settings.coverageMorning === 0 || settings.coverageEvening === 0) {
    throw new Error("يجب تحديد قيم التغطية في صفحة الإعدادات");
  }

  // فصل موظفة Between Shift
  let betweenEmployee: Employee | null = null;
  let regularEmployees: Employee[] = allEmployees;
  
  if (settings.useBetweenShift && settings.betweenShiftEmployeeId) {
    betweenEmployee = allEmployees.find(e => String(e.id) === settings.betweenShiftEmployeeId) || null;
    if (betweenEmployee) {
      regularEmployees = allEmployees.filter(e => String(e.id) !== settings.betweenShiftEmployeeId);
      console.log(`    - موظفة Between: ${betweenEmployee.name}`);
    }
  }

  // تحميل الإجازات والطلبات
  const { data: vacationData } = await sb.from("requests").select("*").eq("type", "Vacation");
  const { data: offRequestData } = await sb.from("requests").select("*").eq("type", "OffRequest");
  
  const vacationSet = new Set<string>();
  for (const v of vacationData || []) {
    vacationSet.add(`${v.employee_id}_${format(new Date(v.date), "yyyy-MM-dd")}`);
  }
  
  const offRequestSet = new Set<string>();
  for (const o of offRequestData || []) {
    offRequestSet.add(`${o.employee_id}_${format(new Date(o.date), "yyyy-MM-dd")}`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // الخطوة 2: تحضير الأيام والأسابيع
  // ═══════════════════════════════════════════════════════════════════════
  
  const monthStart = startOfMonth(new Date(year, month - 1, 1));
  const monthEnd = endOfMonth(monthStart);
  const allDays = eachDayOfInterval({ start: monthStart, end: monthEnd });
  
  // تجميع الأيام حسب الأسبوع (السبت بداية الأسبوع)
  const weekDaysMap = new Map<number, Date[]>();
  for (const day of allDays) {
    const weekIndex = getWeekIndex(day, monthStart);
    if (!weekDaysMap.has(weekIndex)) weekDaysMap.set(weekIndex, []);
    weekDaysMap.get(weekIndex)!.push(day);
  }
  
  const weeks = [...weekDaysMap.keys()].sort((a, b) => a - b);
  console.log(`[2] عدد الأيام: ${allDays.length}, عدد الأسابيع: ${weeks.length}`);

  // ═══════════════════════════════════════════════════════════════════════
  // الخطوة 3: توزيع الشفتات الأسبوعية (تناوب 2+2)
  // ═══════════════════════════════════════════════════════════════════════
  
  console.log(`\n[3] توزيع الشفتات الأسبوعية...`);
  
  // البحث عن مروة بالاسم
  const marwaEmployee = allEmployees.find(e => 
    e.name.toLowerCase().includes('marwa') || 
    e.name.includes('مروة')
  );
  const marwaId = marwaEmployee ? String(marwaEmployee.id) : null;
  if (marwaEmployee) {
    console.log(`    - مروة: ${marwaEmployee.name} (ID: ${marwaId})`);
  }
  
  // البحث عن Tooq Almaliki (مسائية دائماً) - بالـ ID أو الاسم
  const TOOQ_ID = "3979";
  const tooqEmployee = allEmployees.find(e => 
    String(e.id) === TOOQ_ID || 
    e.name.toLowerCase().includes('tooq')
  );
  const actualTooqId = tooqEmployee ? String(tooqEmployee.id) : null;
  if (tooqEmployee) {
    console.log(`    - Tooq Almaliki: ${tooqEmployee.name} (ID: ${actualTooqId}) - مسائية دائماً`);
  } else {
    console.log(`    - ⚠️ Tooq Almaliki غير موجودة!`);
  }
  
  // الموظفات المشاركات في التناوب (بدون Tooq)
  const rotatingEmployees = regularEmployees.filter(e => 
    String(e.id) !== TOOQ_ID && 
    !e.name.toLowerCase().includes('tooq')
  );
  
  // ═══════════════════════════════════════════════════════════════════
  // نظام التوزيع الديناميكي بالأولوية
  // ═══════════════════════════════════════════════════════════════════
  // - في كل أسبوع، نحسب عدد أسابيع Morning و Evening السابقة لكل موظفة
  // - أولوية الصباح: للموظفات اللي عندهن Evening > Morning
  // - أولوية المساء: للموظفات اللي عندهن Morning > Evening
  // - هذا يضمن توزيع متوازن (2 صباح + 2 مساء) تلقائياً
  // ═══════════════════════════════════════════════════════════════════
  
  console.log(`    - عدد الموظفات العادية: ${regularEmployees.length}`);
  console.log(`    - عدد الموظفات في التناوب: ${rotatingEmployees.length}`);
  console.log(`    - التغطية المطلوبة: صباح=${settings.coverageMorning}, مساء=${settings.coverageEvening}`);
  if (betweenEmployee) {
    console.log(`    - موظفة Between: ${betweenEmployee.name} (مستبعدة من التوزيع)`);
  }
  
  // حساب التغطية المسائية المتبقية (بعد حجز Tooq)
  const eveningCoverageForRotation = tooqEmployee 
    ? settings.coverageEvening - 1  // Tooq محجوزة مسبقاً
    : settings.coverageEvening;
  
  console.log(`    - التغطية المسائية للتناوب: ${eveningCoverageForRotation} (Tooq محجوزة: ${tooqEmployee ? 'نعم' : 'لا'})`);
  
  // weekStartDay يأتي من باراميتر الدالة أو من الإعدادات أو الافتراضي 6
  const weekStart = typeof weekStartDay === 'number'
    ? weekStartDay
    : (typeof settings.weekStartDay === 'number' ? settings.weekStartDay : 6);
  // أول يوم في الشهر الجديد
  const firstDay = allDays[0];
  // آخر يوم في الشهر السابق
  const prevMonthEnd = new Date(year, month - 1, 0);
  
  // ═══════════════════════════════════════════════════════════════════
  // هل أول يوم في الشهر الجديد ليس يوم السبت؟
  // إذا كان أول يوم في الشهر الجديد ليس السبت، فهذا يعني أننا في منتصف أسبوع بدأ في الشهر السابق
  // ═══════════════════════════════════════════════════════════════════
  const firstDayOfWeek = firstDay.getDay(); // 0=أحد, 1=اثنين, ..., 6=سبت
  const isSharedWeek = firstDayOfWeek !== weekStart; // إذا لم يبدأ الشهر يوم السبت، فهو أسبوع مشترك
  
  // للتوافق مع الكود القديم
  const firstWeekStart = new Date(firstDay);
  while (firstWeekStart.getDay() !== weekStart) firstWeekStart.setDate(firstWeekStart.getDate() - 1);
  const firstWeekEnd = new Date(firstWeekStart); firstWeekEnd.setDate(firstWeekStart.getDate() + 6);

  // تتبع آخر شفت لكل موظفة في التناوب (أسبوع صباح، أسبوع مساء)
  // نستخدم Map لحفظ آخر شفت لكل موظفة، ويتم التهيئة خارج حلقة الأسابيع
  const lastShiftType = new Map<string, ShiftType>();
  
  // ═══════════════════════════════════════════════════════════════════
  // منطق الأسبوع المشترك (سبت-خميس):
  // - إذا الشهر الجديد يبدأ في منتصف أسبوع (ليس يوم السبت):
  //   → نكمّل نفس الشفت من الشهر السابق حتى الخميس
  //   → بعد الجمعة OFF، نبدأ أسبوع جديد بالشفت المعكوس
  // - إذا الشهر الجديد يبدأ يوم السبت:
  //   → نبدأ مباشرة بالشفت المعكوس
  // ═══════════════════════════════════════════════════════════════════
  
  for (let i = 0; i < rotatingEmployees.length; i++) {
    const emp = rotatingEmployees[i];
    const empId = String(emp.id);
    if (lastWeekShifts && weeks.length > 0) {
      const prev = lastWeekShifts[empId];
      if (isSharedWeek && prev) {
        // أسبوع مشترك: نكمّل نفس الشفت (لن يتم عكسه في الأسبوع الأول)
        lastShiftType.set(empId, prev);
      } else if (!isSharedWeek && prev) {
        // الشهر يبدأ بأسبوع جديد (السبت): نبدأ بالمعكوس مباشرة
        lastShiftType.set(empId, prev === 'Morning' ? 'Evening' : 'Morning');
      } else {
        // لا يوجد شفت سابق: استخدم المنطق الافتراضي
        lastShiftType.set(empId, i % 2 === 0 ? "Morning" : "Evening");
      }
    } else {
      lastShiftType.set(empId, i % 2 === 0 ? "Morning" : "Evening");
    }
  }
  
  console.log(`[3] weekStart: ${weekStart} (${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][weekStart]})`);
  console.log(`[3] firstDay: ${format(firstDay, 'yyyy-MM-dd')} (${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][firstDay.getDay()]})`);
  console.log(`[3] prevMonthEnd: ${format(prevMonthEnd, 'yyyy-MM-dd')} (${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][prevMonthEnd.getDay()]})`);
  console.log(`[3] firstWeekStart: ${format(firstWeekStart, 'yyyy-MM-dd')}, firstWeekEnd: ${format(firstWeekEnd, 'yyyy-MM-dd')}`);
  console.log(`[3] isSharedWeek: ${isSharedWeek}`);
  if (lastWeekShifts) {
    console.log(`[3] lastWeekShifts من الشهر السابق:`, Object.keys(lastWeekShifts).length, 'موظفة');
    console.log(`[3] Sample lastWeekShifts:`, Object.entries(lastWeekShifts).slice(0, 3));
  }

  // بعد توزيع أول أسبوع (مشترك أو لا)، في الأسابيع التالية نطبّق الانعكاس المعتاد تلقائيًا
  
  // بناء جدول الشفتات الأسبوعية
  const weeklyShifts = new Map<number, Map<string, ShiftType>>();
  
  // تتبع الشفت الأسبوعي لكل موظفة (للاستخدام في بناء الجدول اليومي)
  const empWeeklyShift = new Map<string, Map<number, ShiftType>>();
  for (const emp of regularEmployees) {
    empWeeklyShift.set(String(emp.id), new Map());
  }
  
  // Tooq دائماً مسائية في كل الأسابيع
  if (tooqEmployee) {
    const tooqId = String(tooqEmployee.id);
    // إضافة Tooq إلى empWeeklyShift إذا لم تكن موجودة
    if (!empWeeklyShift.has(tooqId)) {
      empWeeklyShift.set(tooqId, new Map());
    }
    for (const weekIndex of weeks) {
      empWeeklyShift.get(tooqId)!.set(weekIndex, "Evening");
    }
  }
  
  for (const weekIndex of weeks) {
  const shiftMap = new Map<string, ShiftType>();
  weeklyShifts.set(weekIndex, shiftMap);

  // Tooq دائماً مسائية
  if (tooqEmployee) {
    shiftMap.set(String(tooqEmployee.id), "Evening");
  }

  // تجهيز الموظفات القابلات للتناوب فقط (بدون الثابتات)
  const weekEmployees = rotatingEmployees.map(e => String(e.id));

  // ═══════════════════════════════════════════════════════════════════
  // منطق التناوب الأسبوعي (سبت-خميس):
  // - الأسبوع الأول المشترك: نستمر بنفس الشفت بالضبط (لا عكس، لا إعادة توزيع)
  // - الأسابيع التالية: نعكس الشفت عن الأسبوع السابق
  // ═══════════════════════════════════════════════════════════════════
  const isFirstWeek = weekIndex === weeks[0];
  const shouldKeepSameShift = isFirstWeek && isSharedWeek && lastWeekShifts && Object.keys(lastWeekShifts).length > 0;
  
  console.log(`[WEEK ${weekIndex}] isFirstWeek: ${isFirstWeek}, shouldKeepSameShift: ${shouldKeepSameShift}, isSharedWeek: ${isSharedWeek}`);
  if (isFirstWeek) {
    console.log(`[WEEK ${weekIndex}] weekEmployees sample:`, weekEmployees.slice(0, 5));
    if (lastWeekShifts) {
      console.log(`[WEEK ${weekIndex}] lastWeekShifts keys:`, Object.keys(lastWeekShifts).slice(0, 5));
      console.log(`[WEEK ${weekIndex}] lastWeekShifts values:`, Object.entries(lastWeekShifts).slice(0, 5));
      // مقارنة المفاتيح
      const firstEmpId = weekEmployees[0];
      console.log(`[WEEK ${weekIndex}] First empId: '${firstEmpId}' (type: ${typeof firstEmpId})`);
      console.log(`[WEEK ${weekIndex}] lastWeekShifts[${firstEmpId}]:`, lastWeekShifts[firstEmpId]);
    } else {
      console.log(`[WEEK ${weekIndex}] lastWeekShifts is undefined or null`);
    }
  }
  
  // لوج مهم للتشخيص
  if (isFirstWeek) {
    console.log(`[SCHEDULER] ══════════════════════════════════════════════════`);
    console.log(`[SCHEDULER] isFirstWeek: ${isFirstWeek}`);
    console.log(`[SCHEDULER] isSharedWeek: ${isSharedWeek}`);
    console.log(`[SCHEDULER] lastWeekShifts exists: ${!!lastWeekShifts}`);
    console.log(`[SCHEDULER] lastWeekShifts count: ${lastWeekShifts ? Object.keys(lastWeekShifts).length : 0}`);
    if (lastWeekShifts) {
      console.log(`[SCHEDULER] lastWeekShifts ALL:`, JSON.stringify(lastWeekShifts));
    }
    console.log(`[SCHEDULER] ══════════════════════════════════════════════════`);
  }
  
  let nextShifts = weekEmployees.map(empId => {
    // ═══════════════════════════════════════════════════════════════════
    // الأسبوع الأول المشترك: نستخدم الشفت مباشرة من lastWeekShifts بدون عكس
    // ═══════════════════════════════════════════════════════════════════
    if (isFirstWeek && isSharedWeek && lastWeekShifts && Object.keys(lastWeekShifts).length > 0) {
      // البحث في lastWeekShifts بكل الطرق الممكنة
      let shiftFromPrevMonth: 'Morning' | 'Evening' | undefined = undefined;
      
      // طريقة 1: المفتاح كما هو
      if (lastWeekShifts[empId]) {
        shiftFromPrevMonth = lastWeekShifts[empId];
      }
      // طريقة 2: البحث في كل المفاتيح
      if (!shiftFromPrevMonth) {
        for (const key of Object.keys(lastWeekShifts)) {
          if (String(key) === String(empId) || key === empId) {
            shiftFromPrevMonth = lastWeekShifts[key];
            break;
          }
        }
      }
      
      if (shiftFromPrevMonth) {
        console.log(`[WEEK ${weekIndex}] ${empId}: SHARED WEEK -> keeping ${shiftFromPrevMonth}`);
        return { empId, nextShift: shiftFromPrevMonth };
      } else {
        console.log(`[WEEK ${weekIndex}] ${empId}: SHARED WEEK but NO shift found`);
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════
    // الأسابيع العادية: نعكس الشفت عن الأسبوع السابق
    // ═══════════════════════════════════════════════════════════════════
    const currentShift = lastShiftType.get(empId) || "Evening";
    const nextShift = currentShift === "Morning" ? "Evening" : "Morning";
    return { empId, nextShift: nextShift as ShiftType };
  });

  // توزيع الصباح
  let morningList = nextShifts.filter(c => c.nextShift === "Morning");
  let eveningList = nextShifts.filter(c => c.nextShift === "Evening");

  // ═══════════════════════════════════════════════════════════════════
  // في الأسبوع المشترك: لا نعيد التوزيع - نحافظ على نفس الشفتات من الشهر السابق
  // في الأسابيع العادية: نطبق قواعد التغطية
  // ═══════════════════════════════════════════════════════════════════
  if (!shouldKeepSameShift) {
    // لا يسمح بتجاوز العدد
    if (morningList.length > settings.coverageMorning) {
      const extra = morningList.splice(settings.coverageMorning);
      eveningList = eveningList.concat(extra.map(c => ({ empId: c.empId, nextShift: "Evening" as ShiftType })));
    } else if (morningList.length < settings.coverageMorning) {
      const needed = settings.coverageMorning - morningList.length;
      const toMove = eveningList.splice(0, needed);
      morningList = morningList.concat(toMove.map(c => ({ empId: c.empId, nextShift: "Morning" as ShiftType })));
    }

    // لا يسمح بتجاوز العدد للمساء
    if (eveningList.length > settings.coverageEvening - (tooqEmployee ? 1 : 0)) {
      eveningList = eveningList.slice(0, settings.coverageEvening - (tooqEmployee ? 1 : 0));
    }
  }

  // تعيين الشفتات الأسبوعية
  for (const c of morningList) {
    shiftMap.set(c.empId, "Morning");
    empWeeklyShift.get(c.empId)!.set(weekIndex, "Morning");
    lastShiftType.set(c.empId, "Morning");
  }
  for (const c of eveningList) {
    shiftMap.set(c.empId, "Evening");
    empWeeklyShift.get(c.empId)!.set(weekIndex, "Evening");
    lastShiftType.set(c.empId, "Evening");
  }

  // تحقق نهائي بعد التوزيع
  let morningCount = 0;
  let eveningCount = 0;
  for (const s of shiftMap.values()) {
    if (s === "Morning") morningCount++;
    else eveningCount++;
  }
  const actualEvening = eveningCount + (tooqEmployee ? 1 : 0);
  if (morningCount !== settings.coverageMorning || actualEvening !== settings.coverageEvening) {
    console.warn(`⚠️ الأسبوع ${weekIndex}: التغطية لا تطابق الإعدادات! صباح=${morningCount}/${settings.coverageMorning}، مساء=${actualEvening}/${settings.coverageEvening}`);
  } else {
    console.log(`    - الأسبوع ${weekIndex}: صباح=${morningCount}, مساء=${actualEvening} (مع Tooq)`);
  }
}

  
  // طباعة ملخص التوزيع النهائي (نمط أسبوع صباح/أسبوع مساء)
  console.log(`\n    📊 ملخص التوزيع النهائي (تناوب أسبوعي):`);
  for (const emp of regularEmployees) {
    const empId = String(emp.id);
    const weekShifts = empWeeklyShift.get(empId);
    if (!weekShifts) continue; // تخطي إذا لم تكن موجودة
    
    const pattern = weeks.map(w => weekShifts.get(w) === "Morning" ? "M" : "E").join("-");
    
    // التحقق إذا كانت Tooq (بالاسم أو ID)
    const isTooq = empId === TOOQ_ID || emp.name.toLowerCase().includes('tooq');
    if (isTooq) {
      console.log(`    - ${emp.name}: مسائية دائماً [${pattern}] ⭐`);
    } else {
      // حساب عدد الأسابيع صباح/مساء من النمط نفسه
      let morningWeeks = 0;
      let eveningWeeks = 0;
      for (const w of weeks) {
        const s = weekShifts.get(w);
        if (s === "Morning") morningWeeks++;
        else if (s === "Evening") eveningWeeks++;
      }
      console.log(`    - ${emp.name}: صباح=${morningWeeks}, مساء=${eveningWeeks} [${pattern}]`);
    }
  }
  
  // طباعة Tooq إذا كانت موجودة
  if (tooqEmployee) {
    const tooqId = String(tooqEmployee.id);
    const weekShifts = empWeeklyShift.get(tooqId);
    if (weekShifts) {
      const pattern = weeks.map(w => weekShifts.get(w) === "Morning" ? "M" : "E").join("-");
      console.log(`    - ${tooqEmployee.name}: مسائية دائماً [${pattern}] ⭐`);
    }
  }
  
  // للتوافق مع الكود القديم
  const empMorningWeeks = new Map<string, number[]>();
  for (const emp of regularEmployees) {
    const empId = String(emp.id);
    const weekShifts = empWeeklyShift.get(empId);
    if (!weekShifts) continue;
    const morningWeeks = weeks.filter(w => weekShifts.get(w) === "Morning");
    empMorningWeeks.set(empId, morningWeeks);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // الخطوة 4: توزيع الإجازات الأسبوعية (عشوائي)
  // ═══════════════════════════════════════════════════════════════════════
  // - الجمعة: OFF للجميع (يتم في الخطوة 5)
  // - مروة: السبت OFF دائماً
  // - باقي الموظفات: OFF عشوائي من الأحد-الخميس فقط
  // - لا يُسمح بـ OFF يوم السبت لغير مروة
  // - حد أقصى 2 OFF لكل يوم
  // ═══════════════════════════════════════════════════════════════════════
  
  console.log(`\n[4] توزيع الإجازات الأسبوعية (عشوائي)...`);
  
  // weekIndex -> empId -> dateISO
  const weeklyOffDays = new Map<number, Map<string, string>>();
  
  for (const weekIndex of weeks) {
    const offMap = new Map<string, string>();
    weeklyOffDays.set(weekIndex, offMap);
    
    const weekDays = weekDaysMap.get(weekIndex) || [];
    
    // أيام العمل (بدون الجمعة)
    const workDays = weekDays.filter(d => getDay(d) !== 5);
    
    // أيام OFF المسموحة لغير مروة (الأحد=0 إلى الخميس=4 فقط، بدون السبت=6)
    const offDaysForOthers = workDays.filter(d => {
      const dow = getDay(d);
      return dow >= 0 && dow <= 4; // الأحد، الإثنين، الثلاثاء، الأربعاء، الخميس
    });
    
    if (workDays.length === 0) continue;
    
    // خلط أيام OFF عشوائياً (للموظفات غير مروة)
    const shuffledOffDays = shuffleWithSeed([...offDaysForOthers], actualSeed + weekIndex * 500);
    
    // تتبع عدد OFF لكل يوم
    const dayOffCount = new Map<string, number>();
    for (const d of workDays) {
      dayOffCount.set(format(d, "yyyy-MM-dd"), 0);
    }
    
    // جميع الموظفات (عادية + between) - مخلوطة عشوائياً
    const allEmpsForOff = [...regularEmployees];
    if (betweenEmployee) allEmpsForOff.push(betweenEmployee);
    const shuffledEmps = shuffleWithSeed(allEmpsForOff, actualSeed + weekIndex * 700);
    
    // ═══════════════════════════════════════════════════════════════════
    // أولاً: معالجة مروة (السبت OFF)
    // ═══════════════════════════════════════════════════════════════════
    if (marwaId) {
      const marwaEmp = allEmpsForOff.find(e => String(e.id) === marwaId);
      if (marwaEmp) {
        // التحقق من عدم وجود Vacation
        let marwaHasVacation = false;
        for (const d of workDays) {
          const dateISO = format(d, "yyyy-MM-dd");
          if (vacationSet.has(`${marwaId}_${dateISO}`)) {
            marwaHasVacation = true;
            break;
          }
        }
        
        if (!marwaHasVacation) {
          const saturday = workDays.find(d => getDay(d) === 6);
          if (saturday) {
            const saturdayISO = format(saturday, "yyyy-MM-dd");
            const count = dayOffCount.get(saturdayISO) || 0;
            if (count < MAX_OFF_PER_DAY) {
              offMap.set(marwaId, saturdayISO);
              dayOffCount.set(saturdayISO, count + 1);
            } else {
              // السبت ممتلئ - اختيار أقرب يوم متاح
              for (const d of shuffledOffDays) {
                const dateISO = format(d, "yyyy-MM-dd");
                const c = dayOffCount.get(dateISO) || 0;
                if (c < MAX_OFF_PER_DAY) {
                  offMap.set(marwaId, dateISO);
                  dayOffCount.set(dateISO, c + 1);
                  break;
                }
              }
            }
          }
        }
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════
    // ثانياً: معالجة Tooq (OFF في أيام المساء فقط)
    // ═══════════════════════════════════════════════════════════════════
    if (tooqEmployee) {
      // التحقق من عدم وجود Vacation
      let tooqHasVacation = false;
      for (const d of workDays) {
        const dateISO = format(d, "yyyy-MM-dd");
        if (vacationSet.has(`${TOOQ_ID}_${dateISO}`)) {
          tooqHasVacation = true;
          break;
        }
      }
      
      if (!tooqHasVacation && !offMap.has(TOOQ_ID)) {
        // التحقق من طلب OFF مسبق
        let tooqHasOffRequest = false;
        for (const d of workDays) {
          const dateISO = format(d, "yyyy-MM-dd");
          if (offRequestSet.has(`${TOOQ_ID}_${dateISO}`)) {
            const count = dayOffCount.get(dateISO) || 0;
            if (count < MAX_OFF_PER_DAY) {
              offMap.set(TOOQ_ID, dateISO);
              dayOffCount.set(dateISO, count + 1);
              tooqHasOffRequest = true;
              break;
            }
          }
        }
        
        // إذا لم يكن هناك طلب OFF، اختيار يوم عشوائي من أيام المساء فقط
        if (!tooqHasOffRequest) {
          // Tooq تحصل على OFF من الأحد-الخميس (أيام المساء)
          // لأنها مسائية دائماً، كل أيام العمل هي أيام مساء لها
          for (const d of shuffledOffDays) {
            const dateISO = format(d, "yyyy-MM-dd");
            const count = dayOffCount.get(dateISO) || 0;
            if (count < MAX_OFF_PER_DAY) {
              offMap.set(TOOQ_ID, dateISO);
              dayOffCount.set(dateISO, count + 1);
              break;
            }
          }
        }
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════
    // ثالثاً: معالجة باقي الموظفات
    // ═══════════════════════════════════════════════════════════════════
    for (const emp of shuffledEmps) {
      const empId = String(emp.id);
      
      // تخطي مروة (تم معالجتها)
      if (empId === marwaId) continue;
      
      // تخطي Tooq (تم معالجتها)
      if (empId === TOOQ_ID) continue;
      
      // تخطي إذا تم تعيين OFF بالفعل
      if (offMap.has(empId)) continue;
      
      // 1. التحقق من وجود طلب OFF مسبق
      let hasOffRequest = false;
      for (const d of workDays) {
        const dateISO = format(d, "yyyy-MM-dd");
        if (offRequestSet.has(`${empId}_${dateISO}`)) {
          const count = dayOffCount.get(dateISO) || 0;
          if (count < MAX_OFF_PER_DAY) {
            offMap.set(empId, dateISO);
            dayOffCount.set(dateISO, count + 1);
            hasOffRequest = true;
            break;
          }
        }
      }
      if (hasOffRequest) continue;
      
      // 2. التحقق من وجود إجازة V - لا تعطى OFF إضافي
      let hasVacation = false;
      for (const d of workDays) {
        const dateISO = format(d, "yyyy-MM-dd");
        if (vacationSet.has(`${empId}_${dateISO}`)) {
          hasVacation = true;
          break;
        }
      }
      if (hasVacation) continue;
      
      // 3. اختيار يوم OFF عشوائي من الأحد-الخميس فقط
      for (const d of shuffledOffDays) {
        const dateISO = format(d, "yyyy-MM-dd");
        const count = dayOffCount.get(dateISO) || 0;
        if (count < MAX_OFF_PER_DAY) {
          offMap.set(empId, dateISO);
          dayOffCount.set(dateISO, count + 1);
          break;
        }
      }
    }
    
    // طباعة ملخص الأسبوع
    const offCounts: Record<string, number> = {};
    for (const [day, count] of dayOffCount) {
      if (count > 0) offCounts[day] = count;
    }
    console.log(`    - الأسبوع ${weekIndex}: ${Object.entries(offCounts).map(([d, c]) => `${d}=${c}`).join(', ')}`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // الخطوة 5: بناء الجدول اليومي
  // ═══════════════════════════════════════════════════════════════════════
  
  console.log(`\n[5] بناء الجدول اليومي...`);
  
  const rows: DayAssignment[] = [];
  
  for (const day of allDays) {
    const dateISO = format(day, "yyyy-MM-dd");
    const dow = getDay(day);
    const weekIndex = getWeekIndex(day, monthStart);
    
    // ═══════════════════════════════════════════════════════════════════
    // الجمعة: OFF للجميع
    // ═══════════════════════════════════════════════════════════════════
    if (dow === 5) {
      for (const emp of allEmployees) {
        rows.push({
          month_id: monthRow.id,
          employee_id: String(emp.id),
          date: dateISO,
          symbol: OFF,
          code: OFF
        });
      }
      continue;
    }
    
    const weekOffMap = weeklyOffDays.get(weekIndex) || new Map();
    const weekShiftMap = weeklyShifts.get(weekIndex) || new Map();
    
    // ═══════════════════════════════════════════════════════════════════
    // بناء السجلات
    // ═══════════════════════════════════════════════════════════════════
    for (const emp of allEmployees) {
      const empId = String(emp.id);
      let symbol: string;
      
      // 1. موظفة Between Shift (أولاً قبل أي شيء)
      if (betweenEmployee && empId === String(betweenEmployee.id)) {
        if (weekOffMap.get(empId) === dateISO) {
          symbol = OFF;
        } else if (vacationSet.has(`${empId}_${dateISO}`)) {
          symbol = VAC;
        } else {
          symbol = BETWEEN;
        }
      }
      // 2. Tooq Almaliki - مسائية دائماً (مقارنة بالاسم أيضاً)
      else if (empId === TOOQ_ID || emp.name.toLowerCase().includes('tooq')) {
        if (vacationSet.has(`${empId}_${dateISO}`)) {
          symbol = VAC;
        } else if (weekOffMap.get(empId) === dateISO) {
          symbol = OFF;
        } else {
          // دائماً مسائية
          symbol = getShiftSymbol(emp, "Evening");
        }
      }
      // 3. إجازة V
      else if (vacationSet.has(`${empId}_${dateISO}`)) {
        symbol = VAC;
      }
      // 4. OFF الأسبوعي
      else if (weekOffMap.get(empId) === dateISO) {
        symbol = OFF;
      }
      // 5. موظفة لها شفت محدد هذا الأسبوع
      else {
        const shift = weekShiftMap.get(empId); // weekShiftMap هو empWeeklyShift.get(empId)

        if (shift === "Morning") {
          symbol = getShiftSymbol(emp, "Morning");
        } else if (shift === "Evening") {
          symbol = getShiftSymbol(emp, "Evening");
        } else {
          // fallback - لا يجب أن يحدث
          console.warn(`[WARN] موظفة بدون شفت: ${emp.name} في ${dateISO}`);
          symbol = getShiftSymbol(emp, "Morning");
        }
      }
      
      rows.push({
        month_id: monthRow.id,
        employee_id: String(emp.id),
        date: dateISO,
        symbol,
        code: symbol
      });
    }
  }
  
  console.log(`[5] إجمالي السجلات: ${rows.length}`);

  // ═══════════════════════════════════════════════════════════════════════
  // الخطوة 6: التحقق من التغطية
  // ═══════════════════════════════════════════════════════════════════════
  
  console.log(`\n[6] التحقق من التغطية...`);
  
  const morningSymbols = Object.values(MORNING_SHIFTS);
  const eveningSymbols = Object.values(EVENING_SHIFTS);
  
  let issues = 0;
  
  for (const day of allDays) {
    const dateISO = format(day, "yyyy-MM-dd");
    if (getDay(day) === 5) continue;
    
    const dayRows = rows.filter(r => r.date === dateISO);
    const mCount = dayRows.filter(r => morningSymbols.includes(r.symbol)).length;
    const eCount = dayRows.filter(r => eveningSymbols.includes(r.symbol)).length;
    
    if (mCount !== settings.coverageMorning) {
      console.log(`    ⚠️ ${dateISO}: صباح=${mCount}/${settings.coverageMorning}`);
      issues++;
    }
    if (eCount !== settings.coverageEvening) {
      console.log(`    ⚠️ ${dateISO}: مساء=${eCount}/${settings.coverageEvening}`);
      issues++;
    }
  }
  
  if (issues === 0) {
    console.log(`    ✅ التغطية مطابقة للإعدادات!`);
  } else {
    console.log(`    ⚠️ ${issues} مشكلة في التغطية`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // الخطوة 7: الحفظ في قاعدة البيانات (فقط إذا لم يكن preview)
  // ═══════════════════════════════════════════════════════════════════════
  
  if (!preview) {
    console.log(`\n[7] الحفظ في قاعدة البيانات...`);
    
    await sb.from("assignments").delete().eq("month_id", monthRow.id);
    const { error: insertErr } = await sb.from("assignments").insert(rows);
    
    if (insertErr) throw insertErr;
    console.log(`    ✅ تم حفظ ${rows.length} سجل!`);
  } else {
    console.log(`\n[7] وضع Preview - لم يتم الحفظ في DB`);
  }

  // تحويل البيانات لصيغة مناسبة للعرض
  const assignmentsForDisplay = rows.map(r => ({
    employee_id: r.employee_id,
    date: r.date,
    symbol: r.symbol
  }));

  return {
    ok: true,
    preview,
    seed: actualSeed,
    month: {
      id: monthRow.id,
      year,
      month
    },
    employees: allEmployees.map(e => ({
      id: String(e.id),
      name: e.name,
      code: (e as any).code || null
    })),
    assignments: assignmentsForDisplay,
    debug: {
      totalEmployees: allEmployees.length,
      coverageMorning: settings.coverageMorning,
      coverageEvening: settings.coverageEvening,
      useBetweenShift: settings.useBetweenShift,
      betweenEmployee: betweenEmployee?.name || null,
      weeks: weeks.length,
      totalAssignments: rows.length,
      issues
    }
  };
}
