/** @jest-environment node */
import type { SampleBatch } from '../../modules/lumen-capture/src';

import { captureRequestBody } from './captureRequest';
import { sendCapture } from './sendCapture';

// The app tsconfig has no Node types, so the Node modules this test needs are typed here.
type Child = {
  stdout: { on(event: 'data', cb: (chunk: { toString(): string }) => void): void };
  stderr: { on(event: 'data', cb: (chunk: { toString(): string }) => void): void };
  on(event: 'exit', cb: (code: number | null) => void): void;
  kill(): boolean;
};
const { spawn } = jest.requireActual<{
  spawn(command: string, args: string[], options: { env: Record<string, string | undefined> }): Child;
}>('child_process');
const fs = jest.requireActual<{
  mkdtempSync(prefix: string): string;
  readFileSync(file: string, encoding: 'utf8'): string;
  rmSync(dir: string, options: { recursive: true; force: true }): void;
}>('fs');
const net = jest.requireActual<{
  createServer(): {
    listen(port: number, host: string, cb: () => void): void;
    address(): { port: number };
    close(cb: () => void): void;
  };
}>('net');
type Reply = {
  statusCode?: number;
  setEncoding(encoding: 'utf8'): void;
  on(event: 'data', cb: (chunk: string) => void): void;
  on(event: 'end', cb: () => void): void;
};
const http = jest.requireActual<{
  request(
    url: string,
    options: { method: string; headers: Record<string, string> },
    cb: (reply: Reply) => void,
  ): { on(event: 'error', cb: (error: Error) => void): void; end(body: string): void };
}>('http');
const os = jest.requireActual<{ tmpdir(): string }>('os');
const path = jest.requireActual<{ join(...parts: string[]): string; dirname(file: string): string }>('path');

function receiverScript(): string {
  const testPath = expect.getState().testPath;
  if (!testPath) throw new Error('Jest did not report this test file path');
  return path.join(path.dirname(testPath), '..', '..', '..', '..', 'tools', 'capture-receiver', 'server.mjs');
}
const TOKEN = 'receiver-test-token';

// jest-expo replaces the global fetch with a stub; this one sends over a real socket with Node's http.
function nodeFetch(url: string, init: { method: string; headers: Record<string, string>; body: string }) {
  return new Promise<{ status: number; text(): Promise<string> }>((resolve, reject) => {
    const request = http.request(url, { method: init.method, headers: init.headers }, (reply) => {
      let text = '';
      reply.setEncoding('utf8');
      reply.on('data', (chunk) => {
        text += chunk;
      });
      reply.on('end', () => resolve({ status: reply.statusCode ?? 0, text: async () => text }));
    });
    request.on('error', reject);
    request.end(init.body);
  });
}

function freePort(): Promise<number> {
  const probe = net.createServer();
  return new Promise((resolve) =>
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    }),
  );
}

// Resolves once the receiver prints its token line, which it does after listen() succeeds.
function startReceiver(port: number, captureDir: string): Promise<Child> {
  const child = spawn(process.execPath, [receiverScript()], {
    env: {
      ...process.env,
      LUMEN_RECEIVER_PORT: String(port),
      LUMEN_RECEIVER_TOKEN: TOKEN,
      LUMEN_CAPTURE_DIR: captureDir,
    },
  });
  return new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      if (output.includes('Token:')) resolve(child);
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('exit', (code) => reject(new Error(`receiver exited with ${code}: ${output}`)));
  });
}

// SYNTHETIC values: they check that each column lands in the right CSV column, nothing more.
const batches: SampleBatch[] = [
  {
    samples: [
      { tNs: 1000000000, r: 0.61, g: 0.11, b: 0.05 },
      { tNs: 1016666667, r: 0.62, g: 0.12, b: 0.06 },
    ],
    stats: [
      { tNs: 1000000000, spatialStdR: 0.02, clipFrac: 0, exposureNs: 8000000 },
      { tNs: 1016666667, spatialStdR: 0.03, clipFrac: 0.01, exposureNs: 8000000 },
    ],
  },
];

// Starting a Node child process is the slow step: it took over 5 s with the whole mobile suite running in
// parallel, so one receiver serves every test and only its startup gets the longer limit.
const RECEIVER_START_MS = 30000;

const stubbedFetch = globalThis.fetch;
let captureDir: string;
let port: number;
let receiver: Child | undefined;
beforeAll(async () => {
  captureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-receiver-'));
  port = await freePort();
  receiver = await startReceiver(port, captureDir);
}, RECEIVER_START_MS);
afterAll(() => {
  receiver?.kill();
  fs.rmSync(captureDir, { recursive: true, force: true });
});
beforeEach(() => {
  globalThis.fetch = nodeFetch as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = stubbedFetch;
});

test('a body from the Lab builder becomes samples.csv, stats.csv, and meta.json on the PC', async () => {
  const body = captureRequestBody(batches, {
    appVersion: '0.1.0',
    capabilities: {
      platform: 'ios',
      modelId: 'iPhone17,3',
      osVersion: '26.0',
      rearLenses: [],
      torch: { available: true, levels: true },
      locks: { exposure: true, whiteBalance: true, focus: true },
    },
    summary: { startedNs: 1000000000, stoppedNs: 1016666667, lensId: 'wide', frames: 2, dropped: 0 },
  });

  const folder = await sendCapture(`127.0.0.1:${port}`, TOKEN, body);

  expect(folder).toMatch(/^\d{8}-\d{6}-iphone173$/);
  const read = (name: string) => fs.readFileSync(path.join(captureDir, folder, name), 'utf8');
  expect(read('samples.csv')).toBe('t_ns,r,g,b\n1000000000,0.61,0.11,0.05\n1016666667,0.62,0.12,0.06\n');
  expect(read('stats.csv')).toBe(
    't_ns,spatial_std_r,clip_frac,exposure_ns\n1000000000,0.02,0,8000000\n1016666667,0.03,0.01,8000000\n',
  );
  expect(JSON.parse(read('meta.json'))).toEqual(body.meta);
});

test('the receiver refuses a wrong token and the sender reports it', async () => {
  const body = captureRequestBody(batches, {
    capabilities: {
      platform: 'android',
      modelId: 'emulator',
      osVersion: '16',
      rearLenses: [],
      torch: { available: false, levels: false },
      locks: { exposure: false, whiteBalance: false, focus: false },
    },
    summary: { startedNs: 0, stoppedNs: 0, frames: 2, dropped: 0 },
  });
  await expect(sendCapture(`127.0.0.1:${port}`, 'wrong', body)).rejects.toThrow(
    'receiver answered 401: bad token',
  );
});
