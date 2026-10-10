// Shapes for the rhythm chapter's pictures. They illustrate the idea with fixed numbers; none is a measurement.

export type BeatShape = {
  baseline: number;
  // Height of the main peak above the baseline, and of the softer bump that follows it, in drawing units.
  peak: number;
  bump: number;
  // Distance from the peak to the bump, and the widths (standard deviations) of each, in drawing units.
  bumpOffset: number;
  peakWidth: number;
  bumpWidth: number;
};

const gauss = (distance: number, width: number) => Math.exp(-(distance * distance) / (2 * width * width));

export function pulsePath(peakXs: readonly number[], shape: BeatShape, width: number, step: number): string {
  const points: string[] = [];
  for (let x = 0; x <= width + 1e-6; x += step) {
    let lift = 0;
    for (const peakX of peakXs) {
      lift +=
        shape.peak * gauss(x - peakX, shape.peakWidth) +
        shape.bump * gauss(x - peakX - shape.bumpOffset, shape.bumpWidth);
    }
    points.push(`${points.length === 0 ? 'M' : 'L'}${x.toFixed(2)} ${(shape.baseline - lift).toFixed(2)}`);
  }
  return points.join(' ');
}

// Beat positions for gaps in milliseconds, laid out left to right.
export function peakPositions(gapsMs: readonly number[], firstX: number, pxPerMs: number): number[] {
  const xs = [firstX];
  for (const gap of gapsMs) xs.push(xs[xs.length - 1]! + gap * pxPerMs);
  return xs;
}

export const steadyGapsMs = [935, 948, 922, 940, 931, 952] as const;
export const irregularGapsMs = [640, 1120, 780, 1010, 590, 1180] as const;

// Each dot of a rhythm map pairs one gap with the next.
export function gapPairs(gapsMs: readonly number[]): (readonly [number, number])[] {
  return gapsMs.slice(0, -1).map((gap, index) => [gap, gapsMs[index + 1]!] as const);
}

export const steadyMapGapsMs = [935, 948, 922, 940, 931, 952, 938, 927, 945, 933, 941, 929, 950] as const;
export const irregularMapGapsMs = [
  640, 1120, 780, 1010, 590, 1180, 860, 700, 1040, 620, 1150, 820, 960,
] as const;
// A normal rhythm with one early beat: the short gap is followed by a long one, then it settles again.
export const extraBeatMapGapsMs = [935, 940, 600, 1270, 930, 945, 938, 590, 1285, 935, 942, 928] as const;

// Maps a gap to a position along one axis of a rhythm map, inside an inset square.
export function mapAxis(gapMs: number, lowMs: number, highMs: number, size: number, inset: number): number {
  return inset + ((gapMs - lowMs) / (highMs - lowMs)) * (size - 2 * inset);
}
