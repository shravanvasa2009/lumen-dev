import { DEFAULT_MODE, MODES, parseMode } from './mode';

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
  it('asks for 30 clean seconds on Quick Check and 90 on Full Scan', () => {
    expect(MODES.quick.cleanSeconds).toBe(30);
    expect(MODES.full.cleanSeconds).toBe(90);
  });

  it('makes Full Scan the default', () => {
    expect(DEFAULT_MODE).toBe('full');
  });
});
