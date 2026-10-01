import fs from 'node:fs';
import zlib from 'node:zlib';

// BRAND-1 (assets): icon and splash dimensions, the iOS icon's lack of transparency, the Android
// adaptive-icon safe zone, and a white-only notification icon. Decodes PNGs with Node's zlib only.
function decodePng(file) {
  const buf = fs.readFileSync(file);
  let offset = 8;
  let header = null;
  const idat = [];
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const body = buf.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR')
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        depth: body[8],
        colorType: body[9],
      };
    if (type === 'IDAT') idat.push(body);
    offset += 12 + length;
  }
  const channels = { 2: 3, 6: 4 }[header.colorType];
  if (header.depth !== 8 || !channels)
    throw new Error(`${file}: unsupported PNG (depth ${header.depth}, color type ${header.colorType})`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = header.width * channels;
  const pixels = Buffer.alloc(stride * header.height);
  for (let y = 0; y < header.height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const cur = raw[y * (stride + 1) + 1 + x];
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0;
      const paeth = () => {
        const p = left + up - upLeft;
        const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
        return pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      };
      const predictor = [0, left, up, (left + up) >> 1, paeth()][filter];
      pixels[y * stride + x] = (cur + predictor) & 0xff;
    }
  }
  return { ...header, channels, pixels };
}

function alphaBounds(png) {
  let [minX, minY, maxX, maxY] = [png.width, png.height, -1, -1];
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      if (png.pixels[(y * png.width + x) * 4 + 3] > 8) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return { minX, minY, maxX, maxY };
}

const dir = 'apps/mobile/assets/brand/';
const failures = [];
const expect = (cond, message) => {
  if (!cond) failures.push(message);
};
const sizes = {
  'icon-ios-1024.png': [1024, 1024],
  'icon-ios-dark-1024.png': [1024, 1024],
  'icon-ios-tinted-1024.png': [1024, 1024],
  'android-foreground-432.png': [432, 432],
  'android-monochrome-432.png': [432, 432],
  'notification-icon-96.png': [96, 96],
  'splash-icon-512.png': [512, 512],
  'splash-dark.png': [1284, 2778],
  'splash-light.png': [1284, 2778],
  'favicon-48.png': [48, 48],
};
const decoded = {};
for (const [name, [w, h]] of Object.entries(sizes)) {
  if (!fs.existsSync(dir + name)) {
    failures.push(`${name} is missing`);
    continue;
  }
  decoded[name] = decodePng(dir + name);
  expect(
    decoded[name].width === w && decoded[name].height === h,
    `${name} is ${decoded[name].width}x${decoded[name].height}, expected ${w}x${h}`,
  );
}
if (decoded['icon-ios-1024.png'])
  expect(
    decoded['icon-ios-1024.png'].colorType === 2,
    'icon-ios-1024.png must have no alpha channel (iOS rejects transparent app icons)',
  );
for (const name of ['android-foreground-432.png', 'android-monochrome-432.png']) {
  const png = decoded[name];
  if (!png) continue;
  const b = alphaBounds(png);
  const lo = png.width * 0.17,
    hi = png.width * 0.83;
  expect(
    b.minX >= lo && b.minY >= lo && b.maxX <= hi && b.maxY <= hi,
    `${name}: artwork leaves the central 66% safe zone (${JSON.stringify(b)})`,
  );
}
const note = decoded['notification-icon-96.png'];
if (note) {
  let colored = 0;
  for (let i = 0; i < note.pixels.length; i += 4)
    if (
      note.pixels[i + 3] > 8 &&
      (note.pixels[i] < 240 || note.pixels[i + 1] < 240 || note.pixels[i + 2] < 240)
    )
      colored += 1;
  expect(colored === 0, `notification-icon-96.png must be white on transparent (${colored} colored pixels)`);
}
const config = JSON.parse(fs.readFileSync('apps/mobile/app.config.brand.json', 'utf8'));
expect(config.expo?.scheme === 'lumen', 'app.config.brand.json must set the "lumen" deep-link scheme');
for (const ref of JSON.stringify(config).match(/\.\/assets\/brand\/[\w.@-]+/g) ?? [])
  expect(
    fs.existsSync('apps/mobile/' + ref.slice(2)),
    `app.config.brand.json points to a missing file: ${ref}`,
  );
if (failures.length) {
  console.error(`Asset check failed:\n${failures.join('\n')}`);
  process.exit(1);
}
console.log(`Assets OK: ${Object.keys(decoded).length} images, safe zones, and the app-config snippet`);
