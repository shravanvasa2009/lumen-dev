// VER-1 (spec §16, §22.1): before evidence.json is frozen, a second agent recomputes the key metrics from
// the raw captures with its own code, and the two metrics.json files must agree.
// metrics.json rounds every continuous value to 0.01 in its own unit (bpm, ms, %, breaths/min), so two
// correct implementations can differ by one rounding step and no more. The 1e-9 absorbs float noise.
const ROUNDING_STEP = 0.01 + 1e-9;

const COUNTS = [
  'polarPairedCaptures',
  'hr.people',
  'hr.readings',
  'hr.phones',
  'rmssd.people',
  'resp.people',
  'artifactCaptures.total',
  'artifactCaptures.rejectedOrInconclusive',
  'ux1.firstReadings',
  'ux1.conclusive',
  'ml5.sinusReadings',
  'ml5.falseIrregular',
];
const VALUES = ['hr.maeBpm', 'intervals.maeMs', 'rmssd.withinPct', 'resp.maeBrpm'];
// The CIs agree only when both sides run the same seeded subject bootstrap (2000 draws, seed 20261026,
// mulberry32, linearly interpolated percentiles), which is part of the VER-1 protocol.
const INTERVALS = ['hr.ci95', 'intervals.ci95'];

const read = (metrics, key) => key.split('.').reduce((value, part) => value?.[part], metrics);
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

function sameCount(a, b) {
  return a == null || b == null
    ? a == null && b == null
    : Number.isInteger(a) && Number.isInteger(b) && a === b;
}

function sameValue(a, b) {
  return a == null || b == null
    ? a == null && b == null
    : isNumber(a) && isNumber(b) && Math.abs(a - b) <= ROUNDING_STEP;
}

function sameInterval(a, b) {
  if (a == null || b == null) return a == null && b == null;
  return (
    Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === 2 &&
    b.length === 2 &&
    a.every((v, i) => sameValue(v, b[i]))
  );
}

export function compareMetrics(primary, independent) {
  const differences = [];
  const check = (keys, same) => {
    for (const key of keys) {
      const [mine, theirs] = [read(primary, key), read(independent, key)];
      if (!same(mine, theirs))
        differences.push(`${key}: ${JSON.stringify(mine)} vs ${JSON.stringify(theirs)}`);
    }
  };
  check(COUNTS, sameCount);
  check(VALUES, sameValue);
  check(INTERVALS, sameInterval);
  const tiers = new Set([...primary.perTier, ...independent.perTier].map((row) => row.tier));
  for (const tier of tiers) {
    const mine = primary.perTier.find((row) => row.tier === tier);
    const theirs = independent.perTier.find((row) => row.tier === tier);
    if (!mine || !theirs) {
      differences.push(`perTier.${tier}: only in the ${mine ? 'primary' : 'independent'} metrics`);
      continue;
    }
    if (!sameCount(mine.phones, theirs.phones))
      differences.push(
        `perTier.${tier}.phones: ${JSON.stringify(mine.phones)} vs ${JSON.stringify(theirs.phones)}`,
      );
    for (const key of ['hrMaeBpm', 'intervalMaeMs'])
      if (!sameValue(mine[key], theirs[key]))
        differences.push(
          `perTier.${tier}.${key}: ${JSON.stringify(mine[key])} vs ${JSON.stringify(theirs[key])}`,
        );
  }
  return { matches: differences.length === 0, differences };
}
