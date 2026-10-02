export type DayPeriod = 'morning' | 'afternoon' | 'evening';

export function dayPeriod(hour: number): DayPeriod {
  if (hour < 12) return 'morning';
  return hour < 18 ? 'afternoon' : 'evening';
}

// "Sunday, Sep 27" in the app language, not the phone's region.
export function dateLine(date: Date, language: string): string {
  return date.toLocaleDateString(language, { weekday: 'long', month: 'short', day: 'numeric' });
}

export function readingMoment(takenAt: number, now: Date, language: string) {
  const taken = new Date(takenAt);
  return {
    today: taken.toDateString() === now.toDateString(),
    date: taken.toLocaleDateString(language, { month: 'short', day: 'numeric' }),
    time: taken.toLocaleTimeString(language, { hour: 'numeric', minute: '2-digit' }),
  };
}
