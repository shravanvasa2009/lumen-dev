// In memory only, never in the URL: a deep link must not be able to switch the safety question off. Set by
// Processing when it has just asked the question for a reading, cleared once that reading's Results has
// opened, so a later visit to the same reading (from History) asks again.
let askedFor: string | null = null;

export function markSymptomsAsked(readingId: string): void {
  askedFor = readingId;
}

export function symptomsAskedFor(readingId: string): boolean {
  return askedFor === readingId;
}

export function clearSymptomsAsked(readingId: string): void {
  if (askedFor === readingId) askedFor = null;
}
