// Home greets by time of day, so tests that look for its heading fix the clock at 9:00 on a morning.
// Only Date is faked: the router and waitFor still need real timers.
export function fixClockAtMorning() {
  beforeAll(() => {
    jest.useFakeTimers({
      now: new Date(2026, 9, 1, 9, 0),
      doNotFake: [
        'hrtime',
        'nextTick',
        'performance',
        'queueMicrotask',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'requestIdleCallback',
        'cancelIdleCallback',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
      ],
    });
  });
  afterAll(() => jest.useRealTimers());
}
