import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import en from '@/i18n/en.json';
import { handOverInconclusive } from '@/measure/inconclusiveHandoff';
import { keepCapture } from '@/measure/keptCapture';
import { fixClockAtMorning } from '@/testing/fixClockAtMorning';
import { startOnboarded } from '@/testing/onboarded';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

fixClockAtMorning();

preloadAppRoutes();

describe('inconclusive screen', () => {
  it('says how many clean seconds were collected and where the rest went', () => {
    renderRouter('./app', { initialUrl: '/measure/inconclusive?id=demo-inconclusive' });
    expect(screen.getByRole('header', { name: en['result.inconclusive'] })).toBeOnTheScreen();
    expect(
      screen.getByText('We got 38 clean seconds. Most of the lost time was movement.'),
    ).toBeOnTheScreen();
    expect(screen.getByText('Movement 31 s')).toBeOnTheScreen();
    expect(screen.getByText('Pressure 13 s')).toBeOnTheScreen();
    expect(screen.getByText('Light 8 s')).toBeOnTheScreen();
    expect(screen.getByText(en['inconclusive.tipElbows'])).toBeOnTheScreen();
    expect(screen.getByText(en['inconclusive.tipBreathe'])).toBeOnTheScreen();
  });

  it('shows whole seconds for a refused capture with fractional times', () => {
    keepCapture({
      captureFps: 60,
      lensId: null,
      samples: [],
      stats: [],
      motionSpans: [],
      coldHandsSpans: [],
      sqi: null,
    });
    handOverInconclusive({
      kind: 'inconclusive',
      reasons: ['tooFewCleanSeconds'],
      cleanSeconds: 12.7,
      neededCleanSeconds: 90,
      lostSeconds: { motion: 0, pressure: 0, coverage: 39.98333333333333, coldHands: 0 },
      otherLostSeconds: 0,
      causes: ['coverage'],
      urgent: null,
    });
    renderRouter('./app', { initialUrl: '/measure/inconclusive?mode=full' });
    expect(screen.getByText('We got 12 clean seconds. Most of the lost time was light.')).toBeOnTheScreen();
    expect(screen.getByText('Light 40 s')).toBeOnTheScreen();
    keepCapture(null);
  });

  it('labels the reading as demo data, and shows no banner when there is no reading', () => {
    renderRouter('./app', { initialUrl: '/measure/inconclusive?id=demo-inconclusive' });
    expect(screen.getByText(en['demo.banner'])).toBeOnTheScreen();
  });

  it('lists the causes without numbers when there is no reading to explain', () => {
    renderRouter('./app', { initialUrl: '/measure/inconclusive' });
    expect(screen.getByText(en['inconclusive.generic'])).toBeOnTheScreen();
    expect(screen.getByText(en['inconclusive.movement'])).toBeOnTheScreen();
    expect(screen.queryByText(/\d+ s$/)).toBeNull();
    expect(screen.queryByText(en['demo.banner'])).toBeNull();
  });

  it('retakes in the same mode', () => {
    renderRouter('./app', { initialUrl: '/measure/inconclusive?mode=quick' });
    fireEvent.press(screen.getByRole('button', { name: en['inconclusive.retake'] }));
    expect(screen.getByRole('header', { name: en['mode.quick'] })).toBeOnTheScreen();
  });

  it('switches to a Quick Check', () => {
    renderRouter('./app', { initialUrl: '/measure/inconclusive?mode=full' });
    fireEvent.press(screen.getByRole('button', { name: en['inconclusive.tryQuick'] }));
    expect(screen.getByRole('header', { name: en['mode.quick'] })).toBeOnTheScreen();
  });

  it('closes to Home', async () => {
    await startOnboarded();
    renderRouter('./app', { initialUrl: '/measure/inconclusive' });
    fireEvent.press(screen.getByRole('button', { name: en['inconclusive.close'] }));
    expect(await screen.findByRole('header', { name: en['home.greetingMorning'] })).toBeOnTheScreen();
  });
});
