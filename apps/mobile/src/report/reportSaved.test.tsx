import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { printToFileAsync } from 'expo-print';
import * as Sharing from 'expo-sharing';

import { keepDemoReading, clearDemoReadings } from '@/demo/demoReadings';
import en from '@/i18n/en.json';
import { pendingProgress } from '@/measure/analysisProgress';
import { makeReading } from '@/testing/reading';
import { fixClockAtMorning } from '@/testing/fixClockAtMorning';
import { startOnboarded } from '@/testing/onboarded';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';
import * as storedReadings from '@/store/readings';
import { saveTestReading } from '@/testing/savedReading';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'light',
}));
jest.mock('expo-file-system', () => jest.requireActual('@/testing/memoryFiles').mockFileSystem);
jest.mock('expo-print', () => ({ printToFileAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));

const printToFile = jest.mocked(printToFileAsync);

preloadAppRoutes();
fixClockAtMorning();

const MORNING = new Date(2026, 9, 1, 6, 30).getTime();
const NOON = new Date(2026, 9, 1, 12, 0).getTime();
const YESTERDAY = new Date(2026, 8, 30, 12, 0).getTime();

const pageCount = (html: string) => html.match(/<section class="page">/g)?.length ?? 0;
const sharedHtml = () => (printToFile.mock.calls[0]?.[0] as { html: string }).html;

afterEach(() => jest.restoreAllMocks());

beforeEach(async () => {
  await startOnboarded();
  clearDemoReadings();
  jest.resetAllMocks();
  printToFile.mockResolvedValue({ uri: 'file:///cache/report.pdf', numberOfPages: 1 });
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(true);
  jest.mocked(Sharing.shareAsync).mockResolvedValue(undefined);
});

describe('Doctor report for a reading saved on this phone', () => {
  it('shows the report without the Demo banner or mark', async () => {
    const id = await saveTestReading(MORNING, 71);
    renderRouter('./app', { initialUrl: `/report/${id}` });
    expect(await screen.findByText(en['report.heading'])).toBeOnTheScreen();
    expect(screen.queryByText(en['report.notFoundTitle'])).toBeNull();
    expect(screen.queryByText(en['demo.banner'])).toBeNull();
    expect(screen.queryByText(en['report.demoMark'])).toBeNull();
    expect(screen.getByText('71')).toBeOnTheScreen();
  });

  it('lists the other readings of the same day and leaves other days out', async () => {
    const id = await saveTestReading(MORNING, 71);
    await saveTestReading(NOON, 83);
    await saveTestReading(YESTERDAY, 99);
    renderRouter('./app', { initialUrl: `/report/${id}` });
    expect(await screen.findByText('83')).toBeOnTheScreen();
    expect(screen.getByText('71')).toBeOnTheScreen();
    expect(screen.queryByText('99')).toBeNull();
  });

  it('shares one PDF page for the opened reading when nothing that day is flagged', async () => {
    const id = await saveTestReading(MORNING, 71);
    renderRouter('./app', { initialUrl: `/report/${id}` });
    fireEvent.press(await screen.findByRole('button', { name: en['report.sharePdf'] }));
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
    expect(pageCount(sharedHtml())).toBe(1);
    expect(sharedHtml()).not.toContain(en['report.demoMark']);
  });

  it('shares one PDF page per flagged reading of the day', async () => {
    const id = await saveTestReading(MORNING, 112, { flagged: true });
    await saveTestReading(NOON, 118, { flagged: true });
    await saveTestReading(new Date(2026, 9, 1, 18, 0).getTime(), 70);
    renderRouter('./app', { initialUrl: `/report/${id}` });
    fireEvent.press(await screen.findByRole('button', { name: en['report.sharePdf'] }));
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
    expect(pageCount(sharedHtml())).toBe(2);
    expect(sharedHtml().split(en['report.flagHrOne'])).toHaveLength(3);
  });

  it('keeps Share disabled until the saved readings have loaded, so no flagged page is missed', async () => {
    const id = await saveTestReading(MORNING, 71);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const realList = storedReadings.listReadings;
    jest.spyOn(storedReadings, 'listReadings').mockImplementationOnce(async () => {
      await gate;
      return realList();
    });
    renderRouter('./app', { initialUrl: `/report/${id}` });
    const share = await screen.findByRole('button', { name: en['report.sharePdf'] });
    expect(share).toBeDisabled();
    release();
    await waitFor(() => expect(screen.getByRole('button', { name: en['report.sharePdf'] })).toBeEnabled());
  });

  it('still says "not found" for an id that is neither saved nor a sample', async () => {
    renderRouter('./app', { initialUrl: '/report/nope' });
    expect(await screen.findByText(en['report.notFoundTitle'])).toBeOnTheScreen();
  });
});

describe('Doctor report for a Demo reading', () => {
  it('opens the in-memory reading labelled Demo and shares it as Demo', async () => {
    const { outcome } = makeReading(MORNING, 66, 50);
    const id = keepDemoReading(
      {
        readingId: 'unused',
        urgent: null,
        recordedMs: MORNING,
        context: {
          captureFps: 60,
          tier: null,
          mode: 'quick',
          restTimerDone: true,
          recordedAt: null,
          motionSpans: [],
          coldHandsSpans: [],
          sqi: null,
          validationRhythmLabel: null,
        },
        models: { rhythm: null, diabetes: null },
        reading: outcome,
        progress: pendingProgress,
      },
      'quick',
    );
    renderRouter('./app', { initialUrl: `/report/${id}` });
    expect(await screen.findByText(en['report.heading'])).toBeOnTheScreen();
    expect(screen.getByText(en['demo.banner'])).toBeOnTheScreen();
    expect(screen.getByText(en['report.demoMark'])).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: en['report.sharePdf'] }));
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
    expect(sharedHtml()).toContain(en['report.demoMark']);
  });
});
