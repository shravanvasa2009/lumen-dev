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
    expect(screen.getByTestId('lost-time-chart')).toBeOnTheScreen();
    expect(screen.getByLabelText('Movement 60%')).toBeOnTheScreen();
    expect(screen.getByLabelText('Pressure 25%')).toBeOnTheScreen();
    expect(screen.getByLabelText('Light 15%')).toBeOnTheScreen();
    expect(screen.getByTestId('icon-elbow', { hidden: true })).toBeOnTheScreen();
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
    expect(screen.getByLabelText('Light 100%')).toBeOnTheScreen();
    keepCapture(null);
  });

  it('labels the reading as demo data, and shows no banner when there is no reading', () => {
    renderRouter('./app', { initialUrl: '/measure/inconclusive?id=demo-inconclusive' });
    expect(screen.getByText(en['demo.banner'])).toBeOnTheScreen();
  });

  it('shows percentages that add to 100 when the shares do not divide evenly', () => {
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
      cleanSeconds: 30,
      neededCleanSeconds: 90,
      lostSeconds: { motion: 20, pressure: 20, coverage: 20, coldHands: 0 },
      otherLostSeconds: 0,
      causes: ['motion'],
      urgent: null,
    });
    renderRouter('./app', { initialUrl: '/measure/inconclusive?mode=full' });
    expect(screen.getByLabelText('Movement 34%')).toBeOnTheScreen();
    expect(screen.getByLabelText('Pressure 33%')).toBeOnTheScreen();
    expect(screen.getByLabelText('Light 33%')).toBeOnTheScreen();
    keepCapture(null);
  });

  it('leaves out the lost-time card when there is no breakdown', () => {
    renderRouter('./app', { initialUrl: '/measure/inconclusive' });
    expect(screen.getByText(en['inconclusive.generic'])).toBeOnTheScreen();
    expect(screen.queryByText(en['inconclusive.where'])).toBeNull();
    expect(screen.queryByTestId('lost-time-chart')).toBeNull();
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

  it('draws the clean seconds against the seconds needed in a ring', () => {
    renderRouter('./app', { initialUrl: '/measure/inconclusive?id=demo-inconclusive&mode=full' });
    expect(screen.getByLabelText('38 of 90 clean seconds')).toBeOnTheScreen();
  });

  it('links to a report of what was measured, listing the pre-check answers and no health values', () => {
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
      cleanSeconds: 22.4,
      neededCleanSeconds: 90,
      lostSeconds: { motion: 40, pressure: 16, coverage: 10, coldHands: 0 },
      otherLostSeconds: 0,
      causes: ['motion'],
      urgent: null,
    });
    renderRouter('./app', { initialUrl: '/measure/inconclusive?mode=full&context=caffeine,ill' });
    fireEvent.press(screen.getByText(en['results.doctorReport']));
    expect(screen.getByText('22 clean seconds collected of the 90 needed.')).toBeOnTheScreen();
    expect(screen.getByText('Most of the lost time was movement.')).toBeOnTheScreen();
    expect(screen.getByText('Before this reading: Caffeine, Feeling ill.')).toBeOnTheScreen();
    expect(screen.getByText(en['report.noValues'])).toBeOnTheScreen();
    expect(screen.queryByText(/bpm/)).toBeNull();
    expect(screen.getByRole('button', { name: en['report.sharePdf'] })).toBeOnTheScreen();
    keepCapture(null);
  });

  it('links a sample reading to its own report', () => {
    renderRouter('./app', { initialUrl: '/measure/inconclusive?id=demo-inconclusive' });
    fireEvent.press(screen.getByText(en['results.doctorReport']));
    expect(screen.getByText(en['report.heading'])).toBeOnTheScreen();
  });
});
