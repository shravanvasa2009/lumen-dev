import { captureSizes } from './captureLayout';

describe('captureSizes', () => {
  it('uses the 176 dp live view with a 150 dp ring before the body is measured and on a roomy screen', () => {
    expect(captureSizes(0, false)).toMatchObject({ tight: false, preview: 176, ring: 150 });
    expect(captureSizes(900, false)).toMatchObject({ tight: false, preview: 176, ring: 150 });
  });

  it('keeps the full view on a mid-height phone and lets the body scroll', () => {
    expect(captureSizes(700, true)).toMatchObject({ tight: false, preview: 176 });
  });

  it('goes tight on a short screen, with a ring that still holds its two lines', () => {
    const small = captureSizes(508, true);
    expect(small.tight).toBe(true);
    expect(small.ring).toBeGreaterThanOrEqual(104);
    expect(small.preview).toBeGreaterThanOrEqual(88);
    expect(small.preview).toBeLessThan(176);
  });

  it('gives a taller short screen a larger view, up to the tight maximum', () => {
    expect(captureSizes(590, false).preview).toBeGreaterThan(captureSizes(508, false).preview);
    expect(captureSizes(599, false).preview).toBeLessThanOrEqual(140);
  });
});
