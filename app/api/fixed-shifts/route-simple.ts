import { NextResponse } from 'next/server';
import supabaseServer from '@/app/lib/supabaseServer';

export async function GET() {
  try {
    console.log('[API-SIMPLE] Fixed shifts GET called');
    const sb = supabaseServer();
    
    // Simple query without joins
    const { data, error } = await sb
      .from('fixed_shifts')
      .select('*');
    
    if (error) {
      console.error('[API-SIMPLE] Error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    console.log('[API-SIMPLE] Raw data:', data);
    
    // Return simple data without employee info for now
    return NextResponse.json({ 
      fixedShifts: data || [],
      employees: [] // We'll handle employees separately
    });
  } catch (e: any) {
    console.error('[API-SIMPLE] Exception:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
