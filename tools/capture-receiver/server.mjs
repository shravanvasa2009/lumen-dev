import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { captureDir } from '../../scripts/lib/workspace.mjs';

// Development only: receives Lab-mode captures from a development build on the same Wi-Fi and writes
// them to the workspace's private captures/ folder. Release builds contain no sender (PRIV-1).
const port = Number(process.env.LUMEN_RECEIVER_PORT ?? 8787);
const token = process.env.LUMEN_RECEIVER_TOKEN ?? crypto.randomBytes(6).toString('hex');
const outDir = captureDir();
const MAX_BYTES = 60 * 1024 * 1024;

const slug = (text) =>
  String(text ?? 'phone')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 24) || 'phone';
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const csv = (header, columns) =>
  [header.join(','), ...columns[0].map((_, i) => columns.map((col) => col[i]).join(','))].join('\n') + '\n';

function writeCapture(capture) {
  const { meta, samples, stats, polarRr } = capture;
  const lengths = [samples.tNs, samples.r, samples.g, samples.b].map((arr) => arr?.length);
  if (!lengths[0] || lengths.some((len) => len !== lengths[0]))
    throw new Error('samples arrays are missing or have different lengths');
  const folder = path.join(outDir, `${stamp()}-${slug(meta?.modelId)}`);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(
    path.join(folder, 'samples.csv'),
    csv(['t_ns', 'r', 'g', 'b'], [samples.tNs, samples.r, samples.g, samples.b]),
  );
  if (stats?.tNs?.length)
    fs.writeFileSync(
      path.join(folder, 'stats.csv'),
      csv(
        ['t_ns', 'spatial_std_r', 'clip_frac', 'exposure_ns'],
        [stats.tNs, stats.spatialStdR, stats.clipFrac, stats.exposureNs],
      ),
    );
  if (polarRr?.tNs?.length)
    fs.writeFileSync(path.join(folder, 'polar_rr.csv'), csv(['t_ns', 'rr_ms'], [polarRr.tNs, polarRr.rrMs]));
  fs.writeFileSync(path.join(folder, 'meta.json'), JSON.stringify(meta ?? {}, null, 2));
  return path.basename(folder);
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') return res.writeHead(200).end('ok');
  if (req.method !== 'POST' || req.url !== '/capture') return res.writeHead(404).end();
  if (req.headers['x-lumen-token'] !== token) return res.writeHead(401).end('bad token');
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BYTES) req.destroy(new Error('capture too large'));
    else chunks.push(chunk);
  });
  req.on('end', () => {
    try {
      const folder = writeCapture(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      console.log(`saved ${folder}`);
      res.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify({ folder }));
    } catch (err) {
      console.error(`rejected capture: ${err.message}`);
      res.writeHead(400).end(err.message);
    }
  });
});

server.listen(port, '0.0.0.0', () => {
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((net) => net?.family === 'IPv4' && !net.internal)
    .map((net) => net.address);
  console.log(`Lumen capture receiver on port ${port}, saving to ${outDir}`);
  console.log(
    `In Lab mode, set the PC address to one of: ${addresses.map((ip) => `${ip}:${port}`).join(', ') || '(no LAN address found)'}`,
  );
  console.log(`Token: ${token}`);
});
