import type {
  CameraPermission,
  Capabilities,
  CaptureConfig,
  CaptureStatus,
  CaptureSummary,
  FrameStat,
  LumenCaptureEvents,
  LumenCaptureModule,
  Sample,
} from './LumenCapture.types';

// Column arrays, as the capture receiver request carries them (Appendix B), plus the phone the capture came
// from.
export interface RecordedCapture {
  capabilities: Capabilities;
  samples: { tNs: number[]; r: number[]; g: number[]; b: number[] };
  stats?: { tNs: number[]; spatialStdR: number[]; clipFrac: number[]; exposureNs: number[] };
}

const BATCH_MS = 100; // spec §9.3
const STATUS_MS = 250; // 4 Hz, spec §9.3
const FPS_WINDOW_NS = 1e9;
// DSP-1: a gap longer than 1.5x the median frame interval is a dropped frame. Mirrors the initial value
// that @lumen/core keeps in config.ts; this copy only feeds the live status readout.
const DROP_GAP_FACTOR = 1.5;

const GRANTED: CameraPermission = { status: 'granted', expires: 'never', granted: true, canAskAgain: true };

type Subscription = { remove(): void };

function rowsFromColumns<K extends string>(columns: Record<K, number[]>, keys: K[]): Record<K, number>[] {
  const lengths = keys.map((key) => columns[key].length);
  if (lengths.some((length) => length !== lengths[0]))
    throw new Error(`recording columns ${keys.join(', ')} have different lengths`);
  return Array.from({ length: lengths[0] ?? 0 }, (_, i) =>
    Object.fromEntries(keys.map((key) => [key, columns[key][i]])),
  ) as Record<K, number>[];
}

function medianInterval(rows: Sample[]): number {
  const gaps = rows
    .slice(1)
    .map((row, i) => row.tNs - (rows[i]?.tNs ?? row.tNs))
    .sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] ?? 0;
}

// Plays a recorded capture through the Appendix A interface in real time: 100 ms sample batches and
// 4 Hz status, as the native modules emit them. Used for emulators, CI, tests, and Demo mode.
export class ReplayCapture implements LumenCaptureModule {
  private readonly capabilities: Capabilities;
  private readonly sampleRows: Sample[];
  private readonly statRows: FrameStat[];
  private readonly medianNs: number;
  private readonly listeners: { [E in keyof LumenCaptureEvents]: Set<LumenCaptureEvents[E]> } = {
    samples: new Set(),
    status: new Set(),
    lab: new Set(),
  };
  private timers: ReturnType<typeof setInterval>[] = [];
  private sampleCursor = 0;
  private statCursor = 0;
  private batchesSent = 0;
  private dropped = 0;
  private lensId?: string;

  constructor(recording: RecordedCapture) {
    this.capabilities = recording.capabilities;
    this.sampleRows = rowsFromColumns(recording.samples, ['tNs', 'r', 'g', 'b']);
    this.statRows = recording.stats
      ? rowsFromColumns(recording.stats, ['tNs', 'spatialStdR', 'clipFrac', 'exposureNs'])
      : [];
    if (this.sampleRows.length < 2) throw new Error('recording needs at least 2 samples');
    this.medianNs = medianInterval(this.sampleRows);
    if (this.medianNs <= 0)
      throw new Error('recording timestamps must increase (median frame interval is 0)');
  }

  async getCapabilities(): Promise<Capabilities> {
    return this.capabilities;
  }

  // A recording needs no camera, so there is nothing to ask for.
  async getPermission(): Promise<CameraPermission> {
    return GRANTED;
  }

  async requestPermission(): Promise<CameraPermission> {
    return GRANTED;
  }

  async start(config: CaptureConfig): Promise<void> {
    this.clearTimers();
    this.sampleCursor = 0;
    this.statCursor = 0;
    this.batchesSent = 0;
    this.dropped = 0;
    this.lensId = config.lensId ?? this.capabilities.rearLenses[0]?.id;
    this.timers = [
      setInterval(() => this.emitBatch(), BATCH_MS),
      setInterval(() => this.emitStatus(), STATUS_MS),
    ];
  }

  async stop(): Promise<CaptureSummary> {
    this.clearTimers();
    const firstNs = this.sampleRows[0]?.tNs ?? 0;
    return {
      startedNs: firstNs,
      stoppedNs: this.sampleRows[this.sampleCursor - 1]?.tNs ?? firstNs,
      lensId: this.lensId,
      frames: this.sampleCursor,
      dropped: this.dropped,
    };
  }

  // The torch and the locks were applied when the capture was recorded; replaying cannot change them.
  async setTorch(): Promise<void> {}

  async lockExposure(): Promise<void> {}

  addListener<E extends keyof LumenCaptureEvents>(e: E, cb: LumenCaptureEvents[E]): Subscription {
    const subscribers = this.listeners[e];
    subscribers.add(cb);
    return {
      remove: () => {
        subscribers.delete(cb);
      },
    };
  }

  private clearTimers(): void {
    this.timers.forEach((timer) => clearInterval(timer));
    this.timers = [];
  }

  private emitBatch(): void {
    this.batchesSent += 1;
    const edgeNs = (this.sampleRows[0]?.tNs ?? 0) + this.batchesSent * BATCH_MS * 1e6;

    const samples: Sample[] = [];
    let next = this.sampleRows[this.sampleCursor];
    while (next && next.tNs < edgeNs) {
      const previous = this.sampleRows[this.sampleCursor - 1];
      const gapNs = previous ? next.tNs - previous.tNs : 0;
      if (gapNs > DROP_GAP_FACTOR * this.medianNs) {
        this.dropped += Math.round(gapNs / this.medianNs) - 1;
      }
      samples.push(next);
      this.sampleCursor += 1;
      next = this.sampleRows[this.sampleCursor];
    }

    const stats: FrameStat[] = [];
    let nextStat = this.statRows[this.statCursor];
    while (nextStat && nextStat.tNs < edgeNs) {
      stats.push(nextStat);
      this.statCursor += 1;
      nextStat = this.statRows[this.statCursor];
    }

    if (samples.length || stats.length) this.listeners.samples.forEach((cb) => cb({ samples, stats }));
    if (this.sampleCursor >= this.sampleRows.length) {
      this.emitStatus();
      this.clearTimers();
    }
  }

  private emitStatus(): void {
    const newest = this.sampleRows[this.sampleCursor - 1];
    if (!newest || this.sampleCursor < 2) return;
    // fps covers the last second; droppedFrac covers the whole capture (see CaptureStatus).
    let oldestIndex = this.sampleCursor - 1;
    let earlier = this.sampleRows[oldestIndex - 1];
    while (earlier && newest.tNs - earlier.tNs <= FPS_WINDOW_NS) {
      oldestIndex -= 1;
      earlier = this.sampleRows[oldestIndex - 1];
    }
    const spanNs = newest.tNs - (this.sampleRows[oldestIndex]?.tNs ?? newest.tNs);
    const fps = spanNs > 0 ? ((this.sampleCursor - 1 - oldestIndex) * 1e9) / spanNs : 0;
    // Recordings carry no native contact hint, motion, or thermal state. Core recomputes contact from the
    // samples (DSP-4, ADR 0013), so the hint stays true and motion and thermal report rest.
    const status: CaptureStatus = {
      fingerCovered: true,
      motionRms: 0,
      thermal: 'nominal',
      fps,
      droppedFrac: this.dropped / (this.sampleCursor + this.dropped),
    };
    this.listeners.status.forEach((cb) => cb(status));
  }
}
