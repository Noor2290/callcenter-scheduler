import { NextResponse } from 'next/server';
import supabaseServer from '@/app/lib/supabaseServer';

export async function GET() {
  try {
    console.log('[API] Fixed shifts GET called');
    const sb = supabaseServer();
    
    // First check if table exists
    const { data: tableCheck, error: tableError } = await sb
      .from('fixed_shifts')
      .select('id')
      .limit(1);
    
    if (tableError) {
      console.error('[API] Table fixed_shifts does not exist:', tableError);
      // Return empty result if table doesn't exist
      return NextResponse.json({ fixedShifts: [] });
    }
    
    console.log('[API] Table exists, fetching data...');
    const { data, error } = await sb
      .from('fixed_shifts')
      .select(`
        id,
        employee_id,
        shift_type,
        employees(id, name, code)
      `)
      .order('employees(name)', { ascending: true });

    if (error) {
      console.error('[API] Error fetching fixed shifts:', error);
      throw error;
    }

    console.log('[API] Raw data:', data);

    // Transform data to include employee info
    const fixedShifts = (data || []).map(item => ({
      id: item.id,
      employee_id: item.employee_id,
      shift_type: item.shift_type,
      employee: item.employees
    }));

    console.log('[API] Transformed fixed shifts:', fixedShifts);
    return NextResponse.json({ fixedShifts });
  } catch (e: any) {
    console.error('[API] GET fixed shifts error:', e);
    return NextResponse.json({ error: e.message ?? 'Failed to fetch fixed shifts' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    console.log('[API] Fixed shifts POST called');
    const body = await req.json();
    const { employee_id, shift_type } = body;
    console.log('[API] Request body:', { employee_id, shift_type });

    if (!employee_id || !shift_type) {
      return NextResponse.json({ error: 'employee_id and shift_type are required' }, { status: 400 });
    }

    if (!['Morning', 'Evening'].includes(shift_type)) {
      return NextResponse.json({ error: 'shift_type must be Morning or Evening' }, { status: 400 });
    }

    const sb = supabaseServer();
    
    // Check if table exists first
    const { error: tableError } = await sb
      .from('fixed_shifts')
      .select('id')
      .limit(1);
    
    if (tableError) {
      console.error('[API] Table fixed_shifts does not exist:', tableError);
      return NextResponse.json({ error: 'Table fixed_shifts does not exist. Please run the migration first.' }, { status: 500 });
    }
    
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

    if (error) {
      console.error('[API] Error upserting fixed shift:', error);
      throw error;
    }

    console.log('[API] Fixed shift created/updated:', data);

    return NextResponse.json({ 
      fixedShift: {
        id: data.id,
        employee_id: data.employee_id,
        shift_type: data.shift_type,
        employee: data.employees
      }
    });
  } catch (e: any) {
    console.error('[API] POST fixed shifts error:', e);
    return NextResponse.json({ error: e.message ?? 'Failed to set fixed shift' }, { status: 500 });
  }
}
