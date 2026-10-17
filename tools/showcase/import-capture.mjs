import fs from 'node:fs';
import path from 'node:path';

import { medianIntervalNs, parseSpans, writeRecording } from './recording.mjs';

// node tools/showcase/import-capture.mjs <capture folder> --name shravan-scan
//     [--from 3 --to 115] [--segment 3-40 --segment 52-118 --segment other-folder@10-20]
//     [--motion 20-24,45-49,70-74]
// Turns a capture-receiver folder (samples.csv, stats.csv, meta.json) into a showcase recording at
// apps/mobile/src/showcase/recordings/<name>.json.
// --from/--to keep one stretch, in seconds from the capture's first frame. Each --segment keeps a stretch,
// optionally from another capture folder, and the stretches are joined in order: each starts one frame
// interval after the last one ended, so the replay never sees a gap. --motion marks the stretches, in
// seconds of the output, when the person moved (the Lab capture has no accelerometer stream); the replay
// reports motion there, so the live session rejects them with "Hold still".

const argv = process.argv.slice(2);
const values = (name) =>
  argv.flatMap((arg, i) => (arg === name && argv[i + 1] !== undefined ? [argv[i + 1]] : []));
const single = (name) => values(name)[0];
const folder = argv[0];
const name = single('--name');
if (!folder || folder.startsWith('--') || !name) {
  console.error(
    'usage: node tools/showcase/import-capture.mjs <capture folder> --name <recording name> [options]',
  );
  process.exit(1);
}

function readCsv(file, header) {
  const lines = fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line !== '');
  if (lines[0] !== header) throw new Error(`${file}: header must be "${header}", got "${lines[0]}"`);
  return lines.slice(1).map((line, row) => {
    const cells = line.split(',').map(Number);
    if (cells.length !== header.split(',').length || !cells.every(Number.isFinite))
      throw new Error(`${file}: row ${row + 2} is not ${header.split(',').length} numbers`);
    return cells;
  });
}

// One row per frame. The live session refuses a batch whose stats do not line up with its samples, so a
// capture without stats.csv, or with stats on other frames, cannot be played.
function readCapture(captureFolder) {
  const statsFile = path.join(captureFolder, 'stats.csv');
  if (!fs.existsSync(statsFile))
    throw new Error(`${captureFolder} has no stats.csv; the replay needs frame stats`);
  const samples = readCsv(path.join(captureFolder, 'samples.csv'), 't_ns,r,g,b');
  const stats = readCsv(statsFile, 't_ns,spatial_std_r,clip_frac,exposure_ns');
  if (samples.length !== stats.length || samples.some((row, i) => row[0] !== stats[i][0]))
    throw new Error(`${captureFolder}: samples.csv and stats.csv are not on the same frames`);
  const meta = JSON.parse(fs.readFileSync(path.join(captureFolder, 'meta.json'), 'utf8'));
  const frames = samples.map(([tNs, r, g, b], i) => {
    const [, spatialStdR, clipFrac, exposureNs] = stats[i];
    return { tNs, r, g, b, spatialStdR, clipFrac, exposureNs };
  });
  return { frames, meta };
}

function parseSegment(text) {
  const at = text.lastIndexOf('@');
  const [span] = parseSpans(at === -1 ? text : text.slice(at + 1));
  return { folder: at === -1 ? folder : text.slice(0, at), ...span };
}

const fromS = single('--from');
const toS = single('--to');
const segments = values('--segment').map(parseSegment);
if (segments.length > 0 && (fromS !== undefined || toS !== undefined))
  throw new Error('use --from/--to or --segment, not both');
if (segments.length === 0) segments.push({ folder, fromS: Number(fromS ?? 0), toS: Number(toS ?? Infinity) });

const captures = new Map();
const captureAt = (captureFolder) => {
  if (!captures.has(captureFolder)) captures.set(captureFolder, readCapture(captureFolder));
  return captures.get(captureFolder);
};

const joined = [];
for (const segment of segments) {
  const { frames } = captureAt(segment.folder);
  const startNs = frames[0].tNs;
  const kept = frames.filter((frame) => {
    const atS = (frame.tNs - startNs) / 1e9;
    return atS >= segment.fromS && atS < segment.toS;
  });
  if (kept.length < 2)
    throw new Error(`segment ${segment.fromS}-${segment.toS} of ${segment.folder} holds no frames`);
  const stepNs = medianIntervalNs(kept.map((frame) => frame.tNs));
  const shiftNs = joined.length === 0 ? 0 : joined.at(-1).tNs + stepNs - kept[0].tNs;
  joined.push(...kept.map((frame) => ({ ...frame, tNs: frame.tNs + shiftNs })));
  console.log(`kept ${segment.folder} ${segment.fromS}-${segment.toS} s: ${kept.length} frames`);
}

const { meta } = captureAt(folder);
const fps = Math.round(1e9 / medianIntervalNs(joined.map((frame) => frame.tNs)));
const tNs = joined.map((frame) => frame.tNs);
writeRecording(name, {
  origin: `${path.basename(path.resolve(folder))} ${segments.map((s) => `${s.folder === folder ? '' : `${path.basename(s.folder)}@`}${s.fromS}-${s.toS}`).join(' + ')}`,
  capabilities: {
    platform: meta.platform ?? 'android',
    modelId: meta.modelId ?? 'recorded-phone',
    osVersion: meta.os ?? '0',
    rearLenses: [
      { id: meta.lensId ?? 'recorded-lens', kind: 'wide', maxFps: meta.fps ?? fps, torchUsable: true },
    ],
    torch: { available: true, levels: false },
    locks: { exposure: true, whiteBalance: true, focus: true },
  },
  motion: parseSpans(single('--motion')),
  samples: { tNs, r: joined.map((f) => f.r), g: joined.map((f) => f.g), b: joined.map((f) => f.b) },
  stats: {
    tNs,
    spatialStdR: joined.map((f) => f.spatialStdR),
    clipFrac: joined.map((f) => f.clipFrac),
    exposureNs: joined.map((f) => f.exposureNs),
  },
});
