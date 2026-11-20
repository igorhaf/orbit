export type ReportPeriodPreset = 'today' | 'last7' | 'week' | 'month' | 'last30' | 'all' | 'custom';
export type ReportDateRange = { from: string; through: string; periodMode: 'range' | 'all' };

const dateOnly = (value: Date) => `${String(value.getUTCFullYear()).padStart(4, '0')}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;

export function reportDateRange(preset: ReportPeriodPreset, now = new Date()): ReportDateRange | null {
  if (preset === 'custom') return null;
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const through = dateOnly(today);
  if (preset === 'all') return { from: '0001-01-01', through, periodMode: 'all' };

  const from = new Date(today);
  if (preset === 'week') from.setUTCDate(from.getUTCDate() - ((from.getUTCDay() + 6) % 7));
  else if (preset === 'month') from.setUTCDate(1);
  else if (preset === 'last7') from.setUTCDate(from.getUTCDate() - 6);
  else if (preset === 'last30') from.setUTCDate(from.getUTCDate() - 29);
  return { from: dateOnly(from), through, periodMode: 'range' };
}
