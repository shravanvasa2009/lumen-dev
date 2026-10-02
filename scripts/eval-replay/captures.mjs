import fs from 'node:fs';
import path from 'node:path';

// One capture folder per reading (Appendix B). tools/replay (Track C) adds replay-result.json and
// replay-intervals.csv next to the raw files; agent_com order E.C_TASK-replay-output-contract.
const RESULT = 'replay-result.json';

// A malformed file must stop the run: a NaN would otherwise become null in metrics.json while the
// reading still counted toward people and readings.
function readCsv(folder, name, columns) {
  const file = path.join(folder, name);
  if (!fs.existsSync(file)) return null;
  const [header, ...lines] = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  const found = header.split(',');
  if (columns.some((column) => !found.includes(column)))
    throw new Error(`${folder}/${name}: expected columns ${columns.join(',')}, found ${header}`);
  return lines.map((line, row) => {
    const cells = line.split(',');
    return Object.fromEntries(
      columns.map((column) => {
        const value = Number(cells[found.indexOf(column)]);
        if (!Number.isFinite(value)) throw new Error(`${folder}/${name}: row ${row + 2} has a bad ${column}`);
        return [column, value];
      }),
    );
  });
}

// The first and last timestamps of samples.csv, read without parsing every frame.
function captureSpan(folder) {
  const file = path.join(folder, 'samples.csv');
  if (!fs.existsSync(file)) return null;
  const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  const first = Number(lines[1]?.split(',')[0]);
  const last = Number(lines.at(-1).split(',')[0]);
  return Number.isFinite(first) && Number.isFinite(last) && lines.length > 2 ? [first, last] : null;
}

// The strap and the camera must share a clock; if no strap beat falls inside the capture, the clocks
// disagree, and dropping the reading silently would hide it from every metric.
function strapInsideCapture(folder, polar, span) {
  if (span === null || polar.length === 0) return polar;
  const inside = polar.filter((row) => row.t_ns >= span[0] && row.t_ns <= span[1]);
  if (inside.length === 0)
    throw new Error(
      `${folder}: polar_rr.csv t_ns ${polar[0].t_ns}..${polar.at(-1).t_ns} does not overlap samples.csv ${span[0]}..${span[1]}`,
    );
  return inside;
}

// A Bluetooth dropout loses strap notifications, and with them whole beats. Beat times are running sums of
// intervals, so every beat after a dropout would pair with the wrong heartbeat.
// Lab writes the rows as one beat timeline (PR #58): within a stretch each t_ns is the previous one plus its
// RR, to the ns. A step longer than that starts a new stretch, either after lost beats (at least about one RR
// of excess) or after an unusually late arrival (tens of ms). 250 ms (ADR 0037) catches a single lost beat at
// any heart rate up to 240 bpm and ignores the late arrivals. How many beats were lost is unknown to within a
// beat, so no filler can restore the timing: the longest unbroken stretch is kept and the rest dropped.
const DROPOUT_MS = 250;

function longestUnbrokenStretch(rows) {
  const stretches = [[]];
  rows.forEach((row, i) => {
    if (i > 0 && (row.t_ns - rows[i - 1].t_ns) / 1e6 - row.rr_ms > DROPOUT_MS) stretches.push([]);
    stretches.at(-1).push(row);
  });
  const longest = stretches.reduce((best, stretch) => (stretch.length > best.length ? stretch : best));
  // Where the kept stretch begins (its first interval's start) and ends, so alignment can use the same span.
  const first = longest[0];
  return {
    polarRrMs: longest.map((row) => row.rr_ms),
    polarStartNs: first ? first.t_ns - first.rr_ms * 1e6 : null,
    polarEndNs: first ? longest.at(-1).t_ns : null,
    strapDropouts: stretches.length - 1,
  };
}

function readCapture(folder) {
  const phone = readCsv(folder, 'replay-intervals.csv', ['t_ns', 'ibi_ms', 'accepted']);
  if (!phone) throw new Error(`${folder}: replay-result.json has no replay-intervals.csv beside it`);
  const span = captureSpan(folder);
  const polar = readCsv(folder, 'polar_rr.csv', ['t_ns', 'rr_ms']);
  return {
    folder: path.basename(folder),
    meta: JSON.parse(fs.readFileSync(path.join(folder, 'meta.json'), 'utf8')),
    reading: JSON.parse(fs.readFileSync(path.join(folder, RESULT), 'utf8')),
    phone: phone.map((row) => ({ endNs: row.t_ns, ibiMs: row.ibi_ms, accepted: row.accepted === 1 })),
    ...(polar
      ? longestUnbrokenStretch(strapInsideCapture(folder, polar, span))
      : { polarRrMs: null, polarStartNs: null, polarEndNs: null, strapDropouts: 0 }),
  };
}

// A folder counts only once tools/replay has processed it, so a half-copied capture can't skew metrics.
export function readCaptures(root) {
  const missing = [];
  const captures = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const folder = path.join(root, entry.name);
    if (fs.existsSync(path.join(folder, RESULT))) captures.push(readCapture(folder));
    else missing.push(entry.name);
  }
  return { captures, missing };
}
