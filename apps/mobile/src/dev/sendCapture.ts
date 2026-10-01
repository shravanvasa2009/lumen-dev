import type { CaptureRequestBody } from './captureRequest';

// Development builds only (spec §13.5, PRIV-1): this is the one network call in the app, and
// scripts/priv-check.mjs fails CI if a network call appears outside src/dev/ or without this guard.
// address is what the receiver prints at startup, for example 192.168.1.20:8787.
export async function sendCapture(address: string, token: string, body: CaptureRequestBody): Promise<string> {
  if (!__DEV__) throw new Error('the capture sender exists only in development builds');
  const base = /^https?:\/\//.test(address) ? address : `http://${address}`;
  const response = await fetch(`${base.replace(/\/+$/, '')}/capture`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-lumen-token': token },
    body: JSON.stringify(body),
  });
  const reply = await response.text();
  if (response.status !== 201) throw new Error(`receiver answered ${response.status}: ${reply}`);
  const { folder } = JSON.parse(reply) as { folder?: unknown };
  if (typeof folder !== 'string') throw new Error(`receiver answered 201 without a folder name: ${reply}`);
  return folder;
}
