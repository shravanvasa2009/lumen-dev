import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import i18next from 'i18next';
import * as Linking from 'expo-linking';

import { ScrollView, View } from 'react-native';

import type { PlanPhone } from '@/checks/checkPlan';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';

import { CaptureView } from './CaptureView';
import { CheckingRow } from './CheckingRow';
import { checkingItems } from './checkingItems';
import type { LiveCapture } from './useLiveCapture';

import '@/i18n';

const mockNative: { view: unknown } = { view: null };
jest.mock('../../modules/lumen-capture/src/LumenPreviewView', () => ({
  get LumenPreviewView() {
    return mockNative.view;
  },
}));

const mockWindow = { width: 412 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: mockWindow.width, height: 800, scale: 2.6, fontScale: 1 }),
}));

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'dark',
}));

const base: LiveCapture = {
  phase: 'running',
  failure: null,
  status: { fingerCovered: true, motionRms: 0, thermal: 'nominal', fps: 60, droppedFrac: 0 },
  recentRed: [],
  recentPulse: [],
  elapsedS: 12.4,
  cleanSeconds: null,
  coachingKey: null,
  recentWaveform: { tS: [], ppg: [] },
  rejectedSpans: [],
  signalLevel: null,
  nativeCamera: false,
  advancing: false,
};

const FULL_PHONE: PlanPhone = { tier: 'full', ambient: false, fps60: true };
const BASIC_PHONE: PlanPhone = { tier: 'basic', ambient: false, fps60: false };

const show = (
  live: Partial<LiveCapture>,
  mode: 'quick' | 'full' = 'quick',
  phone: PlanPhone = FULL_PHONE,
) => {
  const onCancel = jest.fn();
  const onStop = jest.fn();
  render(
    <CaptureView mode={mode} live={{ ...base, ...live }} phone={phone} onCancel={onCancel} onStop={onStop} />,
  );
  return { onCancel, onStop };
};

const indexOfText = (text: string) => JSON.stringify(screen.toJSON()).indexOf(text);

describe('CaptureView', () => {
  it('says the camera is not connected when the module is unavailable', () => {
    show({ phase: 'unavailable', status: null });
    expect(screen.getByRole('header', { name: en['mode.quick'] })).toBeOnTheScreen();
    expect(screen.getByText(en['capture.unavailable'])).toBeOnTheScreen();
    expect(screen.getByText(en['capture.noWaveform'])).toBeOnTheScreen();
    expect(screen.queryByText(en['capture.fingerDetected'])).toBeNull();
    expect(screen.getByText('—')).toBeOnTheScreen();
  });

  it('explains a denied camera permission and a failed start', () => {
    show({ phase: 'denied', status: null });
    expect(screen.getByText(en['capture.denied'])).toBeOnTheScreen();
  });

  it('offers Open Settings when the camera is denied, and only then', () => {
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    show({ phase: 'denied', status: null });
    fireEvent.press(screen.getByRole('button', { name: en['capture.openSettings'] }));
    expect(openSettings).toHaveBeenCalledTimes(1);
    openSettings.mockRestore();
  });

  it('puts the denied line and Open Settings above the finger preview and the waveform card, in English and Spanish', async () => {
    show({ phase: 'denied', status: null });
    const tree = JSON.stringify(screen.toJSON());
    expect(tree.indexOf(en['capture.openSettings'])).toBeGreaterThan(-1);
    expect(tree.indexOf(en['capture.openSettings'])).toBeLessThan(tree.indexOf(en['capture.noWaveform']));
    expect(screen.getAllByText(en['capture.denied'])).toHaveLength(1);
    screen.unmount();
    await act(() => i18next.changeLanguage('es'));
    try {
      show({ phase: 'denied', status: null });
      expect(screen.getByText(es['capture.denied'])).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: es['capture.openSettings'] })).toBeOnTheScreen();
    } finally {
      await act(() => i18next.changeLanguage('en'));
    }
  });

  it('has no Open Settings button while the camera runs', () => {
    show({});
    expect(screen.queryByRole('button', { name: en['capture.openSettings'] })).toBeNull();
  });

  it('shows the start failure reason', () => {
    show({ phase: 'failed', status: null, failure: 'camera busy' });
    expect(screen.getByText("The camera didn't start: camera busy")).toBeOnTheScreen();
  });

  it('waits for a clean signal while there is no LiveSession count', () => {
    show({ elapsedS: 12.9 }, 'full');
    expect(screen.getByRole('header', { name: en['mode.full'] })).toBeOnTheScreen();
    expect(screen.getByText(en['capture.fingerDetected'])).toBeOnTheScreen();
    expect(
      screen.getByText('The camera has been on for 12 s. Waiting for a clean signal.'),
    ).toBeOnTheScreen();
    expect(screen.getByText('—')).toBeOnTheScreen();
    expect(screen.getByText('of 90 clean s')).toBeOnTheScreen();
    expect(screen.queryByText(en['capture.timerNote'])).toBeNull();
    expect(screen.queryByText(en['capture.still'])).toBeNull();
  });

  it('asks for the finger to cover the flash when none is detected', () => {
    show({ status: { ...base.status!, fingerCovered: false } });
    expect(screen.getByText(en['capture.fingerMissing'])).toBeOnTheScreen();
    expect(screen.getByText(en['placement.flashOutsideBump'])).toBeOnTheScreen();
  });

  it('draws the pulse from the module samples', () => {
    show({ recentRed: [0.6, 0.62, 0.58, 0.61], recentPulse: [0.1, 0.4, -0.1, 0.2] });
    expect(screen.getByTestId('live-waveform', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.getByTestId('live-waveform-raw', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.queryByText(en['capture.noWaveform'])).toBeNull();
  });

  it('counts clean seconds when a session supplies them', () => {
    show({ cleanSeconds: 18.7, advancing: true });
    expect(screen.getByText('18')).toBeOnTheScreen();
    expect(screen.getByText('of 30 clean s')).toBeOnTheScreen();
    expect(screen.queryByText(/Great signal/)).toBeNull();
    expect(screen.getByText(en['capture.timerNote'])).toBeOnTheScreen();
    expect(screen.getByText(en['capture.pressure'])).toBeOnTheScreen();
  });

  it('pauses with one coaching line and flags the failing check', () => {
    show({ cleanSeconds: 18, coachingKey: 'coach.lighter' });
    expect(screen.getByRole('alert')).toHaveTextContent(en['coach.lighter']);
    expect(screen.getByText('of 30 s · paused')).toBeOnTheScreen();
  });

  it('cancels from the close button and stops from Stop', () => {
    const { onCancel, onStop } = show({});
    fireEvent.press(screen.getByRole('button', { name: en['capture.cancel'] }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByRole('button', { name: en['capture.stop'] }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('labels the filtered pulse above the raw camera signal, in English and Spanish', async () => {
    show({});
    expect(screen.getByText(en['capture.wavePulse'])).toBeOnTheScreen();
    expect(screen.getByText(en['capture.waveRaw'])).toBeOnTheScreen();
    expect(JSON.stringify(screen.toJSON()).indexOf(en['capture.wavePulse'])).toBeLessThan(
      JSON.stringify(screen.toJSON()).indexOf(en['capture.waveRaw']),
    );
    screen.unmount();
    await act(() => i18next.changeLanguage('es'));
    try {
      show({});
      expect(screen.getByText(es['capture.wavePulse'])).toBeOnTheScreen();
      expect(screen.getByText(es['capture.waveRaw'])).toBeOnTheScreen();
    } finally {
      await act(() => i18next.changeLanguage('en'));
    }
  });

  it('adds the dicrotic fun fact under the raw trace, except on a short screen', () => {
    show({});
    expect(screen.getByText(en['capture.waveFact'])).toBeOnTheScreen();
    expect(JSON.stringify(screen.toJSON()).indexOf(en['capture.waveRaw'])).toBeLessThan(
      JSON.stringify(screen.toJSON()).indexOf(en['capture.waveFact']),
    );
    fireEvent(screen.UNSAFE_getByType(ScrollView), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 508 } },
    });
    expect(screen.queryByText(en['capture.waveFact'])).toBeNull();
  });

  it('draws a flat line for both traces before there is data', () => {
    show({});
    expect(screen.queryByTestId('live-waveform', { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByTestId('live-waveform-raw', { includeHiddenElements: true })).toBeNull();
  });

  describe('live view', () => {
    afterEach(() => {
      mockNative.view = null;
    });

    it('shows the live view and its caption for the device camera, and the glow otherwise', () => {
      mockNative.view = View;
      show({ nativeCamera: true });
      expect(screen.getByText(en['capture.liveView'])).toBeOnTheScreen();
      screen.unmount();
      show({ nativeCamera: false });
      expect(screen.queryByText(en['capture.liveView'])).toBeNull();
    });

    it('keeps the timer ring below the live view, not over it', () => {
      mockNative.view = View;
      show({ nativeCamera: true, cleanSeconds: 40 }, 'full');
      expect(indexOfText(en['capture.liveView'])).toBeLessThan(indexOfText('of 90 clean s'));
      expect(JSON.stringify(screen.toJSON())).not.toMatch(/"marginTop":-/);
    });
  });

  describe('layout (mockup 13)', () => {
    const indexOf = (text: string) => JSON.stringify(screen.toJSON()).indexOf(text);

    it('puts the Quality chip in the header row, after the close button and the title', () => {
      show({ signalLevel: 0.9, advancing: true }, 'full');
      expect(
        screen.getByLabelText(`${en['capture.quality']} ${en['capture.qualityGood']}`),
      ).toBeOnTheScreen();
      expect(indexOf(en['capture.cancel'])).toBeLessThan(indexOf(en['mode.full']));
      expect(indexOf(en['mode.full'])).toBeLessThan(indexOf(en['capture.quality']));
      expect(indexOf(en['capture.quality'])).toBeLessThan(indexOf(en['capture.fingerDetected']));
    });

    it('names weaker levels Weak and OK, and shows Weak while a running capture has no level yet', () => {
      show({ signalLevel: 0.1 });
      expect(screen.getByLabelText(`${en['capture.quality']} ${en['signal.weak']}`)).toBeOnTheScreen();
      screen.unmount();
      show({ signalLevel: 0.5 });
      expect(screen.getByLabelText(`${en['capture.quality']} ${en['signal.ok']}`)).toBeOnTheScreen();
      screen.unmount();
      show({ signalLevel: null });
      expect(screen.getByLabelText(`${en['capture.quality']} ${en['signal.weak']}`)).toBeOnTheScreen();
      screen.unmount();
      show({ phase: 'starting', status: null });
      expect(screen.queryByText(en['capture.quality'])).toBeNull();
    });

    it('never says Good while the clean seconds are not counting, and names the open cause instead', () => {
      show({
        cleanSeconds: 0,
        signalLevel: 0.9,
        advancing: false,
        elapsedS: 30,
        rejectedSpans: [{ startS: 20, endS: 30, reason: 'clipping' }],
      });
      expect(screen.getByLabelText(`${en['capture.quality']} ${en['signal.ok']}`)).toBeOnTheScreen();
      expect(screen.queryByText(en['capture.qualityGood'])).toBeNull();
      expect(screen.getByRole('alert')).toHaveTextContent(en['coach.lighter']);
    });

    it('says the signal state once: the header chip, with no second line under the ring', () => {
      show({ cleanSeconds: 40, signalLevel: 0.9, advancing: true });
      expect(screen.getByText(en['capture.qualityGood'])).toBeOnTheScreen();
      expect(screen.queryByText(/great signal|good signal/i)).toBeNull();
    });

    it('orders the pill, ring, message, waveform, labels and the Checking panel as in the mockup', () => {
      show({ cleanSeconds: 40, signalLevel: 0.9, advancing: true }, 'full');
      const order = [
        en['capture.fingerDetected'],
        'of 90 clean s',
        en['capture.wavePulse'],
        en['capture.still'],
        en['checks.checking'],
      ].map(indexOf);
      expect(order).toEqual([...order].sort((a, b) => a - b));
      expect(order.every((position) => position > -1)).toBe(true);
    });

    it('keeps the whole Checking panel inside the scrolling body on a 360 x 640 screen', () => {
      show({ cleanSeconds: 40 }, 'full');
      fireEvent(screen.UNSAFE_getByType(ScrollView), 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 508 } },
      });
      const scroll = within(screen.UNSAFE_getByType(ScrollView));
      expect(scroll.getAllByText(en['checks.checking'])[0]).toBeOnTheScreen();
      expect(scroll.getByLabelText(en['checks.pots.standingNote'])).toBeOnTheScreen();
      expect(screen.queryByText(en['capture.timerNote'])).toBeNull();
      expect(screen.queryByText(en['capture.still'])).toBeNull();
      expect(screen.getByText('of 90 clean s')).toBeOnTheScreen();
    });

    it('drops the word Quality from the chip on a 360 dp phone, in Spanish too, so the title keeps room', async () => {
      mockWindow.width = 360;
      await act(() => i18next.changeLanguage('es'));
      try {
        show({ signalLevel: 0.9, advancing: true }, 'full');
        expect(screen.getByRole('header', { name: es['mode.full'] })).toBeOnTheScreen();
        expect(
          screen.getByLabelText(`${es['capture.quality']} ${es['capture.qualityGood']}`),
        ).toBeOnTheScreen();
        expect(screen.getByText(es['capture.qualityGood'])).toBeOnTheScreen();
        expect(screen.queryByText(es['capture.quality'])).toBeNull();
      } finally {
        mockWindow.width = 412;
        await act(() => i18next.changeLanguage('en'));
      }
    });

    it('shows the chip in Spanish', async () => {
      await act(() => i18next.changeLanguage('es'));
      try {
        show({ signalLevel: 0.9, advancing: true });
        expect(
          screen.getByLabelText(`${es['capture.quality']} ${es['capture.qualityGood']}`),
        ).toBeOnTheScreen();
      } finally {
        await act(() => i18next.changeLanguage('en'));
      }
    });
  });

  describe('checking row', () => {
    const item = (name: string) => screen.getByLabelText(new RegExp(`^${name},`));
    const afibColour = () => {
      const style: unknown[] = [screen.getByText(en['checks.afib.name']).props.style].flat(Infinity);
      return Object.assign({}, ...style).color;
    };

    it('shows the Checking caption with every Full Scan check pending at 20 clean seconds', () => {
      show({ cleanSeconds: 20 }, 'full');
      expect(screen.getAllByText(en['checks.checking'])[0]).toBeOnTheScreen();
      expect(item(en['checks.afib.name'])).toHaveAccessibleName(`AFib, ${en['checks.state.working']}`);
      expect(within(item(en['checks.afib.name'])).getByText(en['checks.state.working'])).toBeOnTheScreen();
      expect(screen.queryByText(en['checks.state.ready'])).toBeNull();
    });

    it('marks AFib and HRV ready at 60 clean seconds and Diabetes still checking', () => {
      show({ cleanSeconds: 60 }, 'full');
      expect(item(en['checks.afib.name'])).toHaveAccessibleName(`AFib, ${en['checks.state.ready']}`);
      expect(item(en['checks.hrv.name'])).toHaveAccessibleName(`HRV, ${en['checks.state.ready']}`);
      expect(item(en['checks.diabetes.name'])).toHaveAccessibleName(
        `Diabetes, ${en['checks.state.working']}`,
      );
    });

    it('tags a pending Diabetes Experimental from the evidence reader', () => {
      show({ cleanSeconds: 20 }, 'full');
      const diabetes = within(item(en['checks.diabetes.name']));
      expect(diabetes.getByText(en['evidence.experimental'])).toBeOnTheScreen();
    });

    it('marks Diabetes ready at 90 clean seconds, still tagged Experimental', () => {
      show({ cleanSeconds: 90 }, 'full');
      const diabetes = within(item(en['checks.diabetes.name']));
      expect(diabetes.getByText(en['checks.state.ready'])).toBeOnTheScreen();
      expect(diabetes.getByText(en['evidence.experimental'])).toBeOnTheScreen();
    });

    it('shows Diabetes as unavailable on a phone that cannot run it', () => {
      show({ cleanSeconds: 90 }, 'full', BASIC_PHONE);
      expect(item(en['checks.diabetes.name'])).toHaveAccessibleName(
        `Diabetes, ${en['checks.state.unavailable']}`,
      );
      expect(item(en['checks.afib.name'])).toHaveAccessibleName(`AFib, ${en['checks.state.ready']}`);
    });

    it('shows POTS as a quiet cell that never lights and points to the Standing test', () => {
      show({ cleanSeconds: 90 }, 'full');
      const pots = within(screen.getByLabelText(en['checks.pots.standingNote']));
      expect(pots.getByText(en['checks.state.off'])).toBeOnTheScreen();
      expect(pots.queryByText(en['checks.state.ready'])).toBeNull();
    });

    it('shows one line in the Quick Check instead of four Not in this scan rows', () => {
      show({ cleanSeconds: 45 }, 'quick', FULL_PHONE);
      expect(screen.getByText(en['checks.quickHeartRateOnly'])).toBeOnTheScreen();
      expect(screen.getAllByText(en['checks.checking'])[0]).toBeOnTheScreen();
      expect(screen.queryByText(en['checks.state.off'])).toBeNull();
      expect(screen.queryByText(en['checks.state.ready'])).toBeNull();
      expect(screen.queryByLabelText(/^(AFib|HRV|Diabetes),/)).toBeNull();
    });

    it('keeps the normal rows in a Full Scan where every check is off', () => {
      const allOff = (['afib', 'hrv', 'diabetes', 'pots'] as const).map((id) => ({
        id,
        state: 'off' as const,
      }));
      render(<CheckingRow mode="full" items={allOff} />);
      expect(screen.queryByText(en['checks.quickHeartRateOnly'])).toBeNull();
      expect(screen.getAllByText(en['checks.state.off'])).toHaveLength(4);
    });

    it('greys a ready check while the coaching message is showing', () => {
      show({ cleanSeconds: 60 }, 'full');
      const lit = afibColour();
      screen.unmount();
      show({ cleanSeconds: 60, coachingKey: 'coach.lighter' }, 'full');
      expect(screen.getByRole('alert')).toHaveTextContent(en['coach.lighter']);
      expect(afibColour()).not.toBe(lit);
    });

    it('changes only colour and icon between states, with no transform, opacity or transition', () => {
      const pending = render(<CheckingRow mode="full" items={checkingItems('full', 10, FULL_PHONE)} />);
      const pendingTree = JSON.stringify(pending.toJSON());
      pending.unmount();
      const ready = render(<CheckingRow mode="full" items={checkingItems('full', 90, FULL_PHONE)} />);
      const readyTree = JSON.stringify(ready.toJSON());
      expect(readyTree).not.toBe(pendingTree);
      for (const tree of [pendingTree, readyTree]) {
        expect(tree).not.toMatch(/"(transform|opacity|transition\w*)"/);
      }
    });

    it('keeps Stop in the screen footer, outside the scrolling content', () => {
      show({ cleanSeconds: 10 }, 'full');
      const scroll = screen.UNSAFE_getByType(ScrollView);
      expect(within(scroll).queryByRole('button', { name: en['capture.stop'] })).toBeNull();
      expect(screen.getByRole('button', { name: en['capture.stop'] })).toBeOnTheScreen();
    });
  });
});
