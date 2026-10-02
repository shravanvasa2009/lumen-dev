// Heart Rate Measurement (0x2A37), Bluetooth SIG GATT Specification Supplement:
// https://bitbucket.org/bluetooth-SIG/public/src/main/gss/org.bluetooth.characteristic.heart_rate_measurement.yaml
// Flags byte: bit 0 HR is uint16 (else uint8), bit 1 contact detected, bit 2 contact supported, bit 3 Energy
// Expended (uint16) present, bit 4 RR intervals (uint16 each, 1/1024 s, oldest first) present. Little-endian.
const HR_UINT16 = 0x01;
const CONTACT_DETECTED = 0x02;
const CONTACT_SUPPORTED = 0x04;
const ENERGY_PRESENT = 0x08;
const RR_PRESENT = 0x10;
const RR_UNITS_PER_S = 1024;

export interface HeartRateMeasurement {
  bpm: number;
  contact: 'detected' | 'notDetected' | 'unsupported';
  rrMs: number[];
}

export function parseHeartRateMeasurement(bytes: Uint8Array): HeartRateMeasurement {
  const need = (end: number) => {
    if (bytes.length < end)
      throw new RangeError(
        `Heart Rate Measurement has ${bytes.length} bytes; its flags need at least ${end}`,
      );
  };
  const uint16At = (offset: number) => bytes[offset]! | (bytes[offset + 1]! << 8);
  need(1);
  const flags = bytes[0]!;
  let offset = 1;
  let bpm: number;
  if (flags & HR_UINT16) {
    need(offset + 2);
    bpm = uint16At(offset);
    offset += 2;
  } else {
    need(offset + 1);
    bpm = bytes[offset]!;
    offset += 1;
  }
  if (flags & ENERGY_PRESENT) {
    need(offset + 2);
    offset += 2;
  }
  const rrMs: number[] = [];
  if (flags & RR_PRESENT) {
    if ((bytes.length - offset) % 2 !== 0)
      throw new RangeError(
        `Heart Rate Measurement RR field has an odd length, ${bytes.length - offset} bytes`,
      );
    for (; offset < bytes.length; offset += 2) rrMs.push((uint16At(offset) / RR_UNITS_PER_S) * 1000);
  }
  const contact = !(flags & CONTACT_SUPPORTED)
    ? 'unsupported'
    : flags & CONTACT_DETECTED
      ? 'detected'
      : 'notDetected';
  return { bpm, contact, rrMs };
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// ble-plx hands characteristic values over as base64 strings. Decoded here rather than with a global atob,
// which Hermes may not provide.
export function bytesFromBase64(text: string): Uint8Array {
  const digits = text.replace(/=+$/, '');
  const bytes = new Uint8Array(Math.floor((digits.length * 6) / 8));
  let bits = 0;
  let bitCount = 0;
  let index = 0;
  for (const char of digits) {
    const digit = BASE64_ALPHABET.indexOf(char);
    if (digit < 0) throw new RangeError(`"${char}" is not a base64 digit`);
    // At most 13 bits are still unread, so the buffer never needs more than 14.
    bits = ((bits << 6) | digit) & 0x3fff;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes[index++] = (bits >> bitCount) & 0xff;
    }
  }
  return bytes;
}
