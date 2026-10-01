import { parseMode } from './mode';

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
