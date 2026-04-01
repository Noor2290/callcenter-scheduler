import { NextResponse } from 'next/server';
import supabaseServer from '@/app/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MONTH_NAMES_AR: Record<number, string> = {
  1: 'يناير', 2: 'فبراير', 3: 'مارس', 4: 'أبريل',
  5: 'مايو', 6: 'يونيو', 7: 'يوليو', 8: 'أغسطس',
  9: 'سبتمبر', 10: 'أكتوبر', 11: 'نوفمبر', 12: 'ديسمبر'
};

export async function GET() {
  try {
    const sb = supabaseServer();

    const { data: months, error } = await sb
      .from('months')
      .select('id, year, month')
      .order('year', { ascending: false })
      .order('month', { ascending: false });

    if (error) throw error;

    if (!months || months.length === 0) {
      return NextResponse.json({ schedules: [] });
    }

    // حساب عدد الـ assignments لكل شهر
    const schedules = await Promise.all(
      months.map(async (m) => {
        const { count } = await sb
          .from('assignments')
          .select('*', { count: 'exact', head: true })
          .eq('month_id', m.id);

        return {
          id: m.id,
          year: m.year,
          month: m.month,
          monthNameAr: MONTH_NAMES_AR[m.month] || `شهر ${m.month}`,
          assignmentsCount: count ?? 0,
        };
      })
    );

    // فلترة الشهور التي فيها assignments فقط
    const nonEmpty = schedules.filter(s => s.assignmentsCount > 0);

    return NextResponse.json({ schedules: nonEmpty });
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message ?? 'Unknown error' },
      { status: 500 }
    );
  }
}
