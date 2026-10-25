import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RECORDINGS_DIR, REPO_ROOT, writeRecording } from './recording.mjs';

// node tools/showcase/video-take.mjs <camera video> --name nitin-scan --bpm 62 [--from 1.5] [--landed 3.2]
// Makes a showcase take from a video the phone's own Camera app recorded with the flash on: the carpet for 2–4 s,
// then the fingertip over the lens (owner, 2026-10-25). The same on both phones, with no Lab build or receiver.
// Writes apps/mobile/src/showcase/recordings/<name>.mp4 (the dial's finger video) and <name>.json (the beats).
// --from is where "Go" falls in the video, in seconds; the take runs from there for its length (practice 50 s,
// scan 120 s).
//
// The beats: until the finger lands they are the video's real colours, so the replay refuses the carpet as it
// would live. A Camera app's own exposure clips a lit fingertip far past DSP-4's limits, so from the landing on the
// colours are replaced with a covered lens's (like make-standins.mjs) and the pulse is generated at --bpm
// (generate-pulse.mjs, which the owner approved on 2026-10-17). The recording's origin says so.

const TAKES = { practice: 50, scan: 120 };
const FPS = 30;
const FRAME_NS = 1e9 / FPS;
const START_NS = 1e12;
// Colour means come from the middle of the picture, where the fingertip covers the lens.
const SIDE = 32;
const CENTRE_SHARE = 0.6;
// A fingertip lit by the flash is red; carpet under it is not. Held this long, the finger has landed.
const FINGER_RED_RATIO = 1.2;
const FINGER_MIN_RED = 0.3;
const LANDED_HOLD_S = 1;
const BLEND_S = 1;
// A covered lens under the torch on the A17 (DSP-4: R ≥ 2 (G + B), R ≥ 0.3, flat, nothing clipped).
const COVERED = { g: 0.11, b: 0.1, spatialStdR: 0.02, clipFrac: 0 };
const COVERED_RED_LOW = 0.55;
const COVERED_RED_SPAN = 0.25;
const SMOOTH_S = 3;

const argv = process.argv.slice(2);
const option = (name) => {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
};
const source = argv[0];
const name = option('--name') ?? '';
const bpm = Number(option('--bpm'));
const fromS = Number(option('--from') ?? 0);
const lengthS = TAKES[name.split('-').at(-1)];
if (
  !source ||
  source.startsWith('--') ||
  !/^(nitin|shravan)-(practice|scan)$/.test(name) ||
  !Number.isFinite(bpm)
) {
  console.error(
    'usage: node tools/showcase/video-take.mjs <camera video> --name <nitin|shravan>-<practice|scan> --bpm <n> ' +
      '[--from <s>] [--landed <s>]',
  );
  process.exit(1);
}

const square = 'crop=min(iw\\,ih):min(iw\\,ih)';
const ffmpeg = (args, options) =>
  execFileSync(
    'ffmpeg',
    ['-loglevel', 'error', '-ss', String(fromS), '-t', String(lengthS), '-i', source, ...args],
    options,
  );

const raw = ffmpeg(
  [
    '-vf',
    `${square},crop=iw*${CENTRE_SHARE}:ih*${CENTRE_SHARE},fps=${FPS},scale=${SIDE}:${SIDE}:flags=area`,
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    '-',
  ],
  { maxBuffer: 512 * 1024 * 1024 },
);
const pixels = SIDE * SIDE;
const frames = Math.floor(raw.length / (pixels * 3));
if (frames < (lengthS - 1) * FPS)
  throw new Error(
    `${source}: only ${(frames / FPS).toFixed(1)} s after ${fromS} s; the take needs ${lengthS} s`,
  );

const real = { r: [], g: [], b: [], spatialStdR: [], clipFrac: [] };
for (let frame = 0; frame < frames; frame += 1) {
  let [r, g, b, rSquares, clipped] = [0, 0, 0, 0, 0];
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const at = (frame * pixels + pixel) * 3;
    r += raw[at];
    g += raw[at + 1];
    b += raw[at + 2];
    rSquares += raw[at] ** 2;
    if (raw[at] >= 250) clipped += 1;
  }
  const meanR = r / pixels;
  real.r.push(meanR / 255);
  real.g.push(g / pixels / 255);
  real.b.push(b / pixels / 255);
  real.spatialStdR.push(Math.sqrt(Math.max(0, rSquares / pixels - meanR ** 2)) / 255);
  real.clipFrac.push(clipped / pixels);
}

function findLanding() {
  const given = option('--landed');
  if (given !== undefined) return Number(given);
  let since = null;
  for (let frame = 0; frame < frames; frame += 1) {
    const finger =
      real.r[frame] >= FINGER_MIN_RED && real.r[frame] >= FINGER_RED_RATIO * (real.g[frame] + real.b[frame]);
    if (!finger) since = null;
    else if (since === null) since = frame;
    else if ((frame - since) / FPS >= LANDED_HOLD_S) return since / FPS;
  }
  throw new Error(
    `${source}: no fingertip found after ${fromS} s; pass --landed <s> (seconds into the take)`,
  );
}
const landedS = findLanding();
if (landedS < 1.5 || landedS > 5)
  console.warn(
    `warning: the finger lands ${landedS.toFixed(1)} s into the take; the carpet should show for 2–4 s`,
  );

// The scan film coaches a slipped finger; take-cues.mjs has the person slide the finger half off at 41 s. Half off,
// the lens sees flash-lit carpet, so the picture is much less red than when held. The seconds the video shows it go
// into the take as `slip`, so the coaching matches the finger video; without one the app uses scanSource.ts SLIP.
const SLIP_SEARCH = { fromS: 38, toS: 56 };
const SLIP_REDNESS_SHARE = 0.8;
// Frames that briefly read red again mid-slip don't end it.
const SLIP_GAP_S = 0.3;
function findSlip() {
  const redness = (frame) => real.r[frame] / Math.max(1e-6, real.g[frame] + real.b[frame]);
  const heldFrames = [];
  for (let frame = 30 * FPS; frame < SLIP_SEARCH.fromS * FPS; frame += 1) heldFrames.push(redness(frame));
  const held = heldFrames.sort((x, y) => x - y)[Math.floor(heldFrames.length / 2)];
  let best = null;
  let run = null;
  for (let frame = SLIP_SEARCH.fromS * FPS; frame < SLIP_SEARCH.toS * FPS; frame += 1) {
    if (redness(frame) >= SLIP_REDNESS_SHARE * held) continue;
    if (run && (frame - run.last) / FPS <= SLIP_GAP_S) run.last = frame;
    else run = { first: frame, last: frame };
    if (!best || run.last - run.first > best.last - best.first) best = { ...run };
  }
  console.log(`finger redness held ${held.toFixed(2)}`);
  if (!best) {
    console.warn(
      `warning: the video shows no finger slip at ${SLIP_SEARCH.fromS}-${SLIP_SEARCH.toS} s; the app will coach one ` +
        "at 42-46 s, but the finger video won't match. Redo the take and slide off on the cue.",
    );
    return undefined;
  }
  const slip = { fromS: best.first / FPS, toS: (best.last + 1) / FPS };
  console.log(`finger slip in the video: ${slip.fromS.toFixed(2)}-${slip.toS.toFixed(2)} s`);
  return slip;
}
const slip = name.endsWith('-scan') ? findSlip() : undefined;

// The real red's slow drift, so the covered level breathes like a real one instead of sitting flat.
const half = Math.round((SMOOTH_S * FPS) / 2);
const smooth = real.r.map((_, frame) => {
  const window = real.r.slice(Math.max(0, frame - half), frame + half + 1);
  return window.reduce((sum, value) => sum + value, 0) / window.length;
});
const covered = (frame, key) =>
  key === 'r' ? COVERED_RED_LOW + COVERED_RED_SPAN * smooth[frame] : COVERED[key];
const columns = Object.fromEntries(
  Object.keys(real).map((key) => [
    key,
    real[key].map((value, frame) => {
      const blend = Math.min(1, Math.max(0, (frame / FPS - landedS) / BLEND_S));
      return value * (1 - blend) + covered(frame, key) * blend;
    }),
  ]),
);

const tNs = Array.from({ length: frames }, (_, frame) => Math.round(START_NS + frame * FRAME_NS));
const ios = /^nitin/.test(name);
writeRecording(name, {
  origin:
    `${path.basename(source)} from ${fromS} s, finger landed ${landedS.toFixed(1)} s; camera colours ` +
    `after the landing are a COVERED-LENS STAND-IN (video-take.mjs)`,
  capabilities: {
    platform: ios ? 'ios' : 'android',
    modelId: ios ? 'iPhone 17 Pro camera video' : 'samsung SM-S176V camera video',
    osVersion: '0',
    rearLenses: [{ id: 'camera-video', kind: 'wide', maxFps: FPS, torchUsable: true }],
    torch: { available: true, levels: false },
    locks: { exposure: true, whiteBalance: true, focus: true },
  },
  motion: [],
  slip,
  samples: { tNs, r: columns.r, g: columns.g, b: columns.b },
  stats: {
    tNs,
    spatialStdR: columns.spatialStdR,
    clipFrac: columns.clipFrac,
    exposureNs: tNs.map(() => FRAME_NS / 2),
  },
});

const video = path.join(RECORDINGS_DIR, `${name}.mp4`);
ffmpeg([
  '-y',
  '-vf',
  `${square},scale=480:480,fps=${FPS}`,
  '-an',
  '-c:v',
  'libx264',
  '-preset',
  'veryfast',
  '-crf',
  '26',
  '-pix_fmt',
  'yuv420p',
  '-movflags',
  '+faststart',
  video,
]);
console.log(`wrote ${path.relative(REPO_ROOT, video)}: ${lengthS} s from ${fromS} s of ${source}`);

const here = path.dirname(fileURLToPath(import.meta.url));
execFileSync('node', [path.join(here, 'generate-pulse.mjs'), name, '--bpm', String(bpm)], {
  stdio: 'inherit',
});
execFileSync('node', [path.join(here, 'check-timing.mjs'), name], { stdio: 'inherit' });
