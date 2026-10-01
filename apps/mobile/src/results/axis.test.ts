import { intervalAxis } from './axis';

describe('intervalAxis', () => {
  it('keeps 400 to 1200 ms for a reading inside it', () => {
    expect(intervalAxis([930, 945, 962])).toEqual({ lowMs: 400, highMs: 1200 });
  });

  it('widens for a reading above 150 bpm so no beat is flattened at the edge', () => {
    expect(intervalAxis([320, 330, 340])).toEqual({ lowMs: 300, highMs: 1200 });
  });

  it('widens for a slow reading', () => {
    expect(intervalAxis([1250, 1400])).toEqual({ lowMs: 400, highMs: 1400 });
  });
});
