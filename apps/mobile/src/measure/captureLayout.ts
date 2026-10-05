// Sizes for the capture screen's finger preview, ring and waveform so the Checking panel stays on screen above
// the Stop button. The heights below are the other rows' sizes at the default font scale; a larger font scale
// still scrolls (the body is a ScrollView), it just starts from a smaller picture.
const HEADER_AND_STATUS = 44 + 26;
const MESSAGE = 22;
const TIMER_NOTE = 23;
const CHECK_LABELS = 22;
const WAVEFORM_CARD_CHROME = 58;
const WAVEFORM_HEIGHT = 96;
const PANEL_ROW_DP = 100;
const PANEL_STACKED_DP = 150;
const ROW_GAP = 12;
const FULL_ROWS = 8;

const TIGHT_WAVEFORM_HEIGHT = 40;
const TIGHT_CARD_CHROME = 38;
const TIGHT_ROW_GAP = 8;
const TIGHT_ROWS = 5;

const MAX_PREVIEW = 190;
const MIN_FULL_PREVIEW = 120;
const MIN_TIGHT_PREVIEW = 88;
const MAX_TIGHT_PREVIEW = 140;
// The ring is 0.78 of the preview, as in mockup 13, and covers this share of its own height on the preview.
const RING_TO_PREVIEW = 0.78;
const OVERLAP = 0.35;
// Three text lines (count, "of 90 clean s", bpm) must fit inside the ring.
const TIGHT_RING = 104;
const TIGHT_OVERLAP = 0.5;

export type CaptureSizes = {
  // Short screens drop the timer note and the Finger/Still/Pressure labels (the pill and the coaching line say
  // the same) and shrink the picture.
  tight: boolean;
  preview: number;
  ring: number;
  overlap: number;
  waveformHeight: number;
};

// `viewport` is the scrolling body's height; 0 before it has been measured.
export function captureSizes(viewport: number, stackedChecks: boolean): CaptureSizes {
  const panel = stackedChecks ? PANEL_STACKED_DP : PANEL_ROW_DP;
  if (viewport === 0) return fullSizes(MAX_PREVIEW);
  const fullRest =
    HEADER_AND_STATUS +
    MESSAGE +
    TIMER_NOTE +
    CHECK_LABELS +
    WAVEFORM_CARD_CHROME +
    WAVEFORM_HEIGHT +
    panel +
    ROW_GAP * FULL_ROWS;
  const fullPreview = (viewport - fullRest) / (1 + RING_TO_PREVIEW * (1 - OVERLAP));
  if (fullPreview >= MIN_FULL_PREVIEW) return fullSizes(Math.min(MAX_PREVIEW, Math.floor(fullPreview)));
  const tightRest =
    HEADER_AND_STATUS +
    MESSAGE +
    TIGHT_CARD_CHROME +
    TIGHT_WAVEFORM_HEIGHT +
    panel +
    TIGHT_ROW_GAP * TIGHT_ROWS;
  const preview = viewport - tightRest - TIGHT_RING * (1 - TIGHT_OVERLAP);
  return {
    tight: true,
    preview: Math.min(MAX_TIGHT_PREVIEW, Math.max(MIN_TIGHT_PREVIEW, Math.floor(preview))),
    ring: TIGHT_RING,
    overlap: TIGHT_OVERLAP,
    waveformHeight: TIGHT_WAVEFORM_HEIGHT,
  };
}

function fullSizes(preview: number): CaptureSizes {
  return {
    tight: false,
    preview,
    ring: Math.round(preview * RING_TO_PREVIEW),
    overlap: OVERLAP,
    waveformHeight: WAVEFORM_HEIGHT,
  };
}
