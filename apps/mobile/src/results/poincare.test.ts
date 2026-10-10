import { medianIntervalMs, rhythmMapShape } from './poincare';

describe('rhythmMapShape', () => {
  it('has no spread below three intervals', () => {
    expect(rhythmMapShape([900, 910])).toBeNull();
  });

  it('is zero in SD1 for perfectly even beats and wide in SD2 for a drifting rate', () => {
    const steady = rhythmMapShape([800, 800, 800, 800]);
    expect(steady?.sd1Ms).toBeCloseTo(0);
    const drifting = rhythmMapShape([800, 850, 900, 950, 1000]);
    expect(drifting?.sd1Ms).toBeCloseTo(0);
    expect(drifting?.sd2Ms).toBeGreaterThan(50);
  });

  it('is wide in SD1 when short and long gaps alternate', () => {
    const alternating = rhythmMapShape([600, 1000, 600, 1000, 600]);
    expect(alternating?.sd1Ms).toBeGreaterThan(250);
    expect(alternating?.pairs).toBe(4);
  });
});

describe('medianIntervalMs', () => {
  it('takes the middle gap and averages the two middle gaps of an even count', () => {
    expect(medianIntervalMs([900, 100, 930])).toBe(900);
    expect(medianIntervalMs([900, 920, 940, 960])).toBe(930);
  });

  it('is null with no intervals', () => {
    expect(medianIntervalMs([])).toBeNull();
  });
});
