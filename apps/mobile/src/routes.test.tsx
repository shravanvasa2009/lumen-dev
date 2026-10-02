import { fireEvent, getMockContext, renderRouter, screen } from 'expo-router/testing-library';
import { StyleSheet } from 'react-native';

import en from '@/i18n/en.json';
import tokens from '@/theme/tokens.json';

// Turn on reminders asks the system for notification permission before it leaves the screen.
jest.mock('expo-notifications', () => ({
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
}));

let mockScheme: 'light' | 'dark';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme,
}));

type Route = { file: string; url: string; title: keyof typeof en };

// One row per screen of spec §12.2. Capture appears twice because mode=full and mode=quick are two screens.
const routes: readonly Route[] = [
  { file: '(onboarding)/welcome', url: '/welcome', title: 'app.name' },
  { file: '(onboarding)/consent', url: '/consent', title: 'consent.title' },
  { file: '(onboarding)/profile', url: '/profile', title: 'profile.title' },
  { file: '(onboarding)/phone-check', url: '/phone-check', title: 'phoneCheck.title' },
  { file: '(onboarding)/placement', url: '/placement', title: 'placement.title' },
  { file: '(onboarding)/practice', url: '/practice', title: 'practice.title' },
  { file: '(onboarding)/how-to-sit', url: '/how-to-sit', title: 'howToSit.title' },
  { file: '(onboarding)/rating', url: '/rating', title: 'rating.title' },
  { file: '(onboarding)/reminders', url: '/reminders', title: 'reminders.title' },
  { file: '(tabs)/index', url: '/', title: 'tabs.home' },
  { file: '(tabs)/trends', url: '/trends', title: 'trends.title' },
  { file: '(tabs)/learn', url: '/learn', title: 'learn.title' },
  { file: '(tabs)/settings', url: '/settings', title: 'settings.title' },
  { file: 'measure/mode', url: '/measure/mode', title: 'mode.title' },
  { file: 'measure/precheck', url: '/measure/precheck?mode=full', title: 'precheck.title' },
  { file: 'measure/capture', url: '/measure/capture?mode=full', title: 'mode.full' },
  { file: 'measure/capture', url: '/measure/capture?mode=quick', title: 'mode.quick' },
  { file: 'measure/processing', url: '/measure/processing', title: 'processing.title' },
  { file: 'results/[id]/index', url: '/results/demo', title: 'results.title' },
  { file: 'results/[id]/why', url: '/results/demo/why', title: 'why.titleRegular' },
  { file: 'measure/inconclusive', url: '/measure/inconclusive', title: 'result.inconclusive' },
  { file: 'emergency', url: '/emergency', title: 'emergency.title' },
  { file: 'measure/standing-test', url: '/measure/standing-test', title: 'standing.title' },
  { file: 'report/[id]', url: '/report/demo', title: 'report.title' },
  { file: 'learn/[slug]', url: '/learn/what-is-afib', title: 'learn.lessonAfib' },
  { file: 'settings/phone', url: '/settings/phone', title: 'phoneRating.title' },
  { file: 'settings/lab', url: '/settings/lab', title: 'lab.title' },
  { file: 'measure/fix-technique', url: '/measure/fix-technique', title: 'fix.title' },
  { file: 'settings/accuracy', url: '/settings/accuracy', title: 'accuracy.title' },
  { file: 'settings/appearance', url: '/settings/appearance', title: 'appearance.title' },
  { file: 'settings/notifications', url: '/settings/notifications', title: 'notifications.title' },
  { file: 'settings/widgets/index', url: '/settings/widgets', title: 'widgets.title' },
  { file: 'settings/widgets/lock-screen', url: '/settings/widgets/lock-screen', title: 'lockScreen.title' },
  { file: 'follow-up', url: '/follow-up', title: 'followUp.title' },
];

// Resolved against the working directory, which is apps/mobile when the mobile workspace runs jest.
const appDirectory = './app';

function routeFilesUnder(directory: string): string[] {
  return getMockContext(directory)
    .keys()
    .map((key) => key.replace(/^\.\//, '').replace(/\.tsx$/, ''))
    .filter((file) => !file.endsWith('_layout'));
}

describe('route list', () => {
  it('covers every route file under app/ and nothing else', () => {
    expect([...new Set(routes.map((route) => route.file))].sort()).toEqual(
      routeFilesUnder(appDirectory).sort(),
    );
  });

  it('lists the 34 screens of the inventory', () => {
    expect(routes).toHaveLength(34);
  });
});

describe.each([
  ['dark', tokens.dark],
  ['light', tokens.light],
] as const)('routes in the %s theme', (scheme, colors) => {
  beforeEach(() => {
    mockScheme = scheme;
  });

  it.each(routes)('renders $url with its translated title', ({ url, title }) => {
    renderRouter(appDirectory, { initialUrl: url });
    const heading = screen.getByRole('header', { name: en[title] });
    const isEmergency = url === '/emergency';
    expect(StyleSheet.flatten(heading.props.style)).toMatchObject({
      color: isEmergency ? colors.criticalText : colors.text,
    });

    // Red is reserved for the emergency screen (SAFE-1); the serialized tree holds every style colour.
    const drawn = JSON.stringify(screen.toJSON());
    expect(drawn.includes(colors.criticalFill)).toBe(isEmergency);
    expect(drawn.includes(colors.criticalText)).toBe(isEmergency);
  });
});

describe('tab bar', () => {
  it('draws an icon on each of the four tabs', () => {
    mockScheme = 'dark';
    renderRouter(appDirectory, { initialUrl: '/' });
    for (const label of ['tabs.home', 'tabs.trends', 'tabs.learn', 'tabs.settings'] as const) {
      const tab = screen.getByLabelText(new RegExp(`^${en[label]}, tab`));
      expect(tab.findAll((node) => String(node.type) === 'RNSVGSvgView')).not.toHaveLength(0);
    }
  });
});

describe('navigation', () => {
  beforeEach(() => {
    mockScheme = 'dark';
  });

  type Step = readonly [keyof typeof en, keyof typeof en];

  function pressThrough(steps: readonly Step[]) {
    for (const [button, nextTitle] of steps) {
      fireEvent.press(screen.getByRole('button', { name: en[button] }));
      expect(screen.getByRole('header', { name: en[nextTitle] })).toBeOnTheScreen();
    }
  }

  function followButtons(startUrl: string, steps: readonly Step[]) {
    renderRouter(appDirectory, { initialUrl: startUrl });
    pressThrough(steps);
  }

  it('walks the onboarding chain from welcome to Home', async () => {
    followButtons('/welcome', [['welcome.getStarted', 'consent.title']]);
    fireEvent.press(screen.getByRole('checkbox', { name: en['consent.understand'] }));
    pressThrough([['common.continue', 'profile.title']]);
    fireEvent.changeText(screen.getByLabelText(en['profile.age']), '42');
    pressThrough([
      ['common.continue', 'phoneCheck.title'],
      ['phoneCheck.next', 'placement.title'],
      ['placement.start', 'practice.title'],
      ['common.continue', 'howToSit.title'],
      ['common.continue', 'rating.title'],
      ['common.continue', 'reminders.title'],
    ]);
    fireEvent.press(screen.getByRole('button', { name: en['reminders.turnOn'] }));
    expect(await screen.findByRole('header', { name: en['tabs.home'] })).toBeOnTheScreen();
  });

  it('walks Home through a measurement to results', () => {
    followButtons('/', [['home.measure', 'mode.title']]);
    fireEvent.press(screen.getByText(en['mode.quick']));
    expect(screen.getByRole('header', { name: en['precheck.title'] })).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: en['precheck.start'] }));
    expect(screen.getByRole('header', { name: en['mode.quick'] })).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: en['capture.finish'] }));
    fireEvent.press(screen.getByRole('button', { name: en['processing.seeResults'] }));
    expect(screen.getByRole('header', { name: en['results.title'] })).toBeOnTheScreen();
  });

  it('opens the emergency screen from the safety sheet of a flagged result', () => {
    followButtons('/results/demo-flag', [['safety.yes', 'emergency.title']]);
  });

  it('opens the report from results', () => {
    followButtons('/results/demo', [['results.share', 'report.title']]);
  });

  it('opens the explanation from results', () => {
    followButtons('/results/demo', [['results.showWhy', 'why.titleRegular']]);
  });

  it('loops from a failed capture through Fix my technique back to capture', () => {
    followButtons('/measure/capture?mode=quick', [
      ['capture.noSignal', 'result.inconclusive'],
      ['inconclusive.fix', 'fix.title'],
      ['fix.done', 'mode.quick'],
    ]);
  });
});
