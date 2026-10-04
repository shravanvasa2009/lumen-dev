import { render, screen } from '@testing-library/react-native';

import '@/i18n';
import * as evidence from '@/evidence';
import en from '@/i18n/en.json';
import { lockscreenStrings } from '@/i18n/lockscreen';
import { lockTextLines } from '@/settings/lockText';
import {
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
  checkNow: 'Check now',
  fullScan: 'Full scan',
};
const names = [
  en['widgets.checkAfib'],
  en['widgets.checkPots'],
  en['widgets.checkHrv'],
  en['widgets.checkDiabetes'],
];

afterEach(() => jest.restoreAllMocks());

function mockDiabetesLabel(label: 'experimental' | 'checked') {
  const real = evidence.evidenceFor('diabetes');
  jest.spyOn(evidence, 'evidenceFor').mockReturnValue({ ...real, label });
}

describe('medium widget preview checks row', () => {
  it('names the four checks in order', () => {
    render(<MediumWidgetPreview {...mediumProps} />);
    const shown = screen
      .getAllByText(new RegExp(`^(${names.join('|')})$`))
      .map((node) => node.props.children);
    expect(shown).toEqual(names);
  });

  it('tags Diabetes only while its evidence label is Experimental', () => {
    mockDiabetesLabel('experimental');
    const { unmount } = render(<MediumWidgetPreview {...mediumProps} />);
    expect(screen.getByText(en['evidence.experimental'])).toBeOnTheScreen();
    unmount();
    mockDiabetesLabel('checked');
    render(<MediumWidgetPreview {...mediumProps} />);
    expect(screen.queryByText(en['evidence.experimental'])).toBeNull();
  });
});

describe('small widget preview checks', () => {
  it('shows four icons and no check names', () => {
    const { toJSON } = render(<SmallWidgetPreview status="Up to date" detail="Today" action="Check now" />);
    const tree = JSON.stringify(toJSON());
    expect(tree.match(/"height":11/g)?.length).toBe(8); // each Svg renders a host wrapper and its native node
    for (const stroke of ['M2 12h5l2-5', 'M12 4.5a1.5', 'M5 20V10', 'M12 3.5C12'])
      expect(tree).toContain(stroke);
    for (const name of names) expect(screen.queryByText(name)).toBeNull();
  });
});

describe('lock-screen previews', () => {
  it.each(['en', 'es'])('carry no check names (%s)', (language) => {
    const lines = lockTextLines(lockscreenStrings(language)['widget.lock.checkAgain']);
    render(
      <>
        <LockCirclePreview />
        <LockRectanglePreview name={lines.name} status={lines.status} />
      </>,
    );
    const lockText = screen.queryAllByText(/\S/).map((node) => String(node.props.children));
    for (const word of ['AFib', 'FA', 'POTS', 'HRV', 'VFC', 'Diabetes', en['evidence.experimental']]) {
      expect(lockText).not.toContain(word);
    }
  });
});
