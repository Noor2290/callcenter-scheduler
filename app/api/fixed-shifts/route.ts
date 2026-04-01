import { NextResponse } from 'next/server';
import supabaseServer from '@/app/lib/supabaseServer';

export async function GET() {
  try {
    console.log('[API] Fixed shifts GET called');
    const sb = supabaseServer();
    
    // Very simple query - just get the raw data
    const { data, error } = await sb
      .from('fixed_shifts')
      .select('id, employee_id, shift_type');
    
    if (error) {
      console.error('[API] Error fetching fixed shifts:', error);
      // If table doesn't exist, return empty
      if (error.message?.includes('does not exist')) {
        console.log('[API] Table does not exist, returning empty');
        return NextResponse.json({ fixedShifts: [] });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    console.log('[API] Raw data:', data);
    
    // Return data without employee info for now
    const fixedShifts = (data || []).map(item => ({
      id: item.id,
      employee_id: item.employee_id,
      shift_type: item.shift_type,
      employee: null // We'll handle this in the frontend
    }));
    
    console.log('[API] Transformed fixed shifts:', fixedShifts);
    return NextResponse.json({ fixedShifts });
  } catch (e: any) {
    console.error('[API] GET fixed shifts error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
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
    
    // Simple insert
    const { data, error } = await sb
      .from('fixed_shifts')
      .upsert({ employee_id, shift_type }, { onConflict: 'employee_id' })
      .select('id, employee_id, shift_type')
      .single();

    if (error) {
      console.error('[API] Error upserting fixed shift:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log('[API] Fixed shift created/updated:', data);

    return NextResponse.json({ 
      fixedShift: {
        id: data.id,
        employee_id: data.employee_id,
        shift_type: data.shift_type,
        employee: null // We'll handle this in frontend
      }
    });
  } catch (e: any) {
    console.error('[API] POST fixed shifts error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
