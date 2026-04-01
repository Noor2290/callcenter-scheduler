-- Add date range support to fixed_shifts for temporary shift fixing

-- 1. Add start_date and end_date columns
ALTER TABLE public.fixed_shifts
ADD COLUMN IF NOT EXISTS start_date DATE,
ADD COLUMN IF NOT EXISTS end_date DATE;

-- 2. Add check constraint to ensure end_date >= start_date
ALTER TABLE public.fixed_shifts
ADD CONSTRAINT check_date_range CHECK (
  (start_date IS NULL AND end_date IS NULL) OR 
  (start_date IS NOT NULL AND end_date IS NOT NULL AND end_date >= start_date)
);

-- 3. Create index for date queries
CREATE INDEX IF NOT EXISTS idx_fixed_shifts_date_range ON public.fixed_shifts(start_date, end_date);

-- 4. Comment for documentation
COMMENT ON COLUMN public.fixed_shifts.start_date IS 'Start date for temporary fixed shift (NULL for permanent)';
COMMENT ON COLUMN public.fixed_shifts.end_date IS 'End date for temporary fixed shift (NULL for permanent)';

-- 5. Update schema cache
NOTIFY pgrst, 'reload schema';
