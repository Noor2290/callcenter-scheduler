import { NextRequest, NextResponse } from 'next/server';
import supabaseServer from '@/app/lib/supabaseServer';

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const sb = supabaseServer();
    
    const { error } = await sb
      .from('fixed_shifts')
      .delete()
      .eq('id', id);
      
    if (error) throw error;
    
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Failed to delete fixed shift' }, { status: 500 });
  }
}
