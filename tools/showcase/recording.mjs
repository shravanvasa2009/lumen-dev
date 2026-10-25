import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Showcase recordings: ReplayCapture's RecordedCapture plus `motion`, the stretches when the person moved,
// in seconds from the first frame. Lab captures carry no accelerometer stream, so these stretches stand in
// for it; scanSource.ts plays them as motionRms in the status events.
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const RECORDINGS_DIR = path.join(REPO_ROOT, 'apps', 'mobile', 'src', 'showcase', 'recordings');

// Decimal places kept per column. Red carries the pulse (a few thousandths of full scale on a Galaxy A17),
// so it keeps the most; the bundle holds four recordings, so the rest are trimmed.
const PLACES = { r: 6, g: 4, b: 4, spatialStdR: 5, clipFrac: 5 };

const rounded = (values, places) => values.map((value) => Number(value.toFixed(places)));

export function compactRecording({ capabilities, samples, stats, motion, slip, origin }) {
  return {
    origin,
    capabilities,
    motion,
    slip,
    samples: {
      tNs: samples.tNs.map(Math.round),
      r: rounded(samples.r, PLACES.r),
      g: rounded(samples.g, PLACES.g),
      b: rounded(samples.b, PLACES.b),
    },
    stats: {
      tNs: stats.tNs.map(Math.round),
      spatialStdR: rounded(stats.spatialStdR, PLACES.spatialStdR),
      clipFrac: rounded(stats.clipFrac, PLACES.clipFrac),
      exposureNs: stats.exposureNs.map(Math.round),
    },
  };
}

export function writeRecording(name, recording) {
  if (!/^[a-z0-9-]+$/.test(name))
    throw new Error(`recording name "${name}" must be lowercase letters, digits, -`);
  const file = path.join(RECORDINGS_DIR, `${name}.json`);
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(compactRecording(recording))}\n`);
  const seconds = (recording.samples.tNs.at(-1) - recording.samples.tNs[0]) / 1e9;
  console.log(
    `wrote ${path.relative(REPO_ROOT, file)}: ${recording.samples.tNs.length} frames, ${seconds.toFixed(1)} s, ` +
      `${Math.round(fs.statSync(file).size / 1024)} KB`,
  );
  return file;
}

export function readRecording(nameOrFile) {
  const file = fs.existsSync(nameOrFile) ? nameOrFile : path.join(RECORDINGS_DIR, `${nameOrFile}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// "20-24,45-49" → [{ fromS: 20, toS: 24 }, { fromS: 45, toS: 49 }]
export function parseSpans(text) {
  if (!text) return [];
  return text.split(',').map((part) => {
    const match = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(part.trim());
    if (!match) throw new Error(`"${part}" is not a span like 20-24 (seconds)`);
    const [fromS, toS] = [Number(match[1]), Number(match[2])];
    if (!(toS > fromS)) throw new Error(`span ${part} must end after it starts`);
    return { fromS, toS };
  });
}

export function medianIntervalNs(tNs) {
  const gaps = tNs
    .slice(1)
    .map((t, i) => t - tNs[i])
    .sort((x, y) => x - y);
  return gaps[gaps.length >> 1];
}
