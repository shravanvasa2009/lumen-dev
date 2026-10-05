import { act, fireEvent, getMockContext, renderRouter, screen, within } from 'expo-router/testing-library';
import i18next from 'i18next';
import { router } from 'expo-router';
import { Dimensions, StyleSheet } from 'react-native';

import { enterDemo, exitDemo } from '@/demo/demoSession';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import { fixClockAtMorning } from '@/testing/fixClockAtMorning';
import { expectNavTitle, focusedNavHeader } from '@/testing/navHeader';
import { startOnboarded } from '@/testing/onboarded';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';
import tokens from '@/theme/tokens.json';

// Turn on reminders asks the system for notification permission before it leaves the screen; the
// notification settings screen reads it when it opens.
jest.mock('expo-notifications', () => ({
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  getPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted', granted: true })),
  useLastNotificationResponse: () => null,
  setNotificationHandler: jest.fn(),
}));

jest.mock('@/notifications/scheduler', () => ({ syncNotifications: jest.fn(async () => undefined) }));

fixClockAtMorning();

let mockScheme: 'light' | 'dark';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme,
}));

// 'nav' titles sit in the centred native nav bar; 'body' titles are drawn in the screen (tab roots, the
// onboarding steps, hero screens, and the screens still to be moved by their owner).
type TitlePlace = 'nav' | 'body';

type Route = { file: string; url: string; title: keyof typeof en; place: TitlePlace };

// One row per screen of spec §12.2. Capture appears twice because mode=full and mode=quick are two screens.
const routes: readonly Route[] = [
  { file: '(onboarding)/welcome', url: '/welcome', title: 'app.name', place: 'body' },
  { file: '(onboarding)/consent', url: '/consent', title: 'consent.title', place: 'body' },
  { file: '(onboarding)/profile', url: '/profile', title: 'profile.title', place: 'body' },
  { file: '(onboarding)/diabetes-risk', url: '/diabetes-risk', title: 'dr.title', place: 'body' },
  { file: '(onboarding)/phone-check', url: '/phone-check', title: 'phoneCheck.title', place: 'body' },
  { file: '(onboarding)/placement', url: '/placement', title: 'placement.title', place: 'body' },
  { file: '(onboarding)/practice', url: '/practice', title: 'practice.title', place: 'body' },
  { file: '(onboarding)/how-to-sit', url: '/how-to-sit', title: 'howToSit.title', place: 'body' },
  { file: '(onboarding)/rating', url: '/rating', title: 'rating.title', place: 'body' },
  { file: '(onboarding)/reminders', url: '/reminders', title: 'reminders.title', place: 'body' },
  { file: '(tabs)/index', url: '/', title: 'home.greetingMorning', place: 'body' },
  { file: '(tabs)/trends', url: '/trends', title: 'trends.title', place: 'body' },
  { file: '(tabs)/care', url: '/care', title: 'careMap.title', place: 'body' },
  { file: '(tabs)/learn', url: '/learn', title: 'learn.title', place: 'body' },
  { file: '(tabs)/settings', url: '/settings', title: 'settings.title', place: 'body' },
  { file: 'measure/mode', url: '/measure/mode', title: 'mode.title', place: 'nav' },
  { file: 'measure/precheck', url: '/measure/precheck?mode=full', title: 'precheck.title', place: 'nav' },
  { file: 'measure/capture', url: '/measure/capture?mode=full', title: 'mode.full', place: 'body' },
  { file: 'measure/capture', url: '/measure/capture?mode=quick', title: 'mode.quick', place: 'body' },
  { file: 'measure/processing', url: '/measure/processing', title: 'processing.title', place: 'body' },
  { file: 'results/[id]/index', url: '/results/demo', title: 'results.title', place: 'nav' },
  { file: 'results/[id]/diabetes', url: '/results/demo/diabetes', title: 'dr.rowTitle', place: 'nav' },
  { file: 'results/[id]/why', url: '/results/demo/why', title: 'why.titleRegular', place: 'body' },
  { file: 'measure/inconclusive', url: '/measure/inconclusive', title: 'result.inconclusive', place: 'body' },
  { file: 'emergency', url: '/emergency', title: 'emergency.title', place: 'body' },
  { file: 'measure/standing-test', url: '/measure/standing-test', title: 'standing.title', place: 'body' },
  { file: 'report/[id]', url: '/report/demo', title: 'report.title', place: 'nav' },
  { file: 'learn/[slug]', url: '/learn/what-is-afib', title: 'learn.lessonAfib', place: 'nav' },
  { file: 'settings/phone', url: '/settings/phone', title: 'phoneRating.title', place: 'nav' },
  { file: 'settings/profile', url: '/settings/profile', title: 'profile.settingsTitle', place: 'nav' },
  { file: 'settings/lab', url: '/settings/lab', title: 'lab.title', place: 'nav' },
  { file: 'measure/fix-technique', url: '/measure/fix-technique', title: 'fix.title', place: 'nav' },
  { file: 'settings/accuracy', url: '/settings/accuracy', title: 'accuracy.title', place: 'nav' },
  { file: 'settings/appearance', url: '/settings/appearance', title: 'appearance.title', place: 'nav' },
  {
    file: 'settings/notifications',
    url: '/settings/notifications',
    title: 'notifications.title',
    place: 'nav',
  },
  { file: 'settings/widgets/index', url: '/settings/widgets', title: 'widgets.title', place: 'nav' },
  {
    file: 'settings/widgets/lock-screen',
    url: '/settings/widgets/lock-screen',
    title: 'lockScreen.title',
    place: 'nav',
  },
  { file: 'follow-up', url: '/follow-up', title: 'followUp.title', place: 'body' },
];

// Resolved against the working directory, which is apps/mobile when the mobile workspace runs jest.
const appDirectory = './app';

// What the native header config must carry for a centred title: iOS always centres, so the checkable parts
// are the title, its Headline size and text colour, the teal chevron, no back text, and no shadow.
function navHeaderLook(title: string, colors: typeof tokens.dark) {
  return {
    title,
    titleColor: colors.text,
    titleFontSize: tokens.type.headline.size,
    color: colors.accent,
    backTitleVisible: false,
    hideShadow: true,
  };
}

function placeOf(title: keyof typeof en): TitlePlace {
  const route = routes.find((candidate) => candidate.title === title);
  if (!route) throw new Error(`no route in the table has the title ${title}`);
  return route.place;
}

// A nav-bar title is read from the focused native header; a body title from the screen's heading role.
function expectTitleOnScreen(title: keyof typeof en) {
  if (placeOf(title) === 'nav') {
    expectNavTitle(en[title]);
  } else {
    expect(screen.getByRole('header', { name: en[title] })).toBeOnTheScreen();
  }
}

function routeFilesUnder(directory: string): string[] {
  return (
    getMockContext(directory)
      .keys()
      .map((key) => key.replace(/^\.\//, '').replace(/\.tsx$/, ''))
      // Layouts and +native-intent (the deep-link rewriter) live in app/ but are not screens.
      .filter((file) => !file.endsWith('_layout') && file !== '+native-intent')
  );
}

preloadAppRoutes();

describe('route list', () => {
  it('covers every route file under app/ and nothing else', () => {
    expect([...new Set(routes.map((route) => route.file))].sort()).toEqual(
      routeFilesUnder(appDirectory).sort(),
    );
  });

  it('lists the 34 screens of the inventory, the Care tab, the two question screens and the diabetes result (ADRs 0054, 0065, 0090)', () => {
    expect(routes).toHaveLength(38);
  });
});

describe.each([
  ['dark', tokens.dark],
  ['light', tokens.light],
] as const)('routes in the %s theme', (scheme, colors) => {
  beforeEach(() => {
    mockScheme = scheme;
  });

  it.each(routes)('renders $url with its translated title', async ({ url, title, place }) => {
    if (url === '/') await startOnboarded();
    renderRouter(appDirectory, { initialUrl: url });
    // Home shows nothing until the profile says onboarding is done.
    if (url === '/') await screen.findByRole('header', { name: en[title] });
    const isEmergency = url === '/emergency';
    if (place === 'nav') {
      expect(focusedNavHeader()).toMatchObject(navHeaderLook(en[title], colors));
      expect(screen.queryByRole('header', { name: en[title] })).toBeNull();
    } else {
      const heading = screen.getByRole('header', { name: en[title] });
      expect(focusedNavHeader()?.title).not.toBe(en[title]);
      expect(StyleSheet.flatten(heading.props.style)).toMatchObject({
        color: isEmergency ? colors.criticalText : colors.text,
      });
    }

    // Red is reserved for the emergency screen (SAFE-1); the serialized tree holds every style colour.
    const drawn = JSON.stringify(screen.toJSON());
    expect(drawn.includes(colors.criticalFill)).toBe(isEmergency);
    expect(drawn.includes(colors.criticalText)).toBe(isEmergency);

    // The Care map answers its location lookup after the first render; waiting keeps that update inside act.
    if (url === '/care') await screen.findByText(en['careMap.denied']);
  });
});

describe('tab bar', () => {
  const careLabel = en['tabs.careLabel'];

  it('draws an icon on each of the four plain tabs', () => {
    mockScheme = 'dark';
    renderRouter(appDirectory, { initialUrl: '/' });
    for (const label of ['tabs.home', 'tabs.trends', 'tabs.learn', 'tabs.settings'] as const) {
      const tab = screen.getByLabelText(new RegExp(`^${en[label]}, tab`));
      expect(tab.findAll((node) => String(node.type) === 'RNSVGSvgView')).not.toHaveLength(0);
    }
  });

  it('has five tabs with Care in the middle, drawn as a raised accent circle', () => {
    mockScheme = 'dark';
    renderRouter(appDirectory, { initialUrl: '/' });
    const tabs = screen.getAllByLabelText(
      new RegExp(
        `^(${[en['tabs.home'], en['tabs.trends'], en['tabs.care'], en['tabs.learn'], en['tabs.settings']].join('|')}),`,
      ),
    );
    const names = tabs.map((tab) => tab.props.accessibilityLabel as string);
    expect(names).toHaveLength(5);
    expect(names[2]).toBe(careLabel);
    const care = screen.getByLabelText(careLabel);
    expect(care.findAll((node) => String(node.type) === 'RNSVGSvgView')).not.toHaveLength(0);
    expect(within(care).getByText(en['tabs.care'])).toBeOnTheScreen();
    const circle = care.findAll(
      (node) => StyleSheet.flatten(node.props.style)?.backgroundColor === tokens.dark.accentFill,
    );
    expect(circle).not.toHaveLength(0);
  });

  it.each(['light', 'dark'] as const)(
    'keeps the whole Care label inside the bar while the demo bar is up (%s)',
    (scheme) => {
      mockScheme = scheme;
      act(() => enterDemo());
      renderRouter(appDirectory, { initialUrl: '/' });
      expect(screen.getByText(en['demo.bar'])).toBeOnTheScreen();
      let tabRow = screen.getByLabelText(careLabel).parent;
      while (tabRow && StyleSheet.flatten(tabRow.props.style)?.height === undefined) tabRow = tabRow.parent;
      const barStyle = StyleSheet.flatten(tabRow?.props.style);
      // The visible 42 dp of the circle plus a 6 dp gap and the 18 dp caption line.
      expect(barStyle.height).toBeGreaterThanOrEqual(66);
      act(() => exitDemo());
    },
  );

  it('keeps the Care label on one line, shrunk to fit, in Spanish at font scale 2', async () => {
    mockScheme = 'light';
    const originalWindow = Dimensions.get('window');
    act(() => Dimensions.set({ window: { ...originalWindow, fontScale: 2 } }));
    await act(() => i18next.changeLanguage('es'));
    try {
      renderRouter(appDirectory, { initialUrl: '/' });
      const label = within(screen.getByLabelText(es['tabs.careLabel'])).getByText(es['tabs.care']);
      expect(label.props.numberOfLines).toBe(1);
      expect(label.props.adjustsFontSizeToFit).toBe(true);
    } finally {
      await act(() => i18next.changeLanguage('en'));
      act(() => Dimensions.set({ window: originalWindow }));
    }
  });

  it('grows the tab row with the font scale', () => {
    mockScheme = 'light';
    const originalWindow = Dimensions.get('window');
    act(() => Dimensions.set({ window: { ...originalWindow, fontScale: 2 } }));
    try {
      renderRouter(appDirectory, { initialUrl: '/' });
      let tabRow = screen.getByLabelText(careLabel).parent;
      while (tabRow && StyleSheet.flatten(tabRow.props.style)?.height === undefined) tabRow = tabRow.parent;
      const scaledLabelLine = tokens.type.caption.lineHeight * 2;
      const circleInRow = 42;
      expect(StyleSheet.flatten(tabRow?.props.style).height).toBeGreaterThan(scaledLabelLine + circleInRow);
    } finally {
      act(() => Dimensions.set({ window: originalWindow }));
    }
  });

  it.each(['light', 'dark'] as const)('keeps a 44 dp Care target in the %s theme', (scheme) => {
    mockScheme = scheme;
    renderRouter(appDirectory, { initialUrl: '/' });
    expect(StyleSheet.flatten(screen.getByLabelText(careLabel).props.style).minHeight).toBeGreaterThanOrEqual(
      44,
    );
  });

  it('opens the Care map when Care is pressed and marks it selected', async () => {
    mockScheme = 'dark';
    renderRouter(appDirectory, { initialUrl: '/' });
    expect(screen.getByLabelText(careLabel).props.accessibilityState).toMatchObject({ selected: false });
    fireEvent.press(screen.getByLabelText(careLabel));
    await screen.findByText(en['careMap.denied']);
    expect(screen.getByRole('header', { name: en['careMap.title'] })).toBeOnTheScreen();
    expect(screen.getByLabelText(careLabel).props.accessibilityState).toMatchObject({ selected: true });
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
      expectTitleOnScreen(nextTitle);
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
    fireEvent.changeText(await screen.findByLabelText(en['profile.age']), '42');
    // Next stores the basics before it opens the second question set.
    fireEvent.press(screen.getByRole('button', { name: en['common.next'] }));
    expect(await screen.findByRole('header', { name: en['dr.title'] })).toBeOnTheScreen();
    pressThrough([
      ['common.continue', 'phoneCheck.title'],
      ['phoneCheck.next', 'placement.title'],
      ['placement.start', 'practice.title'],
      ['common.continue', 'howToSit.title'],
      ['common.continue', 'rating.title'],
      ['common.continue', 'reminders.title'],
    ]);
    fireEvent.press(screen.getByRole('button', { name: en['reminders.turnOn'] }));
    expect(await screen.findByRole('header', { name: en['home.greetingMorning'] })).toBeOnTheScreen();
  });

  it('walks Home through a measurement to results', async () => {
    await startOnboarded();
    renderRouter(appDirectory, { initialUrl: '/' });
    await screen.findByRole('button', { name: en['home.measure'] });
    pressThrough([['home.measure', 'mode.title']]);
    fireEvent.press(screen.getByText(en['mode.quick']));
    expectTitleOnScreen('precheck.title');
    fireEvent.press(screen.getByRole('button', { name: en['precheck.start'] }));
    expectTitleOnScreen('mode.quick');
    // Capture ends only on clean seconds, which the emulator cannot produce, so the next screen is opened
    // by its route.
    act(() => router.push('/measure/processing'));
    fireEvent.press(screen.getByRole('button', { name: en['processing.seeSample'] }));
    expectTitleOnScreen('results.title');
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
      ['capture.stop', 'result.inconclusive'],
      ['inconclusive.fix', 'fix.title'],
      ['fix.done', 'mode.quick'],
    ]);
  });
});
