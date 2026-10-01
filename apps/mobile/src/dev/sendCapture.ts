import type { CaptureRequestBody } from './captureRequest';

// A wrong address or a PC on another network otherwise hangs until the OS gives up, which can take
// minutes. A 90 s capture is under 1 MB of JSON, so 30 s is ample on a home network.
const SEND_TIMEOUT_MS = 30_000;

// Development builds only (spec §13.5, PRIV-1): this is the one network call in the app, and
// scripts/priv-check.mjs fails CI if a network call appears outside src/dev/ or without this guard.
// address is what the receiver prints at startup, for example 192.168.1.20:8787.
export async function sendCapture(address: string, token: string, body: CaptureRequestBody): Promise<string> {
  if (!__DEV__) throw new Error('the capture sender exists only in development builds');
  const base = /^https?:\/\//.test(address) ? address : `http://${address}`;
  // AbortController: React Native polyfill (Libraries/Core/setUpXHR.js); both RN's fetch and expo/fetch
  // honour init.signal.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  let status: number;
  let reply: string;
  try {
    const response = await fetch(`${base.replace(/\/+$/, '')}/capture`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-lumen-token': token },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    status = response.status;
    reply = await response.text();
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error(`no reply from the receiver within ${SEND_TIMEOUT_MS / 1000} s`, { cause: error });
    throw error;
  } finally {
    clearTimeout(timer);
  }
  if (status !== 201) throw new Error(`receiver answered ${status}: ${reply}`);
  const { folder } = JSON.parse(reply) as { folder?: unknown };
  if (typeof folder !== 'string') throw new Error(`receiver answered 201 without a folder name: ${reply}`);
  return folder;
}
