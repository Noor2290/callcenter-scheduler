// ═══════════════════════════════════════════════════════════════════════════
//  GENERATE SCHEDULE — v12.0 (PREVIEW + RANDOM SEED)
//  
//  ❗ هذا الملف يتبع التعليمات الرئيسية فقط - لا منطق قديم
//  
//  📌 التغطية من الإعدادات فقط (بدون defaults):
//     - Morning Coverage = بالضبط العدد المحدد (لا زيادة، لا نقصان)
//     - Evening Coverage = بالضبط العدد المحدد (لا زيادة، لا نقصان)
//  
//  📌 نظام طابور الدوران (Rotation Queue):
//     - طابور يحتوي كل الموظفات بترتيب عشوائي
//     - كل أسبوع: أول X للصباح، بعدهم Y للمساء
//     - بعد كل أسبوع: الموظفات اللاتي عملن ينتقلن لنهاية الطابور
//     - هذا يضمن: أسبوعين صباح + أسبوعين مساء لكل موظفة
//     - لا يتغير الشفت داخل الأسبوع مهما كانت حالات OFF
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

// حساب رقم الأسبوع (السبت = بداية الأسبوع)
function getWeekNumber(date: Date, monthStart: Date): number {
  const startDay = monthStart.getDay();
  const dayOfMonth = date.getDate();
  // حساب الأسبوع بناءً على السبت كبداية
  const adjustedDay = dayOfMonth + ((startDay + 1) % 7);
  return Math.ceil(adjustedDay / 7);
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
  seed
}: {
  year: number;
  month: number;
  preview?: boolean;  // true = لا يحفظ في DB
  seed?: number;      // seed عشوائي لتوليد جداول مختلفة
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
    betweenShiftEmployeeId: settingsMap['betweenShiftEmployeeId'] || null
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
  
  // تجميع الأيام حسب الأسبوع
  const weekDaysMap = new Map<number, Date[]>();
  for (const day of allDays) {
    const weekNum = getWeekNumber(day, monthStart);
    if (!weekDaysMap.has(weekNum)) weekDaysMap.set(weekNum, []);
    weekDaysMap.get(weekNum)!.push(day);
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
  
  // ═══════════════════════════════════════════════════════════════════
  // نظام طابور الدوران (Rotation Queue)
  // ═══════════════════════════════════════════════════════════════════
  // - طابور يحتوي كل الموظفات بترتيب عشوائي
  // - كل أسبوع: أول X للصباح، بعدهم Y للمساء
  // - بعد كل أسبوع: الموظفات اللاتي عملن ينتقلن لنهاية الطابور
  // - هذا يضمن: أسبوعين صباح + أسبوعين مساء لكل موظفة
  // ═══════════════════════════════════════════════════════════════════
  
  // خلط الموظفات باستخدام seed لتوليد توزيعات مختلفة
  let rotationQueue = shuffleWithSeed(regularEmployees, actualSeed);
  
  console.log(`    - عدد الموظفات في الطابور: ${rotationQueue.length}`);
  console.log(`    - التغطية المطلوبة: صباح=${settings.coverageMorning}, مساء=${settings.coverageEvening}`);
  
  // التحقق من أن عدد الموظفات كافٍ
  const totalNeeded = settings.coverageMorning + settings.coverageEvening;
  if (rotationQueue.length < totalNeeded) {
    console.warn(`    ⚠️ تحذير: عدد الموظفات (${rotationQueue.length}) أقل من المطلوب (${totalNeeded})`);
  }
  
  // بناء جدول الشفتات الأسبوعية
  // weekNum -> empId -> ShiftType
  const weeklyShifts = new Map<number, Map<string, ShiftType>>();
  
  // تتبع عدد أسابيع الصباح والمساء لكل موظفة (للتحقق)
  const empShiftCount = new Map<string, { morning: number; evening: number }>();
  for (const emp of regularEmployees) {
    empShiftCount.set(String(emp.id), { morning: 0, evening: 0 });
  }
  
  for (const weekNum of weeks) {
    const shiftMap = new Map<string, ShiftType>();
    weeklyShifts.set(weekNum, shiftMap);
    
    // اختيار موظفات الصباح (أول X من الطابور)
    const morningThisWeek = rotationQueue.slice(0, settings.coverageMorning);
    
    // اختيار موظفات المساء (بعد الصباح مباشرة)
    const eveningThisWeek = rotationQueue.slice(
      settings.coverageMorning, 
      settings.coverageMorning + settings.coverageEvening
    );
    
    // تعيين الشفتات
    for (const emp of morningThisWeek) {
      const empId = String(emp.id);
      shiftMap.set(empId, "Morning");
      const count = empShiftCount.get(empId)!;
      count.morning++;
    }
    
    for (const emp of eveningThisWeek) {
      const empId = String(emp.id);
      shiftMap.set(empId, "Evening");
      const count = empShiftCount.get(empId)!;
      count.evening++;
    }
    
    // الموظفات الزائدات (إن وجدن) لا يُعطين شفت هذا الأسبوع
    const workingThisWeek = [...morningThisWeek, ...eveningThisWeek];
    const notWorkingThisWeek = rotationQueue.slice(totalNeeded);
    
    console.log(`    - الأسبوع ${weekNum}: صباح=${morningThisWeek.length}, مساء=${eveningThisWeek.length}, بدون شفت=${notWorkingThisWeek.length}`);
    
    // ═══════════════════════════════════════════════════════════════════
    // تدوير الطابور: الموظفات اللاتي عملن ينتقلن لنهاية الطابور
    // ═══════════════════════════════════════════════════════════════════
    rotationQueue = [...notWorkingThisWeek, ...workingThisWeek];
  }
  
  // طباعة ملخص التوزيع لكل موظفة
  console.log(`\n    📊 ملخص التوزيع:`);
  for (const emp of regularEmployees) {
    const empId = String(emp.id);
    const count = empShiftCount.get(empId)!;
    console.log(`    - ${emp.name}: صباح=${count.morning} أسابيع, مساء=${count.evening} أسابيع`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // الخطوة 4: توزيع الإجازات الأسبوعية
  // ═══════════════════════════════════════════════════════════════════════
  
  console.log(`\n[4] توزيع الإجازات الأسبوعية...`);
  
  // weekNum -> empId -> dateISO
  const weeklyOffDays = new Map<number, Map<string, string>>();
  
  for (const weekNum of weeks) {
    const offMap = new Map<string, string>();
    weeklyOffDays.set(weekNum, offMap);
    
    const weekDays = weekDaysMap.get(weekNum) || [];
    // أيام العمل (بدون الجمعة)
    const workDays = weekDays.filter(d => getDay(d) !== 5);
    
    if (workDays.length === 0) continue;
    
    // تتبع عدد OFF لكل يوم
    const dayOffCount = new Map<string, number>();
    for (const d of workDays) {
      dayOffCount.set(format(d, "yyyy-MM-dd"), 0);
    }
    
    // جميع الموظفات (عادية + between)
    const allEmpsForOff = [...regularEmployees];
    if (betweenEmployee) allEmpsForOff.push(betweenEmployee);
    
    for (const emp of allEmpsForOff) {
      const empId = String(emp.id);
      
      // 1. التحقق من وجود طلب OFF مسبق
      for (const d of workDays) {
        const dateISO = format(d, "yyyy-MM-dd");
        if (offRequestSet.has(`${empId}_${dateISO}`)) {
          const count = dayOffCount.get(dateISO) || 0;
          if (count < MAX_OFF_PER_DAY) {
            offMap.set(empId, dateISO);
            dayOffCount.set(dateISO, count + 1);
            break;
          }
        }
      }
      if (offMap.has(empId)) continue;
      
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
      
      // 3. مروة: السبت OFF دائماً
      if (marwaId && empId === marwaId) {
        const saturday = workDays.find(d => getDay(d) === 6);
        if (saturday) {
          const dateISO = format(saturday, "yyyy-MM-dd");
          const count = dayOffCount.get(dateISO) || 0;
          if (count < MAX_OFF_PER_DAY) {
            offMap.set(empId, dateISO);
            dayOffCount.set(dateISO, count + 1);
            continue;
          }
        }
      }
      
      // 4. اختيار يوم OFF بأقل عدد إجازات
      let bestDay: string | null = null;
      let minCount = Infinity;
      
      for (const d of workDays) {
        const dateISO = format(d, "yyyy-MM-dd");
        const count = dayOffCount.get(dateISO) || 0;
        if (count < MAX_OFF_PER_DAY && count < minCount) {
          minCount = count;
          bestDay = dateISO;
        }
      }
      
      if (bestDay) {
        offMap.set(empId, bestDay);
        dayOffCount.set(bestDay, (dayOffCount.get(bestDay) || 0) + 1);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // الخطوة 5: بناء الجدول اليومي
  // ═══════════════════════════════════════════════════════════════════════
  
  console.log(`\n[5] بناء الجدول اليومي...`);
  
  const rows: DayAssignment[] = [];
  
  for (const day of allDays) {
    const dateISO = format(day, "yyyy-MM-dd");
    const dow = getDay(day);
    const weekNum = getWeekNumber(day, monthStart);
    
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
    
    const weekOffMap = weeklyOffDays.get(weekNum) || new Map();
    const weekShiftMap = weeklyShifts.get(weekNum) || new Map();
    
    // ═══════════════════════════════════════════════════════════════════
    // تحديد الموظفات المتاحات لكل شفت
    // ═══════════════════════════════════════════════════════════════════
    const availableMorning: Employee[] = [];
    const availableEvening: Employee[] = [];
    
    for (const emp of regularEmployees) {
      const empId = String(emp.id);
      
      // تخطي إذا إجازة أو OFF
      if (vacationSet.has(`${empId}_${dateISO}`)) continue;
      if (weekOffMap.get(empId) === dateISO) continue;
      
      const shift = weekShiftMap.get(empId);
      if (shift === "Morning") {
        availableMorning.push(emp);
      } else if (shift === "Evening") {
        availableEvening.push(emp);
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════
    // اختيار بالضبط العدد المطلوب
    // ═══════════════════════════════════════════════════════════════════
    const selectedMorning = availableMorning.slice(0, settings.coverageMorning);
    const selectedEvening = availableEvening.slice(0, settings.coverageEvening);
    
    const selectedMorningIds = new Set(selectedMorning.map(e => String(e.id)));
    const selectedEveningIds = new Set(selectedEvening.map(e => String(e.id)));
    
    // ═══════════════════════════════════════════════════════════════════
    // بناء السجلات
    // ═══════════════════════════════════════════════════════════════════
    for (const emp of allEmployees) {
      const empId = String(emp.id);
      let symbol: string;
      
      // 1. إجازة V
      if (vacationSet.has(`${empId}_${dateISO}`)) {
        symbol = VAC;
      }
      // 2. OFF الأسبوعي
      else if (weekOffMap.get(empId) === dateISO) {
        symbol = OFF;
      }
      // 3. موظفة Between Shift
      else if (betweenEmployee && empId === String(betweenEmployee.id)) {
        symbol = BETWEEN;
      }
      // 4. شفت صباح
      else if (selectedMorningIds.has(empId)) {
        symbol = getShiftSymbol(emp, "Morning");
      }
      // 5. شفت مساء
      else if (selectedEveningIds.has(empId)) {
        symbol = getShiftSymbol(emp, "Evening");
      }
      // 6. موظفة غير مختارة للتغطية (لا تعمل هذا اليوم)
      else {
        // هذه الموظفة ليست ضمن التغطية المطلوبة
        // لكن لا نعطيها OFF إضافي - تبقى بدون شفت
        const shift = weekShiftMap.get(empId);
        if (shift) {
          symbol = getShiftSymbol(emp, shift);
        } else {
          symbol = OFF;
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
