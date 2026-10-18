import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { readRecording, RECORDINGS_DIR, REPO_ROOT } from './recording.mjs';

// node tools/showcase/finger-video.mjs <screen recording> --name shravan-scan [--crop w:h:x:y]
// Cuts a take's finger video out of a screen recording of the Lab screen (scrcpy on the A17, QuickTime or Screen
// Recording on the iPhone) and writes apps/mobile/src/showcase/recordings/<name>.mp4, which the film plays in the
// dial (src/showcase/filmVideo.tsx). --crop is the Lab's camera square in the recording's pixels; leave it out when
// the recording is already just the square (tools/showcase-cues.ps1 records it that way).
// Sync: the square is a flat grey box until Start, and the camera picture appears with the take's first frames, so
// the cut starts at the first frame with picture detail and runs for the take's length (<name>.json, imported first
// with import-capture.mjs). The opening without a finger stays in, however long it is.

const argv = process.argv.slice(2);
const option = (name) => {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
};
const source = argv[0];
const name = option('--name');
const crop = option('--crop');
if (!source || source.startsWith('--') || !name) {
  console.error(
    'usage: node tools/showcase/finger-video.mjs <screen recording> --name <take> [--crop w:h:x:y]',
  );
  process.exit(1);
}
if (crop !== undefined && !/^\d+:\d+:\d+:\d+$/.test(crop))
  throw new Error(`--crop "${crop}" must be w:h:x:y`);

const take = readRecording(name);
const takeSeconds = (take.samples.tNs.at(-1) - take.samples.tNs[0]) / 1e9;
const square = crop === undefined ? [] : [`crop=${crop}`];

// A flat box has almost no spread between its darkest and brightest pixel; any camera picture, even a dark floor or
// a red fingertip, has noise and edges well past this. A picture that is itself nearly flat (a covered or pitch-dark
// lens) still differs in brightness from the grey box.
const PICTURE_SPREAD = 24;
const BRIGHTNESS_JUMP = 20;

const stats = execFileSync(
  'ffmpeg',
  [
    '-loglevel',
    'error',
    '-i',
    source,
    '-vf',
    [...square, 'signalstats', 'metadata=print:file=-'].join(','),
    '-f',
    'null',
    '-',
  ],
  { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
);
let frameTime = null;
let frameMin = null;
let frameAvg = null;
let boxAvg = null;
let startS = null;
// signalstats prints YMIN and YAVG before YMAX for each frame, so a frame is judged at its YMAX line.
for (const line of stats.split(/\r?\n/)) {
  const time = /pts_time:([\d.]+)/.exec(line);
  if (time) frameTime = Number(time[1]);
  const min = /lavfi\.signalstats\.YMIN=(\d+)/.exec(line);
  if (min) frameMin = Number(min[1]);
  const avg = /lavfi\.signalstats\.YAVG=([\d.]+)/.exec(line);
  if (avg) frameAvg = Number(avg[1]);
  const max = /lavfi\.signalstats\.YMAX=(\d+)/.exec(line);
  if (!max || frameTime === null || frameMin === null || frameAvg === null) continue;
  boxAvg ??= frameAvg;
  if (Number(max[1]) - frameMin > PICTURE_SPREAD || Math.abs(frameAvg - boxAvg) > BRIGHTNESS_JUMP) {
    startS = frameTime;
    break;
  }
}
if (startS === null) throw new Error(`${source}: the square never shows a camera picture; check --crop`);

const out = path.join(RECORDINGS_DIR, `${name}.mp4`);
execFileSync('ffmpeg', [
  '-loglevel',
  'error',
  '-y',
  '-ss',
  startS.toFixed(3),
  '-i',
  source,
  '-t',
  takeSeconds.toFixed(3),
  '-vf',
  [...square, 'scale=480:480', 'fps=30'].join(','),
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
  out,
]);
console.log(
  `wrote ${path.relative(REPO_ROOT, out)}: ${takeSeconds.toFixed(1)} s from ${startS.toFixed(2)} s of ${source}`,
);
