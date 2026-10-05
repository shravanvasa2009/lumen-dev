import fs from 'node:fs';
import path from 'node:path';
import { loadCore } from './core.mjs';
import { contextFromMeta, readCapture } from './replay.mjs';

// A rate within 5 bpm of the reference is right: the bound the owner confirmed (decision 7, 2026-10-04) and the
// red-team tests use.
const RIGHT_BPM = 5;
// "Most of the capture": over this share lost to exposure changes, DSP-5 is what refuses the reading.
const MOSTLY_LOST = 0.3;
// Red team PR #242 S1 found noise passing as beats at ~0.5% pulse size (amplitude 0.003 on a 0.6 red level).
const WEAK_PULSE_PCT = 0.5;
// The pulse counts as present in the light when the band power within RIGHT_BPM of the reference, or of its
// 2nd harmonic, is at least this share of the strongest peak's.
const PRESENT_SHARE = 0.25;
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
function bandPower(band) {
  return (bpm) => {
    const omega = (2 * Math.PI * bpm) / 60 / GRID_HZ;
    let re = 0;
    let im = 0;
    band.forEach((value, n) => {
      re += value * Math.cos(omega * n);
      im += value * Math.sin(omega * n);
    });
    return re * re + im * im;
  };
}

function spectralPeak(power) {
  let best = { bpm: null, power: -1 };
  for (let bpm = BAND_HZ[0] * 60; bpm <= BAND_HZ[1] * 60; bpm += 0.25) {
    const p = power(bpm);
    if (p > best.power) best = { bpm, power: p };
  }
  return best;
}

// Share of the peak's power near the reference rate or its 2nd harmonic (a dicrotic pulse puts most of its
// power there): whether the pulse is in the light at all, whatever the strongest rhythm is.
function pulseShare(power, peak, referenceBpm) {
  let near = 0;
  for (const centre of [referenceBpm, 2 * referenceBpm])
    for (let bpm = centre - RIGHT_BPM; bpm <= centre + RIGHT_BPM; bpm += 0.25)
      if (bpm >= BAND_HZ[0] * 60 && bpm <= BAND_HZ[1] * 60) near = Math.max(near, power(bpm));
  return near / peak.power;
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

// DSP-4 per frame, one count per failed test (a frame can fail several): which test keeps the finger from
// counting as on the lens. Clipping alone leaves a frame covered (contact.ts frameProblem), so it is counted
// apart. A frame uncovered by none of the three tests has values DSP-4 refuses (a channel outside 0..1, a
// non-finite stat): it gets its own count.
function contactTests(core, samples, stats) {
  const { minRedRatio, minRedMean, maxSpatialStdR, maxClipFrac } = core.DSP_CONFIG.dsp4;
  const failed = { invalidValues: 0, redRatio: 0, redLevel: 0, spatialSpread: 0 };
  let uncovered = 0;
  let clippedButCovered = 0;
  samples.forEach((sample, i) => {
    const stat = stats[i];
    const problem = core.frameProblem(sample, stat);
    if (problem === 'coverage') uncovered++;
    if (problem === 'clipping') clippedButCovered++;
    const ratioFails = !(sample.r >= minRedRatio * (sample.g + sample.b));
    const levelFails = !(sample.r >= minRedMean);
    const spreadFails = !(stat.spatialStdR <= maxSpatialStdR);
    if (ratioFails) failed.redRatio++;
    if (levelFails) failed.redLevel++;
    if (spreadFails) failed.spatialSpread++;
    // Uncovered by none of the three tests: frameProblem refused the values themselves.
    if (problem === 'coverage' && !ratioFails && !levelFails && !spreadFails) failed.invalidValues++;
  });
  const clipped = stats.filter((stat) => stat.clipFrac > maxClipFrac).length;
  return { uncovered, failed, clipped, clippedButCovered };
}

// Per reason; spans of different reasons overlap, so the reasons can add up to more than the time lost.
function lostByReason(core, analysis) {
  const lost = {};
  for (const reason of new Set(analysis.rejectedSpans.map((span) => span.reason))) {
    const spans = analysis.rejectedSpans.filter((span) => span.reason === reason);
    lost[reason] = analysis.durationS - core.cleanSeconds(0, analysis.durationS, spans);
  }
  return lost;
}

function verdicts({
  contact,
  frames,
  referenceBpm,
  savedBpm,
  spectral,
  liveBpm,
  exposureLostS,
  durationS,
  outcome,
  pulsePct,
}) {
  const lines = [];
  if (contact.uncovered > MOSTLY_LOST * frames) {
    const [test, count] = Object.entries(contact.failed).sort(([, x], [, y]) => y - x)[0];
    lines.push(
      `${((100 * contact.uncovered) / frames).toFixed(0)}% of frames fail DSP-4 contact${count > 0 ? `, mostly ${test === 'invalidValues' ? 'on values outside 0..1 or non-finite stats (a capture format problem)' : `the ${test} test`}` : ''}: the finger does not count as on the lens`,
    );
  }
  const exposureRefuses = exposureLostS > MOSTLY_LOST * durationS;
  if (exposureRefuses)
    lines.push(
      `exposure changes cost ${((100 * exposureLostS) / durationS).toFixed(0)}% of the capture: auto-exposure is not locked, and DSP-5 rejects 1 s after each change`,
    );
  if (outcome.kind === 'inconclusive') lines.push(`the reading is refused: ${outcome.reasons.join(', ')}`);
  if (pulsePct !== null && pulsePct < WEAK_PULSE_PCT)
    lines.push(
      `the pulse is weak (${pulsePct.toFixed(2)}% of the red level): noise peaks can pass as beats at this size`,
    );
  if (referenceBpm === null) {
    lines.push('no reference rate: pass --ref <bpm> (or record with the Polar strap) to judge the rates');
    return lines;
  }
  const off = (bpm) => Math.abs(bpm - referenceBpm) > RIGHT_BPM;
  const ratioName = (bpm) => {
    const ratio = bpm / referenceBpm;
    if (ratio > 1.8 && ratio < 2.2) return 'twice';
    if (ratio > 0.45 && ratio < 0.55) return 'half';
    return null;
  };
  // DSP-11 counts beats, so twice / half mean beats found twice / missed.
  if (savedBpm !== null) {
    const ratio = ratioName(savedBpm);
    lines.push(
      !off(savedBpm)
        ? `the saved rate is right (within ${RIGHT_BPM} bpm)`
        : ratio === 'twice'
          ? 'the saved rate is twice the reference: each beat found twice (a dicrotic wave or noise peak, ADR 0066)'
          : ratio === 'half'
            ? 'the saved rate is half the reference: every other beat missed (DSP-7 threshold raised)'
            : `the saved rate is off by ${(savedBpm - referenceBpm).toFixed(1)} bpm`,
    );
  }
  // The live and spectral rates find no beats: twice / half are a harmonic / subharmonic of the pulse.
  for (const [name, bpm] of [
    ['the live rate (median)', liveBpm],
    ['the spectral peak', spectral?.bpm ?? null],
  ]) {
    if (bpm === null) continue;
    const ratio = ratioName(bpm);
    lines.push(
      !off(bpm)
        ? `${name} is right (within ${RIGHT_BPM} bpm)`
        : ratio === 'twice'
          ? `${name} is on the pulse's 2nd harmonic (twice the reference)`
          : ratio === 'half'
            ? `${name} is on a subharmonic (half the reference)`
            : `${name} is off by ${(bpm - referenceBpm).toFixed(1)} bpm`,
    );
  }
  if (spectral === null) return lines;
  if (spectral.pulseShare < PRESENT_SHARE) {
    lines.push(
      '→ first problem: the light signal. The pulse is not among its strong rhythms (exposure, pressure, light leak, or the finger itself)',
    );
    return lines;
  }
  if (savedBpm === null || off(savedBpm))
    lines.push(
      `→ the pulse is in the light signal; the rate is lost after the camera, in ${
        exposureRefuses
          ? 'DSP-5 (exposure changes)'
          : outcome.kind === 'inconclusive'
            ? 'the rejection rules (see the lost seconds)'
            : 'beat detection (DSP-7/9)'
      }`,
    );
  return lines;
}

// One Appendix B capture folder: where between the camera and DSP-11 the heart rate goes wrong. The saved rate
// runs with sqi null, as replay does, so it can differ from the phone's when SQI-Net rejected windows there.
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
  const reference = referenceBpm ?? polarBpm(folder);
  const filtered = pulseBand(core, timebase.tS, timebase.r);
  const power = filtered ? bandPower(filtered) : null;
  const peak = power ? spectralPeak(power) : null;
  const band = peak
    ? { bpm: peak.bpm, pulseShare: reference === null ? null : pulseShare(power, peak, reference) }
    : null;
  // Pulse size as the 5–95% spread of the band over the median red level. Not DSP-10's perfusion index, and
  // exposure steps inflate it.
  const pulsePct = filtered
    ? (100 * (quantile(filtered, 0.95) - quantile(filtered, 0.05))) / median(Array.from(red))
    : null;
  const beats = analysis.segments.flat();
  const classes = {};
  for (const beat of beats) classes[beat.beatClass] = (classes[beat.beatClass] ?? 0) + 1;
  const live = liveRates(core, samples);
  const medianIntervalMs = median(intervalsMs);
  const meanIntervalMs = intervalsMs.reduce((sum, ms) => sum + ms, 0) / intervalsMs.length;

  const report = {
    folder,
    capture: {
      durationS: analysis.durationS,
      frames: samples.length,
      medianFps: 1000 / medianIntervalMs,
      intervalSdMs: Math.sqrt(
        intervalsMs.reduce((sum, ms) => sum + (ms - meanIntervalMs) ** 2, 0) / intervalsMs.length,
      ),
      gaps: intervalsMs.filter((ms) => ms > core.DSP_CONFIG.dsp2.maxGapS * 1000).length,
      exposureValues: new Set(stats.map((stat) => stat.exposureNs)).size,
      exposureChanges,
    },
    contact: contactTests(core, samples, stats),
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
      pulseShare: band?.pulseShare ?? null,
    },
    outcome,
  };
  report.verdicts = verdicts({
    contact: report.contact,
    frames: samples.length,
    referenceBpm: reference,
    savedBpm: analysis.heartRateBpm,
    spectral: band,
    liveBpm: live.rates.length ? median(live.rates) : null,
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
    `  Capture   ${capture.durationS.toFixed(1)} s, ${capture.frames} frames, ${capture.medianFps.toFixed(1)} fps median, interval sd ${capture.intervalSdMs.toFixed(1)} ms, ${capture.gaps} gaps over DSP-2's limit`,
    `  Exposure  ${capture.exposureValues === 1 ? 'one value (locked)' : `${capture.exposureValues} values, ${capture.exposureChanges} changes (${(capture.exposureChanges / capture.durationS).toFixed(2)}/s)`}`,
    `  Contact   ${report.contact.uncovered} of ${capture.frames} frames not covered (DSP-4); failing red ratio ${report.contact.failed.redRatio}, invalid values ${report.contact.failed.invalidValues}, red level ${report.contact.failed.redLevel}, spatial spread ${report.contact.failed.spatialSpread}; clipped ${report.contact.clipped} (${report.contact.clippedButCovered} of them still covered)`,
    `  Signal    red level ${signal.redLevel.toFixed(3)}, pulse ${signal.pulsePct === null ? '—' : `${signal.pulsePct.toFixed(2)}%`} of it`,
    `  Clean     ${clean.seconds.toFixed(1)} s${clean.needed === null ? '' : ` (needs ${clean.needed})`}; lost (reasons overlap): ${lost || 'none'}`,
    `  Beats     ${
      Object.entries(beats)
        .map(([name, count]) => `${count} ${name}`)
        .join(', ') || 'none'
    }`,
    `  Rates     reference ${bpmText(rates.reference)} | saved (sqi null) ${bpmText(rates.saved)} | live ${bpmText(rates.liveMedian)} (p10–p90 ${bpmText(rates.liveP10)}–${bpmText(rates.liveP90)}${rates.liveErrors ? `, ${rates.liveErrors} errors` : ''}) | spectral ${bpmText(rates.spectral)}${rates.pulseShare === null ? '' : ` (pulse share ${rates.pulseShare.toFixed(2)})`}`,
    `  Outcome   ${report.outcome.kind}`,
    ...report.verdicts.map((line, i) => `  ${i === 0 ? 'Verdict ' : '        '}  - ${line}`),
  ].join('\n');
}
