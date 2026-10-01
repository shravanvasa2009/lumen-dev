// VER-1 (spec §16, §22.1): before evidence.json is frozen, a second agent recomputes the key metrics from
// the raw captures with its own code, and the two metrics.json files must agree. Counts must be equal.
// Continuous values may differ only by rounding between two independent implementations.
const TOLERANCE = 0.1;

const KEYS = [
  'hr.maeBpm',
  'hr.people',
  'hr.readings',
  'intervals.maeMs',
  'rmssd.withinPct',
  'rmssd.people',
  'resp.maeBrpm',
  'artifactCaptures.total',
  'artifactCaptures.rejectedOrInconclusive',
  'ux1.firstReadings',
  'ux1.conclusive',
  'ml5.sinusReadings',
  'ml5.falseIrregular',
];

const read = (metrics, key) => key.split('.').reduce((value, part) => value?.[part], metrics);

function agrees(a, b) {
  if (a == null || b == null) return a == null && b == null;
  return Number.isInteger(a) && Number.isInteger(b) ? a === b : Math.abs(a - b) <= TOLERANCE;
}

export function compareMetrics(primary, independent) {
  const differences = KEYS.filter((key) => !agrees(read(primary, key), read(independent, key))).map(
    (key) => `${key}: ${read(primary, key)} vs ${read(independent, key)}`,
  );
  const tiers = new Set([...primary.perTier, ...independent.perTier].map((row) => row.tier));
  for (const tier of tiers) {
    const mine = primary.perTier.find((row) => row.tier === tier) ?? {};
    const theirs = independent.perTier.find((row) => row.tier === tier) ?? {};
    for (const key of ['phones', 'hrMaeBpm', 'intervalMaeMs'])
      if (!agrees(mine[key], theirs[key]))
        differences.push(`perTier.${tier}.${key}: ${mine[key]} vs ${theirs[key]}`);
  }
  return { matches: differences.length === 0, differences };
}
