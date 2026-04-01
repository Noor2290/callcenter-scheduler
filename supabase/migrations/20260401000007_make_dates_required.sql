-- Make start_date and end_date required (NOT NULL) in fixed_shifts
-- This enforces that all fixed shifts must have a specific time period

-- 1. First, delete any existing records without dates (if any exist from old system)
DELETE FROM public.fixed_shifts 
WHERE start_date IS NULL OR end_date IS NULL;

-- 2. Drop the old constraint
ALTER TABLE public.fixed_shifts
DROP CONSTRAINT IF EXISTS check_date_range;

-- 3. Make the columns NOT NULL
ALTER TABLE public.fixed_shifts
ALTER COLUMN start_date SET NOT NULL,
ALTER COLUMN end_date SET NOT NULL;

-- 4. Add the check constraint again (dates must be valid)
ALTER TABLE public.fixed_shifts
ADD CONSTRAINT check_date_range CHECK (end_date >= start_date);

-- 5. Update comments
COMMENT ON COLUMN public.fixed_shifts.start_date IS 'Start date for fixed shift (REQUIRED - all shifts must have a specific period)';
COMMENT ON COLUMN public.fixed_shifts.end_date IS 'End date for fixed shift (REQUIRED - all shifts must have a specific period)';

-- 6. Reload schema cache
NOTIFY pgrst, 'reload schema';
