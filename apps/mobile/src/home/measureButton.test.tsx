import { measureLayout } from './MeasureButton';

// 320 is the regular size (a 256 dp disc, the approved mockup); 200 is the 360 x 640 size.
describe('Measure button layout', () => {
  it.each([320, 200])('keeps the label and mode line inside the solid disc at size %s', (size) => {
    const { solidRadius, textCorner } = measureLayout(size, 18);
    expect(textCorner).toBeLessThanOrEqual(solidRadius);
  });

  it('makes the regular disc larger than the 208 dp one it replaces', () => {
    expect(measureLayout(320, 18).discRadius * 2).toBe(256);
  });
});
