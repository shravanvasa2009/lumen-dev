// Sizes for the capture screen's live view, ring and waveform. The live view is 176 dp (the owner's pick from the
// 2026-10-05 proposal, variant A) with the timer ring beneath it, not over it, so on most phones the Checking
// panel is reached by scrolling (the body is a ScrollView and Stop sits in the footer). Only a short screen,
// such as 360 x 640 dp, shrinks the view and drops the extras so the panel stays on screen above Stop.
const HEADER_AND_STATUS = 44 + 26;
const MESSAGE = 22;
const WAVEFORM_HEIGHT = 96;
const PANEL_ROW_DP = 100;
const PANEL_STACKED_DP = 150;

const FULL_PREVIEW = 176;
const FULL_RING = 150;
// Ring stroke and gap around the view, twice, plus the caption row and its gap under it.
const LIVE_FRAME = 2 * (4 + 3) + 8 + 20;

const TIGHT_BELOW_VIEWPORT = 600;
const TIGHT_WAVEFORM_HEIGHT = 40;
const TIGHT_CARD_CHROME = 38;
// The raw-signal caption, its 24 dp trace and the gaps between the two traces' rows.
const TIGHT_RAW_TRACE = 48;
const TIGHT_ROW_GAP = 8;
const TIGHT_ROWS = 5;
const MIN_TIGHT_PREVIEW = 88;
const MAX_TIGHT_PREVIEW = 140;
// Two text lines (the count and "of 90 clean s") must fit inside the ring.
const TIGHT_RING = 104;

export type CaptureSizes = {
  // Short screens drop the timer note and the Finger/Still/Pressure labels (the pill and the coaching line say
  // the same) and shrink the view.
  tight: boolean;
  preview: number;
  ring: number;
  waveformHeight: number;
};

// `viewport` is the scrolling body's height; 0 before it has been measured.
export function captureSizes(viewport: number, stackedChecks: boolean): CaptureSizes {
  if (viewport === 0 || viewport >= TIGHT_BELOW_VIEWPORT) {
    return { tight: false, preview: FULL_PREVIEW, ring: FULL_RING, waveformHeight: WAVEFORM_HEIGHT };
  }
  const panel = stackedChecks ? PANEL_STACKED_DP : PANEL_ROW_DP;
  const rest =
    HEADER_AND_STATUS +
    MESSAGE +
    TIGHT_CARD_CHROME +
    TIGHT_WAVEFORM_HEIGHT +
    TIGHT_RAW_TRACE +
    panel +
    TIGHT_ROW_GAP * TIGHT_ROWS +
    TIGHT_RING +
    LIVE_FRAME;
  return {
    tight: true,
    preview: Math.min(MAX_TIGHT_PREVIEW, Math.max(MIN_TIGHT_PREVIEW, Math.floor(viewport - rest))),
    ring: TIGHT_RING,
    waveformHeight: TIGHT_WAVEFORM_HEIGHT,
  };
}
