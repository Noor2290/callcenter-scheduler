import { NextResponse } from 'next/server';
import supabaseServer from '@/app/lib/supabaseServer';

export async function GET() {
  try {
    const sb = supabaseServer();
    const { data, error } = await sb
      .from('fixed_shifts')
      .select(`
        id,
        employee_id,
        shift_type,
        employees(id, name, code)
      `)
      .order('employees(name)', { ascending: true });

    if (error) throw error;

    // Transform data to include employee info
    const fixedShifts = (data || []).map(item => ({
      id: item.id,
      employee_id: item.employee_id,
      shift_type: item.shift_type,
      employee: item.employees
    }));

    return NextResponse.json({ fixedShifts });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Failed to fetch fixed shifts' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { employee_id, shift_type } = body;

    if (!employee_id || !shift_type) {
      return NextResponse.json({ error: 'employee_id and shift_type are required' }, { status: 400 });
    }

    if (!['Morning', 'Evening'].includes(shift_type)) {
      return NextResponse.json({ error: 'shift_type must be Morning or Evening' }, { status: 400 });
    }

    const sb = supabaseServer();
    const { data, error } = await sb
      .from('fixed_shifts')
      .upsert({ employee_id, shift_type }, { onConflict: 'employee_id' })
      .select(`
        id,
        employee_id,
        shift_type,
        employees(id, name, code)
      `)
      .single();

    if (error) throw error;

    return NextResponse.json({ 
      fixedShift: {
        id: data.id,
        employee_id: data.employee_id,
        shift_type: data.shift_type,
        employee: data.employees
      }
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Failed to set fixed shift' }, { status: 500 });
  }
}
