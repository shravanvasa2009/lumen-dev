import { lowerOffsetNs, stampStrapRr } from './strapClock';

test('keeps the smallest JS-minus-camera offset seen over the sample batches', () => {
  let offset: number | null = null;
  offset = lowerOffsetNs(offset, 5_000_000_000, 1_000_000_000);
  offset = lowerOffsetNs(offset, 5_120_000_000, 1_100_000_000);
  offset = lowerOffsetNs(offset, 5_400_000_000, 1_200_000_000);
  expect(offset).toBe(4_000_000_000);
});

test('stamps the newest RR at the notification time and earlier ones back by cumulative RR', () => {
  const stamped = stampStrapRr(
    [
      { jsNs: 10_000_000_000, rrMs: [800] },
      { jsNs: 11_900_000_000, rrMs: [1000, 900] },
    ],
    4_000_000_000,
  );
  expect(stamped).toEqual({
    tNs: [6_000_000_000, 7_000_000_000, 7_900_000_000],
    rrMs: [800, 1000, 900],
  });
});

test('rounds to whole ns, as samples.csv writes t_ns', () => {
  const stamped = stampStrapRr([{ jsNs: 10_000_000_000.4, rrMs: [800.78125, 1000] }], 0);
  expect(stamped?.tNs).toEqual([9_000_000_000, 10_000_000_000]);
});

test('has nothing to send without RR values or without a camera clock offset', () => {
  expect(stampStrapRr([], 0)).toBeUndefined();
  expect(stampStrapRr([{ jsNs: 1, rrMs: [] }], 0)).toBeUndefined();
  expect(stampStrapRr([{ jsNs: 1, rrMs: [800] }], null)).toBeUndefined();
});
