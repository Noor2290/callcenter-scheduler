import { NextResponse } from 'next/server';
import supabaseServer from '@/app/lib/supabaseServer';

export async function GET() {
  try {
    console.log('[API] Fixed shifts GET called');
    const sb = supabaseServer();
    
    // Very simple query - just get the raw data
    const { data, error } = await sb
      .from('fixed_shifts')
      .select('id, employee_id, shift_type, start_date, end_date');
    
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
    
    // Return data with dates
    const fixedShifts = (data || []).map(item => ({
      id: item.id,
      employee_id: item.employee_id,
      shift_type: item.shift_type,
      start_date: item.start_date,
      end_date: item.end_date,
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
    const { employee_id, shift_type, start_date, end_date } = body;
    console.log('[API] Request body:', { employee_id, shift_type, start_date, end_date });

    const sb = supabaseServer();

    // Validate required fields
    if (!employee_id || !shift_type) {
      return NextResponse.json({ error: 'employee_id and shift_type are required' }, { status: 400 });
    }

    if (!['Morning', 'Evening'].includes(shift_type)) {
      return NextResponse.json({ error: 'shift_type must be Morning or Evening' }, { status: 400 });
    }

    // Date range is now REQUIRED (no permanent fixed shifts)
    if (!start_date || !end_date) {
      return NextResponse.json({ error: 'يجب تحديد تاريخ البداية والنهاية - Both start_date and end_date are required' }, { status: 400 });
    }

    if (new Date(start_date) > new Date(end_date)) {
      return NextResponse.json({ error: 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية - end_date must be >= start_date' }, { status: 400 });
    }

    // Check for overlapping periods for the same employee
    const { data: existingShifts, error: checkError } = await sb
      .from('fixed_shifts')
      .select('id, start_date, end_date')
      .eq('employee_id', employee_id);

    if (checkError) {
      console.error('[API] Error checking existing shifts:', checkError);
      return NextResponse.json({ error: checkError.message }, { status: 500 });
    }

    // Check for overlaps
    const hasOverlap = existingShifts?.some(existing => {
      if (!existing.start_date || !existing.end_date) return false;
      
      const existingStart = new Date(existing.start_date);
      const existingEnd = new Date(existing.end_date);
      const newStart = new Date(start_date);
      const newEnd = new Date(end_date);

      // Check if periods overlap
      return (newStart <= existingEnd && newEnd >= existingStart);
    });

    if (hasOverlap) {
      return NextResponse.json({ 
        error: 'يوجد تداخل مع فترة تثبيت أخرى لنفس الموظف - Overlapping period detected for this employee' 
      }, { status: 400 });
    }
    
    // Prepare data for insert (dates are required)
    const fixedShiftData = {
      employee_id,
      shift_type,
      start_date,
      end_date
    };

    // Simple insert (allow multiple fixed shifts per employee with different date ranges)
    const { data, error } = await sb
      .from('fixed_shifts')
      .insert(fixedShiftData)
      .select('id, employee_id, shift_type, start_date, end_date')
      .single();

    if (error) {
      console.error('[API] Error inserting fixed shift:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log('[API] Fixed shift created:', data);

    return NextResponse.json({ 
      fixedShift: {
        id: data.id,
        employee_id: data.employee_id,
        shift_type: data.shift_type,
        start_date: data.start_date,
        end_date: data.end_date,
        employee: null // We'll handle this in frontend
      }
    });
  } catch (e: any) {
    console.error('[API] POST fixed shifts error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
