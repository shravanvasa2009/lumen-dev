import fs from 'node:fs';
import path from 'node:path';
import { loadCore } from './core.mjs';
import { contextFromMeta, readCapture } from './replay.mjs';

// ANSI/AAMI EC13: a heart rate within 5 bpm of the reference is right (the bound the red-team tests use).
const EC13_BPM = 5;
// The pulse band for the spectral check, 36–220 bpm (rules.fastRegularBpm's top), on a 30 Hz grid.
const BAND_HZ = [0.6, 3.7];
const GRID_HZ = 30;

const median = (values) => {
  const sorted = [...values].sort((x, y) => x - y);
  if (sorted.length === 0) return null;
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const quantile = (values, q) => {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null;
};
const bpmText = (bpm) => (bpm === null ? '—' : bpm.toFixed(1));

// Optional Lab reference: Polar H10 R-R intervals (Appendix B polar_rr.csv), as 60 000 / the median R-R.
function polarBpm(folder) {
  const file = path.join(folder, 'polar_rr.csv');
  if (!fs.existsSync(file)) return null;
  const rows = fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(1).filter(Boolean);
  const rrMs = rows.map((row) => Number(row.split(',')[1])).filter((rr) => rr > 0);
  return rrMs.length ? 60000 / median(rrMs) : null;
}

// The longest DSP-2-style stretch of red on a 30 Hz grid, band-passed to the pulse band; null under 10 s.
function pulseBand(core, tS, red) {
  const longest = core
    .resampleCubic(tS, red, GRID_HZ)
    .reduce((best, segment) => (segment.values.length > (best?.values.length ?? 0) ? segment : best), null);
  if (!longest || longest.values.length < 10 * GRID_HZ) return null;
  return core.filterZeroPhase(core.butterBandpass(2, BAND_HZ[0], BAND_HZ[1], GRID_HZ), longest.values);
}

// Rate of the strongest periodicity in the pulse band, from the red channel alone: it does not depend on
// DSP-4/5 spans or on beat detection (DSP-7/9), so it tells a bad signal apart from a bad beat search.
function spectralBpm(band) {
  const power = (bpm) => {
    const omega = (2 * Math.PI * bpm) / 60 / GRID_HZ;
    let re = 0;
    let im = 0;
    band.forEach((value, n) => {
      re += value * Math.cos(omega * n);
      im += value * Math.sin(omega * n);
    });
    return re * re + im * im;
  };
  let best = { bpm: null, power: -1 };
  for (let bpm = BAND_HZ[0] * 60; bpm <= BAND_HZ[1] * 60; bpm += 0.25) {
    const p = power(bpm);
    if (p > best.power) best = { bpm, power: p };
  }
  const halfRatio = best.bpm / 2 >= BAND_HZ[0] * 60 ? power(best.bpm / 2) / best.power : 0;
  return { bpm: best.bpm, halfRatio };
}

// The Lab screen's live rate: estimateLiveHeartRate over the last liveHr.windowS, once a second.
function liveRates(core, samples) {
  const windowNs = core.DSP_CONFIG.liveHr.windowS * 1e9;
  const rates = [];
  let errors = 0;
  let from = 0;
  const startNs = samples[0].tNs;
  for (let tickNs = startNs + windowNs; tickNs <= samples[samples.length - 1].tNs; tickNs += 1e9) {
    while (samples[from].tNs < tickNs - windowNs) from++;
    let to = from;
    while (to < samples.length && samples[to].tNs <= tickNs) to++;
    try {
      const estimate = core.estimateLiveHeartRate(samples.slice(from, to));
      if (estimate) rates.push(estimate.bpm);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      errors++;
    }
  }
  return { rates, errors };
}

function lostByReason(core, analysis) {
  const lost = {};
  for (const reason of new Set(analysis.rejectedSpans.map((span) => span.reason))) {
    const spans = analysis.rejectedSpans.filter((span) => span.reason === reason);
    lost[reason] = analysis.durationS - core.cleanSeconds(0, analysis.durationS, spans);
  }
  return lost;
}

function verdicts({ referenceBpm, savedBpm, spectral, live, exposureLostS, durationS, outcome, pulsePct }) {
  const lines = [];
  if (exposureLostS > 0.3 * durationS)
    lines.push(
      `exposure changes cost ${((100 * exposureLostS) / durationS).toFixed(0)}% of the capture: auto-exposure is not locked (DSP-5 rejects 1 s after each change)`,
    );
  if (outcome.kind === 'inconclusive') lines.push(`the reading is refused: ${outcome.reasons.join(', ')}`);
  if (pulsePct !== null && pulsePct < 0.5)
    lines.push(
      `the pulse is weak (${pulsePct.toFixed(2)}% of the red level): noise peaks can pass as beats (S1)`,
    );
  if (referenceBpm === null) {
    lines.push('no reference rate: pass --ref <bpm> (or record with the Polar strap) to judge the rates');
    return lines;
  }
  const judge = (name, bpm) => {
    if (bpm === null) return;
    const ratio = bpm / referenceBpm;
    if (Math.abs(bpm - referenceBpm) <= EC13_BPM) lines.push(`${name} is right (within ${EC13_BPM} bpm)`);
    else if (ratio > 1.8 && ratio < 2.2)
      lines.push(
        `${name} is about twice the reference: each beat found twice (dicrotic wave or noise, ADR 0066 / S1)`,
      );
    else if (ratio > 0.45 && ratio < 0.55)
      lines.push(
        `${name} is about half the reference: every other beat missed (a raised DSP-7 threshold, E / F2)`,
      );
    else lines.push(`${name} is off by ${(bpm - referenceBpm).toFixed(1)} bpm`);
  };
  judge('the saved rate', savedBpm);
  judge('the live rate (median)', live.rates.length ? median(live.rates) : null);
  judge('the spectral peak', spectral?.bpm ?? null);
  const spectrumRight = spectral !== null && Math.abs(spectral.bpm - referenceBpm) <= EC13_BPM;
  const savedWrong = savedBpm === null || Math.abs(savedBpm - referenceBpm) > EC13_BPM;
  if (spectrumRight && savedWrong)
    lines.push(
      '→ the pulse IS in the light signal: the fault is in beat detection or rejection (DSP-4/5/7/9), not the camera',
    );
  if (spectral !== null && !spectrumRight)
    lines.push(
      '→ the strongest rhythm in the light signal is not the pulse: the camera signal itself (exposure, pressure, light leak) is the first problem',
    );
  return lines;
}

/** Diagnoses one Appendix B capture folder: where between the camera and DSP-11 the heart rate goes wrong. */
export async function diagnoseFolder(folder, { referenceBpm = null } = {}) {
  const core = await loadCore();
  const { samples, stats, meta } = readCapture(folder);
  const context = contextFromMeta(meta, samples, null);
  const analysis = core.analyzeReading({ samples, stats }, context);
  const outcome = core.readingOutcome(analysis);
  const timebase = core.buildTimebase(samples, stats);

  const intervalsMs = samples.slice(1).map((sample, i) => (sample.tNs - samples[i].tNs) / 1e6);
  const exposureChanges = stats.filter(
    (stat, i) => i > 0 && stat.exposureNs !== stats[i - 1].exposureNs,
  ).length;
  const lost = lostByReason(core, analysis);
  const red = Float64Array.from(samples, (sample) => sample.r);
  const filtered = pulseBand(core, timebase.tS, timebase.r);
  const band = filtered ? spectralBpm(filtered) : null;
  // Pulse size as the 5–95% spread of the band over the median red level: a rough perfusion index.
  const pulsePct = filtered
    ? (100 * (quantile(filtered, 0.95) - quantile(filtered, 0.05))) / median(Array.from(red))
    : null;
  const beats = analysis.segments.flat();
  const classes = {};
  for (const beat of beats) classes[beat.beatClass] = (classes[beat.beatClass] ?? 0) + 1;
  const live = liveRates(core, samples);
  const reference = referenceBpm ?? polarBpm(folder);

  const report = {
    folder,
    capture: {
      durationS: analysis.durationS,
      frames: samples.length,
      medianFps: 1000 / median(intervalsMs),
      intervalSdMs: Math.sqrt(
        intervalsMs.reduce((sum, ms) => sum + (ms - median(intervalsMs)) ** 2, 0) / intervalsMs.length,
      ),
      gapsOver150ms: intervalsMs.filter((ms) => ms > 150).length,
      exposureValues: new Set(stats.map((stat) => stat.exposureNs)).size,
      exposureChanges,
      clippedFrames: stats.filter((stat) => stat.clipFrac > core.DSP_CONFIG.dsp4.maxClipFrac).length,
    },
    signal: { redLevel: median(Array.from(red)), pulsePct },
    clean: {
      seconds: analysis.cleanSeconds,
      needed: outcome.kind === 'inconclusive' ? outcome.neededCleanSeconds : null,
      lostByReason: lost,
    },
    beats: classes,
    rates: {
      reference,
      saved: analysis.heartRateBpm,
      liveMedian: live.rates.length ? median(live.rates) : null,
      liveP10: quantile(live.rates, 0.1),
      liveP90: quantile(live.rates, 0.9),
      liveErrors: live.errors,
      spectral: band?.bpm ?? null,
      spectralHalfRatio: band?.halfRatio ?? null,
    },
    outcome,
  };
  report.verdicts = verdicts({
    referenceBpm: reference,
    savedBpm: analysis.heartRateBpm,
    spectral: band,
    live,
    exposureLostS: lost.exposure ?? 0,
    durationS: analysis.durationS,
    outcome,
    pulsePct,
  });
  return report;
}

export function formatReport(report) {
  const { capture, signal, clean, beats, rates } = report;
  const lost = Object.entries(clean.lostByReason)
    .map(([reason, seconds]) => `${reason} ${seconds.toFixed(1)}`)
    .join(', ');
  return [
    report.folder,
    `  Capture   ${capture.durationS.toFixed(1)} s, ${capture.frames} frames, ${capture.medianFps.toFixed(1)} fps median, interval sd ${capture.intervalSdMs.toFixed(1)} ms, ${capture.gapsOver150ms} gaps > 150 ms`,
    `  Exposure  ${capture.exposureValues === 1 ? 'one value (locked)' : `${capture.exposureValues} values, ${capture.exposureChanges} changes (${(capture.exposureChanges / capture.durationS).toFixed(2)}/s)`}; clipped frames ${capture.clippedFrames}`,
    `  Signal    red level ${signal.redLevel.toFixed(3)}, pulse ${signal.pulsePct === null ? '—' : `${signal.pulsePct.toFixed(2)}%`} of it`,
    `  Clean     ${clean.seconds.toFixed(1)} s${clean.needed === null ? '' : ` (needs ${clean.needed})`}; lost: ${lost || 'none'}`,
    `  Beats     ${
      Object.entries(beats)
        .map(([name, count]) => `${count} ${name}`)
        .join(', ') || 'none'
    }`,
    `  Rates     reference ${bpmText(rates.reference)} | saved ${bpmText(rates.saved)} | live ${bpmText(rates.liveMedian)} (p10–p90 ${bpmText(rates.liveP10)}–${bpmText(rates.liveP90)}${rates.liveErrors ? `, ${rates.liveErrors} errors` : ''}) | spectral ${bpmText(rates.spectral)}`,
    `  Outcome   ${report.outcome.kind}`,
    ...report.verdicts.map((line, i) => `  ${i === 0 ? 'Verdict ' : '        '}  - ${line}`),
  ].join('\n');
}
