import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import en from '@/i18n/en.json';
import { fixClockAtMorning } from '@/testing/fixClockAtMorning';
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

  it('closes to Home', () => {
    renderRouter('./app', { initialUrl: '/measure/inconclusive' });
    fireEvent.press(screen.getByRole('button', { name: en['inconclusive.close'] }));
    expect(screen.getByRole('header', { name: en['home.greetingMorning'] })).toBeOnTheScreen();
  });
});
