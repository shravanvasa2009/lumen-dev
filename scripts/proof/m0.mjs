import fs from 'node:fs';
import path from 'node:path';
import { captureDir, findWorkspace } from '../lib/workspace.mjs';

// M0: a real capture from the iPhone, sent to the PC by the dev-only receiver, shows a usable pulse.
function newestCapture(dir) {
  if (!fs.existsSync(dir)) return null;
  const folders = fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, 'samples.csv')))
    .map((entry) => entry.name).sort();
  return folders.length ? path.join(dir, folders.at(-1)) : null;
}

function readSamples(folder) {
  const [header, ...rows] = fs.readFileSync(path.join(folder, 'samples.csv'), 'utf8').trim().split(/\r?\n/);
  const cols = header.split(',');
  const at = (name) => cols.indexOf(name);
  return rows.map((row) => row.split(',').map(Number)).map((v) => ({ tNs: v[at('t_ns')], r: v[at('r')], g: v[at('g')], b: v[at('b')] }));
}

// Pulse rate from the dominant frequency of the inverted red signal (0.6–3.5 Hz), after a moving-average detrend.
function pulseSpectrum(samples) {
  const fs30 = 30;
  const t0 = samples[0].tNs;
  const times = samples.map((s) => (s.tNs - t0) / 1e9);
  const duration = times.at(-1);
  const uniform = [];
  for (let t = 0, i = 0; t <= duration; t += 1 / fs30) {
    while (i < times.length - 2 && times[i + 1] < t) i++;
    const span = times[i + 1] - times[i] || 1;
    const w = (t - times[i]) / span;
    uniform.push(-((1 - w) * samples[i].r + w * samples[i + 1].r));
  }
  const win = Math.round(1.5 * fs30);
  const detrended = uniform.map((value, i) => {
    const from = Math.max(0, i - win), to = Math.min(uniform.length, i + win);
    let sum = 0;
    for (let k = from; k < to; k++) sum += uniform[k];
    return value - sum / (to - from);
  });
  const segment = detrended.slice(-20 * fs30);
  const n = segment.length;
  const powers = [];
  for (let f = 0.6; f <= 3.5; f += 0.01) {
    let re = 0, im = 0;
    for (let k = 0; k < n; k++) {
      const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (n - 1));
      re += segment[k] * hann * Math.cos((2 * Math.PI * f * k) / fs30);
      im -= segment[k] * hann * Math.sin((2 * Math.PI * f * k) / fs30);
    }
    powers.push({ f, p: re * re + im * im });
  }
  const peak = powers.reduce((best, bin) => (bin.p > best.p ? bin : best));
  const sorted = powers.map((bin) => bin.p).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return { hrBpm: peak.f * 60, snrDb: 10 * Math.log10(peak.p / median) };
}

export default function proveM0() {
  const reasons = [];
  const folder = newestCapture(captureDir());
  if (!folder) return { status: 'FAIL', reasons: [`no capture folder with samples.csv in ${captureDir()} (send one from Lab mode with "Send to PC")`] };
  const samples = readSamples(folder);
  const duration = (samples.at(-1).tNs - samples[0].tNs) / 1e9;
  const fps = (samples.length - 1) / duration;
  const contact = samples.filter((s) => s.r / (s.g + s.b + 1e-9) >= 2 && s.r >= 0.3).length / samples.length;
  if (duration < 20) reasons.push(`capture is ${duration.toFixed(1)} s; need ≥ 20 s`);
  if (fps < 25) reasons.push(`effective fps ${fps.toFixed(1)} < 25`);
  if (contact < 0.8) reasons.push(`finger contact on ${(contact * 100).toFixed(0)}% of frames; need ≥ 80%`);
  if (duration >= 20) {
    const { hrBpm, snrDb } = pulseSpectrum(samples);
    if (hrBpm < 40 || hrBpm > 180) reasons.push(`pulse rate ${hrBpm.toFixed(0)} bpm is outside 40–180`);
    if (snrDb < 6) reasons.push(`spectral peak SNR ${snrDb.toFixed(1)} dB < 6 dB`);
  }
  const ws = findWorkspace();
  const log = ws ? path.join(ws, 'docs', 'device-tests.md') : null;
  if (!log || !/M0 confirmed/i.test(fs.readFileSync(log, 'utf8'))) reasons.push('owner has not written "M0 confirmed" in docs/device-tests.md');
  return { status: reasons.length ? 'FAIL' : 'PASS', reasons, detail: path.basename(folder) };
}
