const STEP = 2;

// One light-pulse bump per beat: a quick rise, a fall, and a small second bump (the dicrotic notch) after it.
function pulseHeight(offset: number, scale: number): number {
  const width = offset < 0 ? 5 * scale : 13 * scale;
  const bump = Math.exp(-((offset / width) ** 2));
  const notch = 0.25 * Math.exp(-(((offset - 22 * scale) / (7 * scale)) ** 2));
  return bump + notch;
}

type PulseBox = { width: number; baseY: number; amplitude: number; scale?: number };

// Path of a fingertip light wave with one bump at each x in beatXs.
export function pulsePath(
  beatXs: readonly number[],
  { width, baseY, amplitude, scale = 1 }: PulseBox,
): string {
  const points: string[] = [];
  for (let x = 0; x <= width; x += STEP) {
    const lift = beatXs.reduce((sum, beatX) => sum + pulseHeight(x - beatX, scale), 0);
    points.push(
      `${points.length === 0 ? 'M' : 'L'}${x} ${(baseY - amplitude * Math.min(lift, 1.1)).toFixed(1)}`,
    );
  }
  return points.join(' ');
}

// Relative (x, height) corners of one ECG beat, 1 unit wide: P wave, sharp QRS, T wave.
const ecgBeat: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.1, 0],
  [0.16, 0.14],
  [0.22, 0],
  [0.34, 0],
  [0.38, -0.12],
  [0.42, 1],
  [0.46, -0.28],
  [0.5, 0],
  [0.62, 0],
  [0.7, 0.24],
  [0.78, 0],
  [1, 0],
];

// Path of an ECG trace with beatCount beats across width.
export function ecgPath({
  width,
  baseY,
  amplitude,
  beatCount,
}: {
  width: number;
  baseY: number;
  amplitude: number;
  beatCount: number;
}): string {
  const beatWidth = width / beatCount;
  return Array.from({ length: beatCount }, (_, beat) =>
    ecgBeat.map(
      ([x, height]) =>
        `${(beat * beatWidth + x * beatWidth).toFixed(1)} ${(baseY - amplitude * height).toFixed(1)}`,
    ),
  )
    .flat()
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point}`)
    .join(' ');
}
