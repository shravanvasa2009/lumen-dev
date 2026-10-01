import type { CaptureRequestBody } from './captureRequest';
import { sendCapture } from './sendCapture';

const body: CaptureRequestBody = {
  meta: { platform: 'android', modelId: 'sdk_gphone64_x86_64', os: '16', mode: 'full' },
  samples: { tNs: [1, 2], r: [0.5, 0.5], g: [0.1, 0.1], b: [0.1, 0.1] },
  stats: { tNs: [], spatialStdR: [], clipFrac: [], exposureNs: [] },
};

const realFetch = globalThis.fetch;
afterEach(() => {
  jest.useRealTimers();
  globalThis.fetch = realFetch;
});

function receiverReplies(status: number, reply: string) {
  const fetchMock = jest.fn(async () => ({ status, text: async () => reply }) as unknown as Response);
  globalThis.fetch = fetchMock;
  return fetchMock;
}

test('posts the body with the token header and returns the folder the receiver created', async () => {
  const fetchMock = receiverReplies(201, JSON.stringify({ folder: '20261004-153012-sdkgphone64x8664' }));
  await expect(sendCapture('10.0.2.2:8787', 'abc123', body)).resolves.toBe(
    '20261004-153012-sdkgphone64x8664',
  );
  expect(fetchMock).toHaveBeenCalledWith('http://10.0.2.2:8787/capture', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-lumen-token': 'abc123' },
    body: JSON.stringify(body),
    signal: expect.objectContaining({ aborted: false }),
  });
});

test('keeps an address that already names the scheme', async () => {
  const fetchMock = receiverReplies(201, JSON.stringify({ folder: 'f' }));
  await sendCapture('http://192.168.1.20:8787/', 't', body);
  expect(fetchMock).toHaveBeenCalledWith('http://192.168.1.20:8787/capture', expect.anything());
});

test('rejects with the status and the receiver message when the token is wrong', async () => {
  receiverReplies(401, 'bad token');
  await expect(sendCapture('10.0.2.2:8787', 'wrong', body)).rejects.toThrow(
    'receiver answered 401: bad token',
  );
});

test('rejects when the receiver refuses the capture', async () => {
  receiverReplies(400, 'samples arrays are missing or have different lengths');
  await expect(sendCapture('10.0.2.2:8787', 't', body)).rejects.toThrow(
    'receiver answered 400: samples arrays are missing or have different lengths',
  );
});

test('rejects a 201 reply that names no folder', async () => {
  receiverReplies(201, '{}');
  await expect(sendCapture('10.0.2.2:8787', 't', body)).rejects.toThrow('201 without a folder name');
});

test('passes a network failure through to the caller', async () => {
  globalThis.fetch = jest.fn(async () => {
    throw new TypeError('Network request failed');
  });
  await expect(sendCapture('10.0.2.2:8787', 't', body)).rejects.toThrow('Network request failed');
});

test('gives up with a clear message when the receiver never answers', async () => {
  jest.useFakeTimers();
  globalThis.fetch = jest.fn(
    (_url: string, init: { signal: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) =>
        init.signal.addEventListener('abort', () => reject(new Error('Aborted'))),
      ),
  ) as unknown as typeof fetch;
  const sent = sendCapture('192.168.1.99:8787', 't', body);
  jest.advanceTimersByTime(30_000);
  await expect(sent).rejects.toThrow('no reply from the receiver within 30 s');
});
