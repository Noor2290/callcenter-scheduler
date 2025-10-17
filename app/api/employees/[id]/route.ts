import { NextRequest, NextResponse } from 'next/server';
import supabaseServer from '@/app/lib/supabaseServer';

type Employee = {
  id: string;
  name?: string;
  code?: string;
  employment_type?: string;
  allowed_shifts?: string[];
  preferred_days_off?: string[];
};

// Strongly-typed partial update payload
type EmployeeUpdates = Partial<Pick<Employee,
  'name' | 'code' | 'employment_type' | 'allowed_shifts' | 'preferred_days_off'
>>;

export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const sb = supabaseServer();
    const { error } = await sb.from('employees').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Unknown error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await req.json();
    const updates: EmployeeUpdates = {};
    const fields = ['name', 'code', 'employment_type', 'allowed_shifts', 'preferred_days_off'] as const;
    for (const f of fields) {
      if (f in body && body[f] !== undefined) updates[f] = body[f];
    }
    if (Object.keys(updates).length === 0) return NextResponse.json({ ok: true });
    const sb = supabaseServer();
    const { error } = await (sb as any)
      .from('employees')
      .update(updates)
      .eq('id', id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Unknown error' }, { status: 500 });
  }
}
