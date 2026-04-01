-- Create table for fixed shifts assignments
CREATE TABLE IF NOT EXISTS fixed_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  shift_type VARCHAR(10) NOT NULL CHECK (shift_type IN ('Morning', 'Evening')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id) -- Each employee can have only one fixed shift
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_fixed_shifts_employee_id ON fixed_shifts(employee_id);

-- Create index for shift type lookups
CREATE INDEX IF NOT EXISTS idx_fixed_shifts_shift_type ON fixed_shifts(shift_type);

-- RLS policies
ALTER TABLE fixed_shifts ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read fixed shifts
CREATE POLICY "Fixed shifts are viewable by authenticated users" ON fixed_shifts
  FOR SELECT USING (auth.role() = 'authenticated');

-- Allow authenticated users to manage fixed shifts
CREATE POLICY "Fixed shifts are manageable by authenticated users" ON fixed_shifts
  FOR ALL USING (auth.role() = 'authenticated');

-- Update trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_fixed_shifts_updated_at
  BEFORE UPDATE ON fixed_shifts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
