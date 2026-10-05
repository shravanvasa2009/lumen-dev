export function formatClock(moment: Date, language: string): string {
  return new Intl.DateTimeFormat(language, { hour: 'numeric', minute: '2-digit' }).format(moment);
}

export function formatDay(moment: Date, language: string): string {
  return new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric' }).format(moment);
}

// Rates such as extra beats per minute read at one decimal, the precision the demo readings use.
export function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}
