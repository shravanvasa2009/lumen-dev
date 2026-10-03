import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Reader for BUT PPG 2.0.0 (Nemcova et al., PhysioNet 2024, doi:10.13026/tn53-8153). The data stay
// outside the repo; LUMEN_BUTPPG_DIR points at the unpacked dataset.

export interface ButPpgRecord {
  id: string;
  subject: string; // first three digits of the ID (ADR 0025)
  quality: number; // quality-hr-ann.csv: 1 = PPG heart rate within 5 bpm of the ECG reference
  site: number; // subject-info.csv "Ear/finger": 0 ear, 1 finger
  motion: number; // subject-info.csv "Motion": 0 = at rest
  rateHz: number;
  red: number[]; // mean red per frame, frame k at k / rateHz (the files carry no frame timestamps)
  qrsS: number[]; // ECG R peaks, seconds from the ECG start
}

export function butPpgDir(): string {
  const dir = process.env.LUMEN_BUTPPG_DIR;
  if (!dir)
    throw new Error(
      'LUMEN_BUTPPG_DIR is not set. Point it at the unpacked BUT PPG 2.0.0 folder (the one holding ' +
        'quality-hr-ann.csv), e.g. data/public/open/butppg in the private workspace.',
    );
  return dir;
}

const BYTE_ORDER_MARK = 0xfeff;
const withoutByteOrderMark = (text: string) =>
  text.charCodeAt(0) === BYTE_ORDER_MARK ? text.slice(1) : text;

// Rows keyed by ID; the files start with a UTF-8 byte-order mark and have no quoted fields.
function csvRows(path: string): Map<string, Record<string, string>> {
  const lines = withoutByteOrderMark(readFileSync(path, 'utf8')).split(/\r?\n/).filter(Boolean);
  const columns = lines[0]!.split(',');
  const rows = new Map<string, Record<string, string>>();
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    rows.set(cells[0]!, Object.fromEntries(columns.map((column, i) => [column, cells[i] ?? ''])));
  }
  return rows;
}

const headerLines = (path: string) =>
  readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '' && !line.startsWith('#'));

interface WfdbSignal {
  gain: number;
  baseline: number;
  initialValue: number;
  checksum: number;
  name: string;
}

// WFDB header (https://physionet.org/physiotools/wag/header-5.htm): record line "name nsig fs nsamp",
// then one line per signal "file format gain(baseline)/units adcres adczero initval checksum blocksize
// description". Only format 16 (little-endian int16, signals interleaved) occurs in this dataset.
function readWfdbHeader(path: string) {
  const [recordLine, ...signalLines] = headerLines(path);
  const [, signalCount, rateHz, sampleCount] = recordLine!.split(/\s+/);
  const signals = signalLines.map((line): WfdbSignal => {
    const fields = line.trim().split(/\s+/);
    if (fields[1] !== '16') throw new Error(`${path}: format ${fields[1]}, only 16 is read`);
    const gainField = /^(-?[\d.eE+-]+)\((-?\d+)\)/.exec(fields[2]!);
    if (!gainField) throw new Error(`${path}: cannot read gain and baseline from "${fields[2]}"`);
    return {
      gain: Number(gainField[1]),
      baseline: Number(gainField[2]),
      initialValue: Number(fields[5] ?? 0),
      checksum: Number(fields[6] ?? 0),
      name: fields[8] ?? '',
    };
  });
  if (signals.length !== Number(signalCount))
    throw new Error(`${path}: ${signals.length} signal lines, header says ${signalCount}`);
  return { rateHz: Number(rateHz), sampleCount: Number(sampleCount), signals };
}

// Physical values per signal: (digital − baseline) / gain.
function readWfdbSignals(base: string): { rateHz: number; signals: WfdbSignal[]; values: number[][] } {
  const { rateHz, sampleCount, signals } = readWfdbHeader(`${base}.hea`);
  const bytes = readFileSync(`${base}.dat`);
  if (bytes.length !== 2 * sampleCount * signals.length)
    throw new Error(`${base}.dat: ${bytes.length} bytes, expected ${2 * sampleCount * signals.length}`);
  const values = signals.map((signal, s) => {
    const digital = Array.from({ length: sampleCount }, (_, k) =>
      bytes.readInt16LE(2 * (k * signals.length + s)),
    );
    // The header's initial value and 16-bit checksum guard against reading the layout wrongly.
    const sum = digital.reduce((total, value) => total + value, 0);
    const checksum = (((sum % 65536) + 65536 + 32768) % 65536) - 32768;
    if (digital[0] !== signal.initialValue || checksum !== signal.checksum)
      throw new Error(`${base}.dat: signal ${s} does not match its header (initial value or checksum)`);
    return digital.map((value) => (value - signal.baseline) / signal.gain);
  });
  return { rateHz, signals, values };
}

// Two layouts occur. Records from 112001 on hold PPG_R, PPG_G and PPG_B, 300 samples each. Earlier
// records are transposed: the record line reads "<id>_PPG 300 30 1", i.e. 300 one-sample signals at
// 30 Hz, one per frame, all digital values 0, so each frame's value is −baseline / gain. Those frames
// are already inverted red ("Finally, the PPG signal was inverted", dataset page), so red is −value.
function readRed(dir: string, id: string): { rateHz: number; red: number[] } {
  const { rateHz, signals, values } = readWfdbSignals(join(dir, id, `${id}_PPG`));
  const redIndex = signals.findIndex(({ name }) => name === 'PPG_R');
  if (redIndex >= 0) return { rateHz, red: values[redIndex]! };
  if (values.every((frame) => frame.length === 1)) return { rateHz, red: values.map((frame) => -frame[0]!) };
  throw new Error(`${id}: no PPG_R signal and not one sample per signal`);
}

// MIT annotation format (https://physionet.org/physiotools/wag/annot-5.htm): 16-bit little-endian
// words, annotation type in the top 6 bits, time increment in the low 10. SKIP (59) carries a 32-bit
// increment in the next two words, high word first; NUM, SUB and CHN (60–62) carry no time; AUX (63)
// is followed by its byte count, padded to an even length. Type 0 with increment 0 ends the file.
const SKIP = 59;
const AUX = 63;
function readMitAnnotationSamples(path: string): number[] {
  const bytes = readFileSync(path);
  const samples: number[] = [];
  let sample = 0;
  for (let i = 0; i + 1 < bytes.length;) {
    const word = bytes.readUInt16LE(i);
    const type = word >> 10;
    const increment = word & 0x3ff;
    if (type === 0 && increment === 0) break;
    if (type === SKIP) {
      sample += (bytes.readInt16LE(i + 2) << 16) | bytes.readUInt16LE(i + 4);
      i += 6;
    } else if (type === AUX) {
      i += 2 + increment + (increment % 2);
    } else if (type > SKIP) {
      i += 2;
    } else {
      sample += increment;
      samples.push(sample);
      i += 2;
    }
  }
  return samples;
}

// The .qrs file counts ECG samples; the ECG rate is the third field of the ECG header's record line.
function readQrsS(dir: string, id: string): number[] {
  const ecgRateHz = Number(headerLines(join(dir, id, `${id}_ECG.hea`))[0]!.split(/\s+/)[2]);
  return readMitAnnotationSamples(join(dir, id, `${id}.qrs`)).map((sample) => sample / ecgRateHz);
}

// Every BUT PPG record listed in quality-hr-ann.csv that passes `keep`, with its signals read.
export function readButPpg(
  dir: string,
  keep: (labels: Omit<ButPpgRecord, 'rateHz' | 'red' | 'qrsS'>) => boolean,
): ButPpgRecord[] {
  const quality = csvRows(join(dir, 'quality-hr-ann.csv'));
  const subjects = csvRows(join(dir, 'subject-info.csv'));
  const records: ButPpgRecord[] = [];
  for (const [id, labels] of quality) {
    const subjectRow = subjects.get(id);
    if (!subjectRow) throw new Error(`${id}: in quality-hr-ann.csv but not in subject-info.csv`);
    const label = {
      id,
      subject: id.slice(0, 3),
      quality: Number(labels.Quality),
      site: Number(subjectRow['Ear/finger']),
      motion: Number(subjectRow.Motion),
    };
    if (!keep(label)) continue;
    records.push({ ...label, ...readRed(dir, id), qrsS: readQrsS(dir, id) });
  }
  return records.sort((a, b) => a.id.localeCompare(b.id));
}
