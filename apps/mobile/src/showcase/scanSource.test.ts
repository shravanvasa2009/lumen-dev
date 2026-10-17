import type { CaptureStatus } from '../../modules/lumen-capture/src';
import { recordingFor, showcaseReplay } from './scanSource';

describe('ShowcaseReplay', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('reports the scripted motion and the recorded finger contact in its status', async () => {
    const recording = recordingFor(1);
    const replay = showcaseReplay(recording);
    const statuses: { atMs: number; status: CaptureStatus }[] = [];
    let atMs = 0;
    replay.addListener('status', (status) => statuses.push({ atMs, status }));
    await replay.start({ torchLevel: 1 });
    for (; atMs < 10_000; atMs += 250) jest.advanceTimersByTime(250);
    await replay.stop();

    const at = (ms: number) => statuses.find((entry) => entry.atMs >= ms)?.status;
    const [firstMotion] = recording.motion;
    expect(firstMotion).toBeDefined();
    expect(at(firstMotion!.fromS * 1000 + 500)?.motionRms).toBeGreaterThan(0.05);
    expect(at(firstMotion!.fromS * 1000 + 500)?.fingerCovered).toBe(true);
    // Between the first lift (2.5 s) and the finger coming back (6 s) the lens is uncovered.
    expect(at(4000)).toMatchObject({ fingerCovered: false, motionRms: 0 });
  });
});
