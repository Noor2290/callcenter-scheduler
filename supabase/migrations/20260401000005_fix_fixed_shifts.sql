-- Fix fixed_shifts table and schema cache issue

-- 1. حذف الجدول القديم إذا كان موجودًا
DROP TABLE IF EXISTS public.fixed_shifts CASCADE;

-- 2. إنشاء الجدول في public schema بشكل صحيح
CREATE TABLE public.fixed_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  shift_type VARCHAR(10) NOT NULL CHECK (shift_type IN ('Morning', 'Evening')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id)
);

-- 3. إنشاء الفهارس
CREATE INDEX idx_fixed_shifts_employee_id ON public.fixed_shifts(employee_id);
CREATE INDEX idx_fixed_shifts_shift_type ON public.fixed_shifts(shift_type);

-- 4. تفعيل Row Level Security
ALTER TABLE public.fixed_shifts ENABLE ROW LEVEL SECURITY;

-- 5. إضافة policies بسيطة للسماح بكل العمليات
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.fixed_shifts;
CREATE POLICY "Allow all for authenticated users"
  ON public.fixed_shifts
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- 6. إنشاء trigger للـ updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_fixed_shifts_updated_at ON public.fixed_shifts;
CREATE TRIGGER update_fixed_shifts_updated_at
  BEFORE UPDATE ON public.fixed_shifts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 7. تحديث schema cache (مهم جداً!)
NOTIFY pgrst, 'reload schema';

-- 8. التحقق من إنشاء الجدول
SELECT 
  table_schema, 
  table_name, 
  table_type 
FROM information_schema.tables 
WHERE table_name = 'fixed_shifts';
