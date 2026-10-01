// Numbers come from evidence.json; this only turns them into text in the app language.
export function formatNumber(value: number, language: string, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat(language, { maximumFractionDigits }).format(value);
}

// A rate under one percent reads "<1%" so a small but real rate is never shown as zero.
export function formatPercent(fraction: number, language: string): string {
  const format = new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 0 });
  return fraction > 0 && fraction < 0.005 ? `<${format.format(0.01)}` : format.format(fraction);
}

// The file's date is a calendar date, so it is read in UTC to keep the day the same in every time zone.
export function formatDate(isoDate: string, language: string): string | null {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    parsed,
  );
}
