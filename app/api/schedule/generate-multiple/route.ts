import { NextRequest, NextResponse } from 'next/server';
import { generateSchedule } from '@/app/lib/scheduler';
import supabaseServer from '@/app/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ScheduleResult {
  schedule: {
    ok: boolean;
    monthId: string;
    year: number;
    month: number;
  };
  score: number;
  seed: string | number;
  assignments: Array<{
    month_id: string;
    employee_id: string;
    date: string;
    symbol: string;
    code: string;
  }>;
}

// Function to evaluate schedule quality (higher is better)
function evaluateSchedule(schedule: any, employees: any[]): number {
  let score = 0;
  
  // Track consecutive shifts to avoid long stretches
  const consecutiveShifts = new Map<string, number>();
  const consecutiveDays = new Map<string, number>();
  
  // Check for balanced workload
  const workload = new Map<string, number>();
  
  // Check for fairness in shift distribution
  const shiftCounts = {
    Morning: 0,
    Evening: 0
  };
  
  // Add points for each scheduled shift
  for (const emp of employees) {
    const empShifts = schedule.filter((s: any) => s.employee_id === emp.id);
    
    // Track consecutive shifts
    let currentStreak = 0;
    for (let i = 1; i < empShifts.length; i++) {
      if (empShifts[i].shift === empShifts[i-1].shift) {
        currentStreak++;
      } else {
        currentStreak = 0;
      }
      
      // Penalize long streaks of the same shift
      if (currentStreak > 2) {
        score -= 5 * (currentStreak - 2);
      }
    }
    
    // Track workload balance
    const empWorkload = empShifts.filter((s: any) => s.symbol !== 'O' && s.symbol !== 'V').length;
    const avgWorkload = employees.reduce((sum, e) => {
      const shifts = schedule.filter((s: any) => s.employee_id === e.id && s.symbol !== 'O' && s.symbol !== 'V').length;
      return sum + shifts;
    }, 0) / employees.length;
    
    // Reward schedules with balanced workloads
    score += 10 - Math.abs(empWorkload - avgWorkload);
  }
  
  return score;
}

export async function POST(req: NextRequest) {
  try {
    const started = Date.now();
    const sb = supabaseServer();
    
    // Get request parameters
    const { count = 3, ...options } = await req.json();
    const numSchedules = Math.min(Number(count) || 3, 10); // Max 10 schedules to avoid overloading
    
    // Get current settings
    const { data } = await sb.from('settings').select('key,value');
    const map = Object.fromEntries((data ?? []).map((r: any) => [r.key, r.value]));
    const year = options.year ?? (map.year ? Number(map.year) : new Date().getFullYear());
    const month = options.month ?? (map.month ? Number(map.month) : new Date().getMonth() + 1);
    const useBetween = options.useBetween ?? ((map.useBetweenShift ?? map.useBetween) === 'true' || false);
    
    if (!year || !month) {
      return NextResponse.json({ error: 'Year and month are required' }, { status: 400 });
    }
    
    // Load employees for evaluation
    const { data: employees } = await sb
      .from('employees')
      .select('id, name, employment_type, allowed_shifts, preferred_days_off');
    
    if (!employees) {
      return NextResponse.json({ error: 'Failed to load employees' }, { status: 500 });
    }
    
    // Generate multiple schedules with different random seeds
    const results: ScheduleResult[] = [];
    const seenSeeds = new Set<string>();
    
    // First try with the current timestamp as seed
    const baseSeed = Date.now().toString();
    
    // Generate schedules in parallel with different seeds
    const generationPromises = Array.from({ length: numSchedules * 2 }, (_, i) => {
      const seed = `${baseSeed}-${i}`;
      return generateSchedule({
        year,
        month,
        useBetween,
        seed,
        invertFirstWeek: options.invertFirstWeek,
      })
        .then(async (result: any) => {
          if (!result || !result.ok) return null;
          
          // Get the month_id from the assignments
          const monthId = result.monthId || (await sb
            .from('months')
            .select('id')
            .eq('year', year)
            .eq('month', month)
            .single())?.data?.id;
            
          if (!monthId) return null;
          
          // Load the generated schedule for evaluation
          const { data: schedule } = await sb
            .from('assignments')
            .select('*')
            .eq('month_id', monthId);
            
          if (!schedule) return null;
          
          const score = evaluateSchedule(schedule, employees);
          
          return {
            schedule: result,
            score,
            seed,
            assignments: schedule
          };
        })
        .catch(() => null);
    });
    
    // Wait for all generations to complete
    const allResults = await Promise.all(generationPromises);
    
    // Filter out failed generations and get top N unique schedules
    const validResults = allResults
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => b.score - a.score) // Sort by score descending
      .slice(0, numSchedules); // Take top N
    
    const durationMs = Date.now() - started;
    
    return NextResponse.json({
      count: validResults.length,
      schedules: validResults,
      durationMs,
    });
    
  } catch (e: any) {
    console.error('Error generating multiple schedules:', e);
    return NextResponse.json(
      { error: e.message || 'Failed to generate schedules' },
      { status: 500 }
    );
  }
}
