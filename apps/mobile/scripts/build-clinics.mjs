// Builds assets/clinics.json from the HRSA "Health Center Service Delivery and Look-Alike Sites" CSV
// (public domain, CC0; ADR 0054). Run `node scripts/build-clinics.mjs` from apps/mobile to refresh it.
// Optional first argument: a local copy of the CSV, to rebuild without a download.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CSV_URL =
  'https://data.hrsa.gov/DataDownload/DD_Files/Health_Center_Service_Delivery_and_LookAlike_Sites.csv';
const OUTPUT = fileURLToPath(new URL('../assets/clinics.json', import.meta.url));

// HRSA's download names its columns in words; its map service uses SITE_PHONE_NUM, X and Y. Both are
// accepted, matched by header name and never by position.
const COLUMN_NAMES = {
  name: ['Site Name', 'SITE_NM'],
  street: ['Site Address', 'SITE_ADDRESS'],
  city: ['Site City', 'SITE_CITY'],
  state: ['Site State Abbreviation', 'SITE_STATE_ABBR'],
  zip: ['Site Postal Code', 'SITE_POSTAL_CODE'],
  phone: ['Site Telephone Number', 'SITE_PHONE_NUM'],
  lon: ['Geocoding Artifact Address Primary X Coordinate', 'X'],
  lat: ['Geocoding Artifact Address Primary Y Coordinate', 'Y'],
};
const STATUS_COLUMN = 'Site Status Description';

// RFC 4180: quoted fields may hold commas, doubled quotes and line breaks.
function parseCsv(text) {
  const records = [];
  let record = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char !== '"') field += char;
      else if (text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      record.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      record.push(field);
      field = '';
      if (record.some((cell) => cell !== '')) records.push(record);
      record = [];
    } else field += char;
  }
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

function findColumns(header) {
  const found = {};
  const missing = [];
  for (const [field, names] of Object.entries(COLUMN_NAMES)) {
    const position = header.findIndex((title) => names.includes(title.trim()));
    if (position === -1) missing.push(field);
    else found[field] = position;
  }
  return { found, missing };
}

const source = process.argv[2];
let csvText;
if (source) {
  csvText = readFileSync(source, 'utf8');
} else {
  const response = await fetch(CSV_URL);
  if (!response.ok) throw new Error(`HRSA download failed: ${response.status} ${response.statusText}`);
  csvText = await response.text();
}

const [header, ...rows] = parseCsv(csvText.replace(/^\uFEFF/, ''));
console.log('CSV header row:', header.join(' | '));

const { found, missing } = findColumns(header);
if (missing.length > 0) {
  const wanted = missing.map((field) => `${field} (${COLUMN_NAMES[field].join(' or ')})`).join(', ');
  throw new Error(`HRSA CSV is missing columns: ${wanted}. Check the header row printed above.`);
}
const statusPosition = header.findIndex((title) => title.trim() === STATUS_COLUMN);
if (statusPosition === -1) {
  console.warn(`Warning: no "${STATUS_COLUMN}" column, so closed sites are not filtered out.`);
}

const clinics = [];
for (const [index, row] of rows.entries()) {
  // Row numbers count the header as row 1, as a spreadsheet does.
  if (row.length !== header.length) {
    throw new Error(`CSV row ${index + 2} has ${row.length} fields; the header has ${header.length}.`);
  }
  if (statusPosition !== -1 && row[statusPosition].trim() !== 'Active') continue;
  const lon = Number(row[found.lon]);
  const lat = Number(row[found.lat]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || (lon === 0 && lat === 0)) continue;
  clinics.push([
    row[found.name].trim(),
    row[found.street].trim(),
    row[found.city].trim(),
    row[found.state].trim(),
    row[found.zip].trim().slice(0, 5),
    row[found.phone].trim(),
    Number(lat.toFixed(5)),
    Number(lon.toFixed(5)),
  ]);
}

// Rows instead of objects keep the bundle small (about 2 MB).
const fields = ['name', 'street', 'city', 'state', 'zip', 'phone', 'lat', 'lon'];
writeFileSync(OUTPUT, JSON.stringify({ fields, rows: clinics }));
console.log(`Wrote ${clinics.length} sites to ${OUTPUT}`);
