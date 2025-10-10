import { NextRequest, NextResponse } from 'next/server';
import supabaseServer from '@/app/lib/supabaseServer';

export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const sb = supabaseServer();
    const { error } = await sb.from('requests').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Unknown error' }, { status: 500 });
  }
}