import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import en from '@/i18n/en.json';

let mockScheme: 'light' | 'dark' = 'dark';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme,
}));

const causes = ['pressure', 'motion', 'coverage', 'coldHands'] as const;

describe('fix my technique', () => {
  it.each(['light', 'dark'] as const)('renders in %s with the practice card and Done', (scheme) => {
    mockScheme = scheme;
    renderRouter('./app', { initialUrl: '/measure/fix-technique?cause=pressure' });
    expect(screen.getByRole('header', { name: en['fix.title'] })).toBeOnTheScreen();
    expect(screen.getByText(en['fix.tooHard'])).toBeOnTheScreen();
    expect(screen.getByText(en['fix.justRight'])).toBeOnTheScreen();
    expect(screen.getByText(en['fix.tryCover'])).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: en['fix.done'] })).toBeOnTheScreen();
  });

  it.each(causes)('explains %s with its own sentence', (cause) => {
    renderRouter('./app', { initialUrl: `/measure/fix-technique?cause=${cause}` });
    expect(screen.getByText(en[`fix.cause.${cause}`])).toBeOnTheScreen();
    expect(screen.getByText(new RegExp(en[`fix.why.${cause}`]))).toBeOnTheScreen();
    expect(screen.queryByText(en['fix.introGeneric'])).toBeNull();
  });

  it('gives a generic introduction when no cause is passed or the cause is unknown', () => {
    renderRouter('./app', { initialUrl: '/measure/fix-technique?cause=red' });
    expect(screen.getByText(en['fix.introGeneric'])).toBeOnTheScreen();
    expect(screen.queryByText(new RegExp(en['fix.lead']))).toBeNull();
  });

  it('shows the meter idle with no live values and says the camera is not connected', () => {
    renderRouter('./app', { initialUrl: '/measure/fix-technique' });
    expect(screen.getByText('0 of 20 steady seconds')).toBeOnTheScreen();
    expect(screen.getByText(en['practice.pending'])).toBeOnTheScreen();
  });

  it.each(['quick', 'full'] as const)('takes a %s reading when Done is pressed', (mode) => {
    renderRouter('./app', { initialUrl: `/measure/fix-technique?mode=${mode}&cause=motion` });
    fireEvent.press(screen.getByRole('button', { name: en['fix.done'] }));
    expect(screen.getByRole('header', { name: en[`mode.${mode}`] })).toBeOnTheScreen();
  });

  it('is reached from Inconclusive with the largest lost cause', () => {
    renderRouter('./app', { initialUrl: '/measure/inconclusive?id=demo-inconclusive' });
    fireEvent.press(screen.getByRole('button', { name: en['inconclusive.fix'] }));
    expect(screen.getByText(en['fix.cause.motion'])).toBeOnTheScreen();
  });

  it('is reached from Inconclusive without a cause when there is no reading', () => {
    renderRouter('./app', { initialUrl: '/measure/inconclusive' });
    fireEvent.press(screen.getByRole('button', { name: en['inconclusive.fix'] }));
    expect(screen.getByText(en['fix.introGeneric'])).toBeOnTheScreen();
  });
});
