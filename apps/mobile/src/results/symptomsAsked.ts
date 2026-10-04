// In memory only, never in the URL: a deep link must not be able to switch the safety question off. Set by
// Processing when it has just asked the question for a reading, cleared when that reading's Results opens or
// its route unmounts, so a mark only serves the visit right after Processing and a later visit asks again.
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
