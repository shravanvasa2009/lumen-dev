import clinicFile from '../../assets/clinics.json';

export type Coordinates = { lat: number; lon: number };

type Clinic = Coordinates & {
  id: string;
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
};

export type NearbyClinic = Clinic & { miles: number };

const EARTH_RADIUS_MILES = 3958.8;
// Pins and list rows stay few so the map is readable and each one can be tapped.
const NEARBY_LIMIT = 20;
const ZIP_PATTERN = /^(\d{5})(-\d{4})?$/;
const STATE_PATTERN = /^[A-Za-z]{2}$/;
// Same first three digits means the same USPS sorting area: a fallback for ZIP codes with no clinic.
const ZIP_AREA_DIGITS = 3;

const clinics: readonly Clinic[] = (clinicFile.rows as (string | number)[][]).map((row, index) => ({
  id: String(index),
  name: String(row[0]),
  street: String(row[1]),
  city: String(row[2]),
  state: String(row[3]),
  zip: String(row[4]),
  phone: String(row[5]),
  lat: Number(row[6]),
  lon: Number(row[7]),
}));

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

export function distanceMiles(from: Coordinates, to: Coordinates): number {
  const latGap = toRadians(to.lat - from.lat);
  const lonGap = toRadians(to.lon - from.lon);
  const haversine =
    Math.sin(latGap / 2) ** 2 +
    Math.cos(toRadians(from.lat)) * Math.cos(toRadians(to.lat)) * Math.sin(lonGap / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(haversine));
}

export function nearestClinics(origin: Coordinates, limit = NEARBY_LIMIT): NearbyClinic[] {
  return clinics
    .map((clinic) => ({ ...clinic, miles: distanceMiles(origin, clinic) }))
    .sort((first, second) => first.miles - second.miles)
    .slice(0, limit);
}

function centreOf(matches: readonly Clinic[]): Coordinates | null {
  if (matches.length === 0) return null;
  const lat = matches.reduce((sum, clinic) => sum + clinic.lat, 0) / matches.length;
  const lon = matches.reduce((sum, clinic) => sum + clinic.lon, 0) / matches.length;
  return { lat, lon };
}

// "77002", "Houston", "Houston TX" and "Houston, TX" all work; the list is searched on the device.
export function findPlace(query: string): Coordinates | null {
  const text = query.trim();
  const zip = ZIP_PATTERN.exec(text)?.[1];
  if (zip) {
    const exact = centreOf(clinics.filter((clinic) => clinic.zip === zip));
    return (
      exact ?? centreOf(clinics.filter((clinic) => clinic.zip.startsWith(zip.slice(0, ZIP_AREA_DIGITS))))
    );
  }
  const words = text.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const lastWord = words[words.length - 1] ?? '';
  const state = words.length > 1 && STATE_PATTERN.test(lastWord) ? lastWord.toUpperCase() : null;
  const city = (state ? words.slice(0, -1) : words).join(' ').toLowerCase();
  return centreOf(
    clinics.filter(
      (clinic) => clinic.city.toLowerCase() === city && (state === null || clinic.state === state),
    ),
  );
}
