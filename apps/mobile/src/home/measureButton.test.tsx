import { measureLayout } from './MeasureButton';

// 320 is the regular size (a 256 dp disc, the approved mockup); 164 is the 360 x 640 size.
describe('Measure button layout', () => {
  it.each([320, 164])(
    'keeps the English label and mode line where the fill stays readable at size %s',
    (size) => {
      const { cornerFromFocus, readableReach } = measureLayout(size, 1);
      expect(cornerFromFocus).toBeLessThanOrEqual(readableReach);
    },
  );

  it('keeps a Spanish mode line that wraps to two lines readable on the regular size', () => {
    const { cornerFromFocus, readableReach } = measureLayout(320, 2);
    expect(cornerFromFocus).toBeLessThanOrEqual(readableReach);
  });

  it('makes the regular disc larger than the 208 dp one it replaces', () => {
    expect(measureLayout(320, 1).discRadius * 2).toBe(256);
  });

  it('sets the mode line in the mockup sizes, not caption size', () => {
    expect(measureLayout(320, 1).text).toMatchObject({ label: 40, mode: 16 });
    expect(measureLayout(164, 1).text).toMatchObject({ label: 26, mode: 14 });
  });
});
