import { bytesFromBase64, parseHeartRateMeasurement } from './heartRateMeasurement';

const bytes = (...values: number[]) => Uint8Array.from(values);

test('reads a uint8 heart rate with no RR intervals', () => {
  expect(parseHeartRateMeasurement(bytes(0x00, 72))).toEqual({ bpm: 72, contact: 'unsupported', rrMs: [] });
});

test('reads a little-endian uint16 heart rate', () => {
  expect(parseHeartRateMeasurement(bytes(0x01, 0x2c, 0x01)).bpm).toBe(300);
});

test('reports sensor contact from flag bits 1 and 2', () => {
  expect(parseHeartRateMeasurement(bytes(0x06, 60)).contact).toBe('detected');
  expect(parseHeartRateMeasurement(bytes(0x04, 60)).contact).toBe('notDetected');
});

test('converts RR intervals from 1/1024 s to ms, oldest first, unfiltered', () => {
  // 1024 → 1000 ms; 820 → 800.78125 ms; 100 → 97.65625 ms (an artifact, kept as the strap sent it).
  const measurement = parseHeartRateMeasurement(bytes(0x10, 61, 0x00, 0x04, 0x34, 0x03, 0x64, 0x00));
  expect(measurement.rrMs).toEqual([1000, 800.78125, 97.65625]);
});

test('skips the energy expended field before the RR intervals', () => {
  const measurement = parseHeartRateMeasurement(bytes(0x19, 0x48, 0x00, 0xff, 0xff, 0x00, 0x04));
  expect(measurement).toEqual({ bpm: 72, contact: 'unsupported', rrMs: [1000] });
});

test('refuses a measurement shorter than its flags promise', () => {
  expect(() => parseHeartRateMeasurement(bytes())).toThrow(RangeError);
  expect(() => parseHeartRateMeasurement(bytes(0x01, 60))).toThrow(RangeError);
  expect(() => parseHeartRateMeasurement(bytes(0x08, 60, 0x01))).toThrow(RangeError);
  expect(() => parseHeartRateMeasurement(bytes(0x10, 60, 0x00, 0x04, 0x01))).toThrow(RangeError);
});

test('decodes base64 as ble-plx delivers characteristic values', () => {
  expect(Array.from(bytesFromBase64('EDwABA=='))).toEqual([0x10, 0x3c, 0x00, 0x04]);
  expect(Array.from(bytesFromBase64('AEg='))).toEqual([0x00, 0x48]);
  expect(Array.from(bytesFromBase64('+/8A'))).toEqual([0xfb, 0xff, 0x00]);
  expect(() => bytesFromBase64('E*==')).toThrow(RangeError);
});
