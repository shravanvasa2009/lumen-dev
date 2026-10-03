// Pass rules that turn metrics.json into evidence.json labels (acceptance DSP-A, DSP-B, RESP-1; the
// owner's answers to H-026 are in workspace ADR 0044). A metric reads "Checked vs reference" only when
// its rule passes (EVID-1).
const MIN_PEOPLE = 10;
const HR_MAX_MAE_BPM = 3;
const INTERVAL_MAX_MAE_MS = 25;
const RMSSD_MAX_MEDIAN_ERROR_PCT = 10;
// RESP-1 is "MAE < 2", strictly below.
const RESP_MAE_BELOW_BRPM = 2;

const atMost = (value, limit) => typeof value === 'number' && value <= limit;
const enoughPeople = (people) => typeof people === 'number' && people >= MIN_PEOPLE;
// DSP-A is published "with a subject-level 95% CI" (acceptance), and the M5 proof needs a CI for any label
// above experimental, so no CI means no pass.
const hasInterval = (ci95) => Array.isArray(ci95) && ci95.length === 2;

export function decidePasses(metrics) {
  return {
    hr:
      atMost(metrics.hr?.maeBpm, HR_MAX_MAE_BPM) &&
      enoughPeople(metrics.hr?.people) &&
      hasInterval(metrics.hr?.ci95),
    hrv:
      atMost(metrics.intervals?.maeMs, INTERVAL_MAX_MAE_MS) &&
      hasInterval(metrics.intervals?.ci95) &&
      atMost(metrics.rmssd?.medianErrorPct, RMSSD_MAX_MEDIAN_ERROR_PCT) &&
      enoughPeople(metrics.rmssd?.people),
    resp:
      typeof metrics.resp?.maeBrpm === 'number' &&
      metrics.resp.maeBrpm < RESP_MAE_BELOW_BRPM &&
      enoughPeople(metrics.resp?.people),
  };
}

const labelFor = (passed) => (passed ? 'checked' : 'experimental');

// rhythm, diabetes and extraBeats come from the model external tests, so they are carried over unchanged.
export function buildEvidence(metrics, previous) {
  const passed = decidePasses(metrics);
  return {
    ...previous,
    commit: metrics.commit,
    date: metrics.date,
    metrics: {
      ...previous.metrics,
      hr: {
        label: labelFor(passed.hr),
        reference: 'Polar H10',
        maeBpm: metrics.hr.maeBpm,
        ci95: metrics.hr.ci95,
        people: metrics.hr.people,
        phones: metrics.hr.phones,
        criterion: 'DSP-A',
        passed: passed.hr,
      },
      // The interval MAE and its subject-level CI are half of DSP-B, so they are published with it.
      hrv: {
        label: labelFor(passed.hrv),
        reference: 'Polar H10',
        withinPct: metrics.rmssd.withinPct,
        medianErrorPct: metrics.rmssd.medianErrorPct,
        intervalMaeMs: metrics.intervals.maeMs,
        ci95: metrics.intervals.ci95,
        people: metrics.rmssd.people,
        criterion: 'DSP-B',
        passed: passed.hrv,
      },
      resp: {
        label: labelFor(passed.resp),
        reference: 'metronome',
        maeBrpm: metrics.resp.maeBrpm,
        people: metrics.resp.people,
        criterion: 'RESP-1',
        passed: passed.resp,
      },
    },
  };
}

const interval = (metric) =>
  metric == null ? null : { estimate: metric.estimate, ci95: [metric.low, metric.high] };

// §11.3: false-AF rate on premature beats and the reading abstain rate, copied from the shipped rhythm model's
// development validation (augmented data). They never touch the rhythm label or passed, which come only from the
// external test; `source` is a fixed code the app translates.
export function withRhythmDevelopment(evidence, manifest) {
  const shipped = (manifest.models ?? []).filter((model) => model.ships === true && model.family === 'rhythm');
  if (shipped.length !== 1) throw new Error(`manifest has ${shipped.length} shipped rhythm models; need exactly 1`);
  const metrics = shipped[0].development?.metrics;
  if (metrics == null) throw new Error(`${shipped[0].name} has no development metrics`);
  return {
    ...evidence,
    metrics: {
      ...evidence.metrics,
      rhythm: {
        ...evidence.metrics.rhythm,
        falseAfRatePrematureReadings: interval(metrics.falseAfRatePrematureReadings),
        readingAbstainRate: interval(metrics.readingAbstainRate),
        source: 'dev-augmented-premature',
      },
    },
  };
}
