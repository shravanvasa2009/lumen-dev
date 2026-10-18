// Only src/care may import the map library or care code (PRIV-1, scripts/priv-check.mjs), so this file names
// just what it uses: the camera's easeTo (MapLibre CameraRef, 11.4.1) and a centre.
type MapCamera = {
  easeTo(options: { center: [number, number]; zoom: number; duration: number }): void;
};
type Centre = { lat: number; lon: number };

// The care map's camera, registered while the map is on screen in a showcase build, so the film can look
// around it the way a person would after a search: drag across the nearby clinics, zoom in, zoom back out.
let shown: { camera: MapCamera; centre: Centre } | null = null;

export function registerMapCamera(camera: MapCamera | null, centre: Centre): void {
  shown = camera === null ? null : { camera, centre };
}

// Offsets in degrees from the search centre (about 2–3 km at 30° N) and zooms around the map's start zoom of 11.
const LOOKS = [
  { east: 0.03, north: 0.015, zoom: 12, ms: 1300 },
  { east: -0.025, north: -0.02, zoom: 12.6, ms: 1500 },
  { east: -0.005, north: 0.01, zoom: 13.2, ms: 1200 },
  { east: 0, north: 0, zoom: 11, ms: 1300 },
];
const PAUSE_MS = 350;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Glides the care map around its centre for about 6.6 s; false while no map is on screen. */
export async function lookAroundMap(): Promise<boolean> {
  if (shown === null) return false;
  const { camera, centre } = shown;
  for (const look of LOOKS) {
    camera.easeTo({
      center: [centre.lon + look.east, centre.lat + look.north],
      zoom: look.zoom,
      duration: look.ms,
    });
    await sleep(look.ms + PAUSE_MS);
  }
  return true;
}
