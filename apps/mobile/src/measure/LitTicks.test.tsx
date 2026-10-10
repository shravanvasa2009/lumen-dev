import { act, render } from '@testing-library/react-native';
import * as Reanimated from 'react-native-reanimated';
import Svg from 'react-native-svg';

import { LitTicks } from './LitTicks';

let mockReduceMotion = false;
jest.mock('@/theme/motion', () => ({
  ...jest.requireActual('@/theme/motion'),
  useReduceMotion: () => mockReduceMotion,
}));

const COUNT = 30;
const BASE_LINES = COUNT;
// Each lit tick adds a halo line and a tick line.
const LINES_PER_LIT_TICK = 2;

function ticks(lit: number) {
  return (
    <Svg>
      <LitTicks
        center={50}
        outerRadius={48}
        length={6}
        count={COUNT}
        lit={lit}
        litColor="#00FF00"
        majorEvery={10}
        color="#111111"
        majorColor="#222222"
      />
    </Svg>
  );
}

function lineCount(view: ReturnType<typeof render>) {
  return view.UNSAFE_root.findAll(
    (node) => typeof node.type === 'string' && node.type.includes('Line'),
  ).filter((node) => typeof node.props.x1 === 'number').length;
}

function litLines(view: ReturnType<typeof render>) {
  return view.UNSAFE_root.findAll(
    (node) =>
      node.props.animatedProps !== undefined && node.props.stroke === '#00FF00' && node.props.opacity !== 0,
  ).length;
}

describe('LitTicks', () => {
  beforeEach(() => {
    mockReduceMotion = false;
  });

  it('draws one tick per count and none lit at zero', () => {
    const view = render(ticks(0));
    expect(lineCount(view)).toBe(BASE_LINES);
    expect(litLines(view)).toBe(0);
  });

  it('lights one more tick for each step of the count', () => {
    const view = render(ticks(3));
    expect(litLines(view)).toBe(3);
    view.rerender(ticks(4));
    expect(litLines(view)).toBe(4);
    expect(lineCount(view)).toBe(BASE_LINES + 4 * LINES_PER_LIT_TICK);
  });

  it('clamps a count above the tick total', () => {
    const view = render(ticks(COUNT + 5));
    expect(litLines(view)).toBe(COUNT);
  });

  it('pops only the newly lit tick', () => {
    const view = render(ticks(5));
    const startValues = jest.spyOn(Reanimated, 'useSharedValue');
    act(() => view.rerender(ticks(6)));
    const popped = startValues.mock.calls.filter(([initial]) => initial === 1);
    expect(popped).toHaveLength(1);
    startValues.mockRestore();
  });

  it('lights ticks with no pop under Reduce Motion', () => {
    mockReduceMotion = true;
    const view = render(ticks(2));
    const startValues = jest.spyOn(Reanimated, 'useSharedValue');
    act(() => view.rerender(ticks(3)));
    expect(startValues.mock.calls.filter(([initial]) => initial === 1)).toHaveLength(0);
    expect(litLines(view)).toBe(3);
    startValues.mockRestore();
  });
});
