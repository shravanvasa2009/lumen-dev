import type { CaptureStatus } from '../../modules/lumen-capture/src';
import { SLIP } from './filmVideo';
import { showcaseReplay } from './scanSource';

describe('ShowcaseReplay', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('reports the recorded finger contact in its status, uncovered until the finger lands', async () => {
    const replay = showcaseReplay('scan');
    const statuses: { atMs: number; status: CaptureStatus }[] = [];
    let atMs = 0;
    replay.addListener('status', (status) => statuses.push({ atMs, status }));
    await replay.start({ torchLevel: 1 });
    for (; atMs < 10_000; atMs += 250) jest.advanceTimersByTime(250);
    await replay.stop();

    const at = (ms: number) => statuses.find((entry) => entry.atMs >= ms)?.status;
    // The stand-in take opens on the floor and the finger lies flat from 5 s (tools/showcase/make-standins.mjs).
    expect(at(2000)).toMatchObject({ fingerCovered: false, motionRms: 0 });
    expect(at(8000)).toMatchObject({ fingerCovered: true, motionRms: 0 });
  });

  it("shows the scan take's finger slipping off the lens during the scripted slip, then back on", async () => {
    const replay = showcaseReplay('scan');
    const statuses: { atMs: number; status: CaptureStatus }[] = [];
    let atMs = 0;
    replay.addListener('status', (status) => statuses.push({ atMs, status }));
    await replay.start({ torchLevel: 1 });
    for (; atMs < (SLIP.toS + 3) * 1000; atMs += 250) jest.advanceTimersByTime(250);
    await replay.stop();

    const at = (s: number) => statuses.find((entry) => entry.atMs >= s * 1000)?.status;
    expect(at(SLIP.fromS - 2)).toMatchObject({ fingerCovered: true });
    expect(at((SLIP.fromS + SLIP.toS) / 2)).toMatchObject({ fingerCovered: false });
    expect(at(SLIP.toS + 2)).toMatchObject({ fingerCovered: true });
  });
});
