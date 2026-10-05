import { captureSizes } from './captureLayout';

describe('captureSizes', () => {
  it('uses the full picture before the body is measured and on a tall screen', () => {
    expect(captureSizes(0, false)).toMatchObject({ tight: false, preview: 190, ring: 148 });
    expect(captureSizes(900, false)).toMatchObject({ tight: false, preview: 190 });
  });

  it('grows the picture with the room it has', () => {
    expect(captureSizes(760, false).preview).toBeGreaterThan(captureSizes(700, false).preview);
  });

  it('goes tight on a short screen, with a ring that still holds its two lines', () => {
    const small = captureSizes(508, true);
    expect(small.tight).toBe(true);
    expect(small.ring).toBeGreaterThanOrEqual(104);
    expect(small.preview).toBeGreaterThanOrEqual(88);
    expect(small.preview).toBeLessThan(captureSizes(900, true).preview);
  });
});
