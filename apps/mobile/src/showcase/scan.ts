import { HOLD_S, Script } from './script';

// The two-minute rest before a reading runs for real; the editor speeds through it.
const REST_S = 121;
// The scan take plays in one piece: the camera on the floor and the finger landing (no pulse, "Cover the
// lens"), then the count, which pauses while the scripted slip shows "Cover the lens and the flash." (scanSource.ts
// SLIP). Recorded takes reach 90 clean seconds about 112 s in, 8 s later than without the slip
// (tools/showcase/check-timing.mjs), then Processing runs; the slower phone needs about 10 s.
const SCAN_S = 114;
const PROCESSING_S = 12;

// The scanning film, from Home: a Full Scan whose opening seconds show the app refusing a lens with no finger,
// then the real count with one slipped finger coached back, the result and why Lumen called it regular.
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
      .hold(SCAN_S + PROCESSING_S)
      .hold(HOLD_S)
      .scrollThrough(6, 2)
      .scrollToTop()
      .tap('Show me why')
      .hold(2)
      .scrollThrough(8, 2)
  );
}
