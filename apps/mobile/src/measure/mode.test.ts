import { cleanSecondsNeeded, DEFAULT_MODE, MODES, parseMode, processingHref } from './mode';

describe('parseMode', () => {
  it('accepts quick and full', () => {
    expect(parseMode('quick')).toBe('quick');
    expect(parseMode('full')).toBe('full');
  });

  it('falls back to full for anything else', () => {
    expect(parseMode(undefined)).toBe('full');
    expect(parseMode('deep')).toBe('full');
    expect(parseMode(['quick', 'full'])).toBe('full');
  });
});

describe('MODES', () => {
  it('lists the duration of every mode in the spec table', () => {
    expect(MODES.quick.duration).toEqual({ amount: 30, unit: 'seconds' });
    expect(MODES.full.duration).toEqual({ amount: 90, unit: 'seconds' });
    expect(MODES.deep.duration).toEqual({ amount: 5, unit: 'minutes' });
    expect(MODES.standing.duration).toEqual({ amount: 12, unit: 'minutes', approximate: true });
  });

  it('makes Full Scan the default', () => {
    expect(DEFAULT_MODE).toBe('full');
  });
});

describe('cleanSecondsNeeded', () => {
  it('is 30 for Quick Check and 90 for Full Scan', () => {
    expect(cleanSecondsNeeded('quick')).toBe(30);
    expect(cleanSecondsNeeded('full')).toBe(90);
  });
});

describe('processingHref', () => {
  it('carries only the params that were given', () => {
    expect(processingHref('quick')).toBe('/measure/processing?mode=quick');
    expect(processingHref('full', 'true', 'caffeine,ill')).toBe(
      '/measure/processing?mode=full&restDone=true&context=caffeine%2Cill',
    );
  });
});
