import { HOLD_PAST_NEEDED_S, practiceSteadySeconds, STEADY_SECONDS_NEEDED } from './practiceProgress';

describe('practiceSteadySeconds', () => {
  it('shows nothing until the session has a count', () => {
    expect(practiceSteadySeconds(null)).toBe(0);
  });

  it('counts whole seconds', () => {
    expect(practiceSteadySeconds(9.6)).toBe(9);
  });

  it('does not end at exactly 30.0 s', () => {
    expect(practiceSteadySeconds(30)).toBe(STEADY_SECONDS_NEEDED - 1);
  });

  it('does not end just short of the extra hold', () => {
    expect(practiceSteadySeconds(STEADY_SECONDS_NEEDED + HOLD_PAST_NEEDED_S - 0.01)).toBe(
      STEADY_SECONDS_NEEDED - 1,
    );
  });

  it('ends once the extra hold is in, so the capture analyses to at least 30 clean seconds', () => {
    expect(practiceSteadySeconds(STEADY_SECONDS_NEEDED + HOLD_PAST_NEEDED_S)).toBe(STEADY_SECONDS_NEEDED);
    expect(practiceSteadySeconds(45)).toBe(STEADY_SECONDS_NEEDED);
  });
});
