import fs from 'node:fs';
import path from 'node:path';

const CLOCK_START_NS = 5_000_000_000_000;

// Appendix B capture folder: samples.csv, stats.csv, meta.json. −R carries Gaussian pulses at `bpm`
// (σ 60 ms) and a breathing baseline at 15/min; `fingerOff` makes every frame fail DSP-4. `secondWave` adds a
// wave of that relative height half a period after each peak, as a strong dicrotic wave (ADR 0066).
export function writeSyntheticCapture(
  folder,
  { seconds = 70, fps = 60, bpm = 75, fingerOff = false, secondWave = 0, meta = {} } = {},
) {
  fs.mkdirSync(folder, { recursive: true });
  const peaksS = [];
  for (let peakS = 0.5; peakS < seconds + 1; peakS += 60 / bpm) peaksS.push(peakS);
  const samples = ['t_ns,r,g,b'];
  const stats = ['t_ns,spatial_std_r,clip_frac,exposure_ns'];
  for (let k = 0; k < Math.round(seconds * fps); k++) {
    const tS = k / fps;
    let pulse = 0;
    for (const peakS of peaksS)
      if (Math.abs(tS - peakS) < 0.5 + 30 / bpm)
        pulse +=
          Math.exp(-0.5 * ((tS - peakS) / 0.06) ** 2) +
          secondWave * Math.exp(-0.5 * ((tS - peakS - 30 / bpm) / 0.06) ** 2);
    const tNs = CLOCK_START_NS + Math.round(tS * 1e9);
    const red = fingerOff ? 0.25 : 0.62 - 0.004 * pulse - 0.002 * Math.sin((2 * Math.PI * tS) / 4);
    samples.push(`${tNs},${red},${fingerOff ? 0.22 : 0.11},${fingerOff ? 0.2 : 0.04}`);
    stats.push(`${tNs},${fingerOff ? 0.2 : 0.02},0,8000000`);
  }
  fs.writeFileSync(path.join(folder, 'samples.csv'), `${samples.join('\n')}\n`);
  fs.writeFileSync(path.join(folder, 'stats.csv'), `${stats.join('\n')}\n`);
  const fullMeta = {
    app: '0.9.0',
    platform: 'ios',
    modelId: 'synthetic',
    os: 'synthetic',
    mode: 'full',
    lensId: 'top',
    fps,
    torchLevel: 1,
    rating: { score: 86, tier: 'full' },
    ...meta,
  };
  fs.writeFileSync(path.join(folder, 'meta.json'), `${JSON.stringify(fullMeta, null, 2)}\n`);
  return { peaksS, startNs: CLOCK_START_NS };
}
