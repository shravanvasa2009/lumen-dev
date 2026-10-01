import fs from 'node:fs';
import path from 'node:path';

// One capture folder per reading (Appendix B). tools/replay (Track C) adds replay-result.json and
// replay-intervals.csv next to the raw files; agent_com order E.C_TASK-replay-output-contract.
const RESULT = 'replay-result.json';

function readCsv(file) {
  if (!fs.existsSync(file)) return null;
  const [header, ...lines] = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  const columns = header.split(',');
  return lines.map((line) =>
    Object.fromEntries(line.split(',').map((cell, i) => [columns[i], Number(cell)])),
  );
}

export function readCapture(folder) {
  const meta = JSON.parse(fs.readFileSync(path.join(folder, 'meta.json'), 'utf8'));
  const polar = readCsv(path.join(folder, 'polar_rr.csv'));
  const phone = readCsv(path.join(folder, 'replay-intervals.csv'));
  return {
    folder: path.basename(folder),
    meta,
    reading: JSON.parse(fs.readFileSync(path.join(folder, RESULT), 'utf8')),
    polarRrMs: polar?.map((row) => row.rr_ms) ?? null,
    phoneRrMs: phone?.filter((row) => row.accepted === 1).map((row) => row.ibi_ms) ?? null,
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
