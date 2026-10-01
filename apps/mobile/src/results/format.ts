export function formatClock(moment: Date, language: string): string {
  return new Intl.DateTimeFormat(language, { hour: 'numeric', minute: '2-digit' }).format(moment);
}

export function formatDay(moment: Date, language: string): string {
  return new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric' }).format(moment);
}

export function isSameDay(first: Date, second: Date): boolean {
  return first.toDateString() === second.toDateString();
}
