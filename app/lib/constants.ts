export const FIXED_RULES = {
  fridayOff: true,
  randomWeeklyOff: true,
  seed: 42,
} as const;

export type EmploymentType = 'FullTime' | 'PartTime' | 'Trainee';
export type ShiftName = 'Morning' | 'Evening';

export const SHIFT_SYMBOL: Record<EmploymentType, Record<ShiftName, string>> = {
  FullTime: { Morning: 'MA1', Evening: 'EA1' },
  PartTime: { Morning: 'PT4', Evening: 'PT5' },
  Trainee: { Morning: 'M2', Evening: 'E2' },
};

export const SPECIAL_SYMBOL = {
  Off: 'O',
  Vacation: 'V',
} as const;
