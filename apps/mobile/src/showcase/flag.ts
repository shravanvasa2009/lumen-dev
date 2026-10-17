// Showcase builds are made only for filming the demo (track/showcase, never main).
export const SHOWCASE = process.env.EXPO_PUBLIC_LUMEN_SHOWCASE === '1';
// A rehearsal skips the steps that need a finger on the camera.
export const REHEARSAL = process.env.EXPO_PUBLIC_LUMEN_SHOWCASE_REHEARSAL === '1';
