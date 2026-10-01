import { render, screen } from '@testing-library/react-native';
import { fireEvent, renderRouter } from 'expo-router/testing-library';

import en from '@/i18n/en.json';

import { RatingGauge } from './RatingGauge';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'dark',
}));

const arcs = () => screen.root.findAll((node) => String(node.type) === 'RNSVGPath');

describe('rating gauge', () => {
  it('draws only the track and a dash instead of a number while unrated', () => {
    render(<RatingGauge score={null} />);
    expect(screen.getByText('—')).toBeOnTheScreen();
    expect(arcs()).toHaveLength(1);
  });

  it('draws a filled arc and the score once a rating exists', () => {
    render(<RatingGauge score={86} />);
    expect(screen.getByText('86')).toBeOnTheScreen();
    expect(arcs()).toHaveLength(2);
  });
});

describe('rating screen', () => {
  it('says the rating is pending instead of showing a made-up score', () => {
    renderRouter('./app', { initialUrl: '/rating' });
    expect(screen.getByText(en['rating.pending'])).toBeOnTheScreen();
    expect(screen.getByText('—')).toBeOnTheScreen();
  });

  it('continues to Reminders', () => {
    renderRouter('./app', { initialUrl: '/rating' });
    fireEvent.press(screen.getByRole('button', { name: en['common.continue'] }));
    expect(screen.getByRole('header', { name: en['reminders.title'] })).toBeOnTheScreen();
  });
});
