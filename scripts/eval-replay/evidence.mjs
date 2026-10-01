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

export function decidePasses(metrics) {
  return {
    hr: atMost(metrics.hr?.maeBpm, HR_MAX_MAE_BPM) && enoughPeople(metrics.hr?.people),
    hrv:
      atMost(metrics.intervals?.maeMs, INTERVAL_MAX_MAE_MS) &&
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
