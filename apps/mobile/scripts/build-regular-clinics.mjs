// Builds assets/clinics-osm.json: US clinics and doctor offices from OpenStreetMap (ODbL; ADR 0078), the
// "Clinic" pins next to HRSA's low-cost sites. Run `npm run build:clinics-osm` from apps/mobile. It asks the
// public Overpass API one state at a time, 10 s apart, as its usage policy asks:
// https://dev.overpass-api.de/overpass-doc/en/preface/commons.html
// Responses are cached in the OS temp folder, so a run that fails part-way picks up where it stopped.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The main instance first, then the public mirrors listed on the OSM wiki, when one answers busy:
// https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const OUTPUT = fileURLToPath(new URL('../assets/clinics-osm.json', import.meta.url));
const HRSA_FILE = fileURLToPath(new URL('../assets/clinics.json', import.meta.url));
const CACHE = path.join(tmpdir(), 'lumen-osm-clinics');
const PAUSE_MS = 10_000;
const BUSY_PAUSE_MS = 60_000;
const ATTEMPTS = 12;
// Rate limited, or a busy or restarting server: worth another try after a pause.
const BUSY_STATUSES = new Set([429, 502, 503, 504]);
const USER_AGENT = 'Lumen-build-script/1.0 (+https://github.com/shravanvasa2009/lumen-dev)';

const STATES = [
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'DC',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
  'PR',
];

// Sites whose every listed speciality is one of these are not places to go about a pulse reading.
const NOT_PRIMARY_CARE = new Set([
  'abortion',
  'chiropractic',
  'cosmetic',
  'dentistry',
  'dermatology',
  'dialysis',
  'fertility',
  'ophthalmology',
  'optometry',
  'orthodontics',
  'orthopaedics',
  'plastic_surgery',
  'podiatry',
  'psychiatry',
  'psychotherapy',
  'physiotherapy',
  'radiology',
  'rehabilitation',
  'speech_therapy',
  'occupational_therapy',
  'acupuncture',
  'massage',
  'veterinary',
  'weight_loss',
  'blood_donation',
  'vaccination',
  'cosmetic_surgery',
  'hair_removal',
  'audiology',
  'oral_surgery',
  'periodontics',
]);
const NOT_PRIMARY_CARE_NAME =
  /\b(dental|dentist|dentistry|orthodont|chiropract|optometr|vision|eye care|veterinar|animal|pet|plastic surgery|cosmetic|med ?spa|laser|massage|physical therapy|dialysis|plasma|blood donation|weight loss|hair|tattoo|abortion|planned parenthood)\b/i;

// Same place: two sites this close whose names share most words (a clinic is often both a point and
// its building), or this close with the same phone number.
const SAME_SITE_METRES = 50;
const SAME_PHONE_METRES = 150;

function query(state) {
  const area =
    state === 'PR'
      ? 'area["ISO3166-1"="PR"]["boundary"="administrative"]->.s;'
      : `area["ISO3166-2"="US-${state}"]["boundary"="administrative"]->.s;`;
  return `[out:json][timeout:300][maxsize:536870912];
${area}
(
  nwr["amenity"~"^(clinic|doctors)$"](area.s);
  nwr["healthcare"~"^(clinic|doctor)$"](area.s);
);
out center tags qt;`;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// An answer can come back 200 with no remark and still hold only part of a state: the TX file behind #197 had
// 699 sites, none north of Houston, so Austin and the whole TX-31 area showed no regular clinics (WA was short
// too). HRSA health centers with several others nearby mark towns, and a complete answer has an OSM clinic or
// doctor's office near nearly all of them (0.97 to 1.00 on fresh TX and WA, 2026-10-04; the short files scored
// 0.45 and 0.68). Rural HRSA sites are left out, since AK and ND are sparse in OSM itself. A short answer is
// retried like a busy one, and a short cached one is fetched again.
const COVERAGE_MILES = 30;
const TOWN_NEIGHBOURS = 5;
const MIN_TOWNS = 50;
const MIN_COVERAGE = 0.85;
const COVERAGE_GRID_DEGREES = 0.5;
const coverageMetres = COVERAGE_MILES * 1609.344;
const elementPoint = (element) => ({
  lat: element.lat ?? element.center?.lat,
  lon: element.lon ?? element.center?.lon,
});
function coverage(elements, state) {
  const centres = hrsa.filter((site) => site.state === state);
  const towns = centres.filter(
    (centre) =>
      centres.filter((other) => other !== centre && metresApart(centre, other) <= coverageMetres).length >=
      TOWN_NEIGHBOURS,
  );
  if (towns.length < MIN_TOWNS) return 1;
  const osmCells = new Map();
  for (const point of elements.map(elementPoint).filter(({ lat }) => Number.isFinite(lat))) {
    const cell = `${Math.floor(point.lat / COVERAGE_GRID_DEGREES)}:${Math.floor(point.lon / COVERAGE_GRID_DEGREES)}`;
    if (!osmCells.has(cell)) osmCells.set(cell, []);
    osmCells.get(cell).push(point);
  }
  const covered = towns.filter((town) => {
    const latCell = Math.floor(town.lat / COVERAGE_GRID_DEGREES);
    const lonCell = Math.floor(town.lon / COVERAGE_GRID_DEGREES);
    for (let latStep = -1; latStep <= 1; latStep += 1) {
      for (let lonStep = -1; lonStep <= 1; lonStep += 1) {
        const near = osmCells.get(`${latCell + latStep}:${lonCell + lonStep}`) ?? [];
        if (near.some((point) => metresApart(town, point) <= coverageMetres)) return true;
      }
    }
    return false;
  });
  return covered.length / towns.length;
}

async function fetchState(state) {
  const cached = path.join(CACHE, `${state}.json`);
  if (existsSync(cached)) {
    const { elements } = JSON.parse(readFileSync(cached, 'utf8'));
    const share = coverage(elements, state);
    if (share >= MIN_COVERAGE) return { elements, fresh: false, share };
    console.warn(`Overpass ${state}: cached answer covers ${share.toFixed(2)} of HRSA sites; fetching again.`);
  }
  // The last short answer's coverage, so a run that never gets a complete one says why it stopped.
  let lastShare = null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const url = OVERPASS_URLS[(attempt - 1) % OVERPASS_URLS.length];
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
      body: `data=${encodeURIComponent(query(state))}`,
    });
    if (response.ok) {
      const text = await response.text();
      const answer = JSON.parse(text);
      // A query that runs out of time still answers 200, with a remark and only part of the sites.
      const share = coverage(answer.elements, state);
      if (!answer.remark && share >= MIN_COVERAGE) {
        writeFileSync(cached, text);
        return { elements: answer.elements, fresh: true, share };
      }
      if (!answer.remark) lastShare = share;
      console.warn(
        `Overpass ${state}: incomplete answer from ${url} (${answer.remark ?? `covers ${share.toFixed(2)} of HRSA sites`}).`,
      );
    } else if (!BUSY_STATUSES.has(response.status)) {
      throw new Error(`Overpass ${state}: ${response.status} ${response.statusText}`);
    } else {
      console.warn(
        `Overpass ${state}: ${response.status} from ${url}, attempt ${attempt} of ${ATTEMPTS}; waiting.`,
      );
    }
    await wait(BUSY_PAUSE_MS);
  }
  if (lastShare !== null) {
    throw new Error(
      `Overpass ${state}: answers cover only ${lastShare.toFixed(2)} of HRSA towns (need ${MIN_COVERAGE}). ` +
        'If OSM itself is that sparse there, lower MIN_COVERAGE for this state only after checking the map.',
    );
  }
  throw new Error(`Overpass ${state}: still busy after ${ATTEMPTS} attempts. Run again to resume.`);
}

const EARTH_RADIUS_METRES = 6_371_000;
const toRadians = (degrees) => (degrees * Math.PI) / 180;
function metresApart(first, second) {
  const latGap = toRadians(second.lat - first.lat);
  const lonGap = toRadians(second.lon - first.lon);
  const haversine =
    Math.sin(latGap / 2) ** 2 +
    Math.cos(toRadians(first.lat)) * Math.cos(toRadians(second.lat)) * Math.sin(lonGap / 2) ** 2;
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.sqrt(haversine));
}

const FILLER_WORDS = new Set(['the', 'of', 'and', 'at', 'inc', 'llc', 'pa', 'pc', 'md', 'center', 'centre']);
const nameWords = (name) =>
  new Set(
    name
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((word) => word && !FILLER_WORDS.has(word)),
  );
function similarNames(first, second) {
  const firstWords = nameWords(first);
  const secondWords = nameWords(second);
  if (firstWords.size === 0 || secondWords.size === 0) return false;
  const shared = [...firstWords].filter((word) => secondWords.has(word)).length;
  return shared / Math.min(firstWords.size, secondWords.size) >= 0.5;
}
const digits = (phone) => phone.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');

// A coarse grid (about 1 km) keeps the duplicate search to nearby sites only.
const GRID_DEGREES = 0.01;
const cellOf = ({ lat, lon }) => `${Math.floor(lat / GRID_DEGREES)}:${Math.floor(lon / GRID_DEGREES)}`;
function neighbours(grid, site) {
  const latCell = Math.floor(site.lat / GRID_DEGREES);
  const lonCell = Math.floor(site.lon / GRID_DEGREES);
  const found = [];
  for (let latStep = -1; latStep <= 1; latStep += 1) {
    for (let lonStep = -1; lonStep <= 1; lonStep += 1) {
      found.push(...(grid.get(`${latCell + latStep}:${lonCell + lonStep}`) ?? []));
    }
  }
  return found;
}
function addToGrid(grid, site) {
  const cell = cellOf(site);
  grid.set(cell, [...(grid.get(cell) ?? []), site]);
}
function isDuplicate(grid, site) {
  return neighbours(grid, site).some((other) => {
    const metres = metresApart(site, other);
    if (metres <= SAME_SITE_METRES && similarNames(site.name, other.name)) return true;
    const phone = digits(site.phone);
    return phone.length === 10 && metres <= SAME_PHONE_METRES && phone === digits(other.phone);
  });
}

function toSite(element, state) {
  const tags = element.tags ?? {};
  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;
  const name = (tags.name ?? '').trim();
  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ').trim();
  const phone = (tags.phone ?? tags['contact:phone'] ?? '').split(';')[0].trim();
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || name === '') return null;
  if (!(tags['addr:housenumber'] && tags['addr:street']) && phone === '') return null;
  const specialities = (tags['healthcare:speciality'] ?? '')
    .split(';')
    .map((value) => value.trim())
    .filter(Boolean);
  if (specialities.length > 0 && specialities.every((value) => NOT_PRIMARY_CARE.has(value))) return null;
  if (NOT_PRIMARY_CARE_NAME.test(name)) return null;
  return {
    name,
    street,
    city: (tags['addr:city'] ?? '').trim(),
    // addr:state is sometimes a full name ("Iowa"); the queried state is used unless it is a two-letter code.
    state: /^[A-Za-z]{2}$/.test((tags['addr:state'] ?? '').trim())
      ? tags['addr:state'].trim().toUpperCase()
      : state,
    zip: (tags['addr:postcode'] ?? '').trim().slice(0, 5),
    phone,
    lat: Number(lat.toFixed(5)),
    lon: Number(lon.toFixed(5)),
  };
}

mkdirSync(CACHE, { recursive: true });
const hrsa = JSON.parse(readFileSync(HRSA_FILE, 'utf8')).rows.map((row) => ({
  name: String(row[0]),
  state: String(row[3]),
  phone: String(row[5]),
  lat: Number(row[6]),
  lon: Number(row[7]),
}));
const grid = new Map();
for (const site of hrsa) addToGrid(grid, site);

const kept = [];
let seen = 0;
let duplicates = 0;
for (const state of STATES) {
  const { elements, fresh, share } = await fetchState(state);
  if (elements.length === 0) console.warn(`Warning: no sites for ${state}; check its area query.`);
  let stateKept = 0;
  for (const element of elements) {
    seen += 1;
    const site = toSite(element, state);
    if (!site) continue;
    if (isDuplicate(grid, site)) {
      duplicates += 1;
      continue;
    }
    addToGrid(grid, site);
    kept.push(site);
    stateKept += 1;
  }
  console.log(`${state}: ${elements.length} from OSM, ${stateKept} kept, HRSA coverage ${share.toFixed(2)}`);
  if (fresh) await wait(PAUSE_MS);
}

const fields = ['name', 'street', 'city', 'state', 'zip', 'phone', 'lat', 'lon'];
const rows = kept.map((site) => fields.map((field) => site[field]));
// The license travels with the data (ODbL 4.3); the app shows the same line on the Care map.
const license = {
  source: 'OpenStreetMap',
  attribution: '© OpenStreetMap contributors',
  license: 'Open Database License (ODbL) 1.0',
  url: 'https://www.openstreetmap.org/copyright',
};
writeFileSync(OUTPUT, JSON.stringify({ ...license, fields, rows }));
console.log(
  `Read ${seen} OSM sites; dropped ${duplicates} duplicates of HRSA or OSM sites; wrote ${rows.length} ` +
    `to ${OUTPUT} (${(statSync(OUTPUT).size / 1_000_000).toFixed(2)} MB)`,
);
