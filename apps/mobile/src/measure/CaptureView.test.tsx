import { tierUnlocks } from '@lumen/core';
import { fireEvent, render, screen, within } from '@testing-library/react-native';

import { ScrollView } from 'react-native';

import en from '@/i18n/en.json';

import { CaptureView } from './CaptureView';
import { CheckingRow } from './CheckingRow';
import { checkingItems } from './checkingItems';
import type { LiveCapture } from './useLiveCapture';

import '@/i18n';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'dark',
}));

const base: LiveCapture = {
  phase: 'running',
  failure: null,
  status: { fingerCovered: true, motionRms: 0, thermal: 'nominal', fps: 60, droppedFrac: 0 },
  recentRed: [],
  elapsedS: 12.4,
  cleanSeconds: null,
  coachingKey: null,
  recentWaveform: { tS: [], ppg: [] },
  rejectedSpans: [],
};

const show = (
  live: Partial<LiveCapture>,
  mode: 'quick' | 'full' = 'quick',
  unlocks: ReturnType<typeof tierUnlocks> | null = null,
) => {
  const onCancel = jest.fn();
  const onStop = jest.fn();
  render(
    <CaptureView
      mode={mode}
      live={{ ...base, ...live }}
      unlocks={unlocks}
      onCancel={onCancel}
      onStop={onStop}
    />,
  );
  return { onCancel, onStop };
};

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
    show({ recentRed: [0.6, 0.62, 0.58, 0.61] });
    expect(screen.getByTestId('live-waveform', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.queryByText(en['capture.noWaveform'])).toBeNull();
  });

  it('counts clean seconds when a session supplies them', () => {
    show({ cleanSeconds: 18.7 });
    expect(screen.getByText('18')).toBeOnTheScreen();
    expect(screen.getByText('of 30 clean s')).toBeOnTheScreen();
    expect(screen.getByText(en['capture.good'])).toBeOnTheScreen();
    expect(screen.getByText(en['capture.timerNote'])).toBeOnTheScreen();
    expect(screen.getByText(en['capture.pressure'])).toBeOnTheScreen();
  });

  it('pauses with one coaching line and flags the failing check', () => {
    show({ cleanSeconds: 18, coachingKey: 'coach.lighter' });
    expect(screen.getByRole('alert')).toHaveTextContent(en['coach.lighter']);
    expect(screen.getByText('of 30 s · paused')).toBeOnTheScreen();
    expect(screen.queryByText(en['capture.good'])).toBeNull();
  });

  it('cancels from the close button and stops from Stop', () => {
    const { onCancel, onStop } = show({});
    fireEvent.press(screen.getByRole('button', { name: en['capture.cancel'] }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByRole('button', { name: en['capture.stop'] }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  describe('checking row', () => {
    const item = (name: string) => screen.getByLabelText(new RegExp(`^${name},`));
    const afibColour = () => {
      const style: unknown[] = [screen.getByText(en['checks.afib.name']).props.style].flat(Infinity);
      return Object.assign({}, ...style).color;
    };

    it('shows the Checking caption with every Full Scan check pending at 20 clean seconds', () => {
      show({ cleanSeconds: 20 }, 'full', tierUnlocks('full'));
      expect(screen.getAllByText(en['checks.checking'])[0]).toBeOnTheScreen();
      expect(item(en['checks.afib.name'])).toHaveAccessibleName(`AFib, ${en['checks.state.working']}`);
      expect(within(item(en['checks.afib.name'])).getByText(en['checks.state.working'])).toBeOnTheScreen();
      expect(screen.queryByText(en['checks.state.ready'])).toBeNull();
    });

    it('marks AFib and HRV ready at 60 clean seconds and Diabetes still checking', () => {
      show({ cleanSeconds: 60 }, 'full', tierUnlocks('full'));
      expect(item(en['checks.afib.name'])).toHaveAccessibleName(`AFib, ${en['checks.state.ready']}`);
      expect(item(en['checks.hrv.name'])).toHaveAccessibleName(`HRV, ${en['checks.state.ready']}`);
      expect(item(en['checks.diabetes.name'])).toHaveAccessibleName(
        `Diabetes, ${en['checks.state.working']}`,
      );
    });

    it('tags a pending Diabetes Experimental from the evidence reader', () => {
      show({ cleanSeconds: 20 }, 'full', tierUnlocks('full'));
      const diabetes = within(item(en['checks.diabetes.name']));
      expect(diabetes.getByText(en['evidence.experimental'])).toBeOnTheScreen();
    });

    it('marks Diabetes ready at 90 clean seconds, still tagged Experimental', () => {
      show({ cleanSeconds: 90 }, 'full', tierUnlocks('full'));
      const diabetes = within(item(en['checks.diabetes.name']));
      expect(diabetes.getByText(en['checks.state.ready'])).toBeOnTheScreen();
      expect(diabetes.getByText(en['evidence.experimental'])).toBeOnTheScreen();
    });

    it('shows Diabetes as unavailable on a phone that cannot run it', () => {
      show({ cleanSeconds: 90 }, 'full', tierUnlocks('basic'));
      expect(item(en['checks.diabetes.name'])).toHaveAccessibleName(
        `Diabetes, ${en['checks.state.unavailable']}`,
      );
      expect(item(en['checks.afib.name'])).toHaveAccessibleName(`AFib, ${en['checks.state.ready']}`);
    });

    it('shows POTS as a quiet cell that never lights and points to the Standing test', () => {
      show({ cleanSeconds: 90 }, 'full', tierUnlocks('full'));
      const pots = within(screen.getByLabelText(en['checks.pots.standingNote']));
      expect(pots.getByText(en['checks.state.off'])).toBeOnTheScreen();
      expect(pots.queryByText(en['checks.state.ready'])).toBeNull();
    });

    it('lists the Quick Check as AFib checking with HRV, Diabetes and POTS not in this scan', () => {
      show({ cleanSeconds: 45 }, 'quick', tierUnlocks('full'));
      expect(item(en['checks.afib.name'])).toHaveAccessibleName(`AFib, ${en['checks.state.working']}`);
      expect(screen.queryByText(en['checks.state.ready'])).toBeNull();
      for (const name of ['HRV', 'Diabetes']) {
        expect(item(name)).toHaveAccessibleName(`${name}, ${en['checks.state.off']}`);
      }
      expect(screen.getAllByText(en['checks.state.off'])).toHaveLength(3);
    });

    it('greys a ready check while the coaching message is showing', () => {
      show({ cleanSeconds: 60 }, 'full', tierUnlocks('full'));
      const lit = afibColour();
      screen.unmount();
      show({ cleanSeconds: 60, coachingKey: 'coach.lighter' }, 'full', tierUnlocks('full'));
      expect(screen.getByRole('alert')).toHaveTextContent(en['coach.lighter']);
      expect(afibColour()).not.toBe(lit);
    });

    it('changes only colour and icon between states, with no transform, opacity or transition', () => {
      const pending = render(<CheckingRow items={checkingItems('full', 10, null)} />);
      const pendingTree = JSON.stringify(pending.toJSON());
      pending.unmount();
      const ready = render(<CheckingRow items={checkingItems('full', 90, null)} />);
      const readyTree = JSON.stringify(ready.toJSON());
      expect(readyTree).not.toBe(pendingTree);
      for (const tree of [pendingTree, readyTree]) {
        expect(tree).not.toMatch(/"(transform|opacity|transition\w*)"/);
      }
    });

    it('keeps Stop in the screen footer, outside the scrolling content', () => {
      show({ cleanSeconds: 10 }, 'full', tierUnlocks('full'));
      const scroll = screen.UNSAFE_getByType(ScrollView);
      expect(within(scroll).queryByRole('button', { name: en['capture.stop'] })).toBeNull();
      expect(screen.getByRole('button', { name: en['capture.stop'] })).toBeOnTheScreen();
    });
  });
});
