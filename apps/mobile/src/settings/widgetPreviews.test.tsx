import { render, screen } from '@testing-library/react-native';

import '@/i18n';
import en from '@/i18n/en.json';
import { lockscreenStrings } from '@/i18n/lockscreen';
import { lockTextLines } from '@/settings/lockText';
import {
  AndroidLockPreview,
  LockCirclePreview,
  LockRectanglePreview,
  MediumWidgetPreview,
  SmallWidgetPreview,
} from '@/settings/WidgetPreviews';

const mediumProps = {
  name: 'Lumen',
  reading: '72',
  unit: 'bpm',
  status: 'Up to date',
  detail: 'Last check 2 h ago',
  checkNow: 'Check now',
  fullScan: 'Full Scan',
};

// Checks and condition names, in both languages; the redesigned widgets show none of them.
const CONDITION_WORDS = ['AFib', 'FA', 'POTS', 'HRV', 'VFC', 'Diabetes', en['evidence.experimental']];

const shownText = () => screen.queryAllByText(/\S/).map((node) => String(node.props.children));

describe('home-screen widget previews (Widgets mockup)', () => {
  it('draws the medium widget with the reading, status, last check and both buttons, and no checks', () => {
    render(<MediumWidgetPreview {...mediumProps} />);
    expect(shownText()).toEqual([
      'Lumen',
      '72',
      'bpm',
      'Up to date',
      'Last check 2 h ago',
      'Check now',
      'Full Scan',
    ]);
  });

  it('leaves the number out when values are hidden', () => {
    render(<MediumWidgetPreview {...mediumProps} reading={null} />);
    expect(screen.queryByText('72')).toBeNull();
    expect(screen.queryByText('bpm')).toBeNull();
    expect(screen.getByText('Up to date')).toBeOnTheScreen();
  });

  it('draws the small widget with the status, last check and Check now only', () => {
    render(<SmallWidgetPreview status="Up to date" detail="Last check 2 h ago" action="Check now" />);
    expect(shownText()).toEqual(['Up to date', 'Last check 2 h ago', 'Check now']);
  });
});

describe('lock-screen previews (WID-2)', () => {
  it.each(['en', 'es'])('carry only lock-screen words, no value or check name (%s)', (language) => {
    const lock = lockscreenStrings(language);
    const lines = lockTextLines(lock['widget.lock.upToDate']);
    const line = lock['widget.lock.lastCheck'].replace('{{hours}}', '2');
    render(
      <>
        <LockCirclePreview />
        <LockRectanglePreview name={lines.name} status={lines.status} />
        <AndroidLockPreview name={lines.name} line={line} action={lock['widget.lock.checkNow']} />
      </>,
    );
    expect(shownText()).toEqual([lines.name, lines.status, lines.name, line, lock['widget.lock.checkNow']]);
    for (const word of CONDITION_WORDS) expect(shownText()).not.toContain(word);
    expect(screen.queryAllByText(/bpm|lpm/i)).toHaveLength(0);
  });
});
