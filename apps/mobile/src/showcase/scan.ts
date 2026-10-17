import { HOLD_S, Script } from './script';

// The two-minute rest before a reading runs for real; the editor speeds through it.
const REST_S = 121;
// Attempt 1 is stopped this far into the capture, once the coaching has shown the problem.
const REFUSED_AFTER_S = 8.5;
// Recorded scans reach 90 clean seconds at 102.1 s of capture time on both phones
// (tools/showcase/check-timing.mjs), then Processing runs; the slower phone needs about 10 s.
const SCAN_S = 103;
const PROCESSING_S = 12;

// The scanning film, from Home: a Full Scan whose first try is refused with technique tips, then the real
// scan with its pauses for movement, then the result and why Lumen called it regular.
export function scanSteps(script: Script): Script {
  return (
    script
      .hold(2)
      .tap('Measure')
      .hold(1.5)
      .tap('Continue with Full Scan')
      // Before you start: the rest ring, then the reading.
      .hold(REST_S)
      .tap('Start reading')
      // Attempt 1: the finger is off the lens; the app says so and the person stops.
      .hold(REFUSED_AFTER_S)
      .tap('Stop reading')
      .hold(2)
      .scrollThrough(3, 1.5)
      .tap('Fix my technique (2 min)')
      .hold(1.5)
      .scrollThrough(4, 1.5)
      .tap('Done. Take a reading')
      // Attempt 2: the scan, with its movement pauses, then Analyzing, then Results.
      .hold(SCAN_S + PROCESSING_S)
      .hold(HOLD_S)
      .scrollThrough(6, 2)
      .scrollToTop()
      .tap('Show me why')
      .hold(2)
      .scrollThrough(8, 2)
  );
}
