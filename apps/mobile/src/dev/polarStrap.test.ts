import { PermissionsAndroid, Platform } from 'react-native';

import { connectStrap } from './polarStrap';

// SYNTHETIC: a fake ble-plx manager and strap. Packets follow the 0x2A37 byte layout and are not recordings.
// 0x16 = RR present, contact supported and detected; HR 75 (uint8); RR 0x0333 = 819/1024 s.
const PACKET_75_BPM = 'FkszAw==';
// Flags say RR present but the RR field has an odd length (one byte).
const PACKET_ODD_RR = 'EEsz';
const HEART_RATE_SERVICE = '0000180d-0000-1000-8000-00805f9b34fb';
const HEART_RATE_MEASUREMENT = '00002a37-0000-1000-8000-00805f9b34fb';

interface FakeBleError {
  message: string;
  errorCode?: number;
}

type Listener<T> = (error: FakeBleError | null, value: T | null) => void;

interface FakeDevice {
  id: string;
  name: string;
  localName: null;
  discoverAllServicesAndCharacteristics: jest.Mock<Promise<FakeDevice>, []>;
  monitorCharacteristicForService: jest.Mock;
}

function fakeBle({ state = 'PoweredOn', advertises = true } = {}) {
  const listeners: {
    monitor?: Listener<{ value: string | null }>;
    dropped?: Listener<FakeDevice>;
  } = {};
  const device: FakeDevice = {
    id: 'AA:BB',
    name: 'Polar H10 1234ABCD',
    localName: null,
    discoverAllServicesAndCharacteristics: jest.fn(async () => device),
    monitorCharacteristicForService: jest.fn(
      (_service: string, _characteristic: string, listener: Listener<{ value: string | null }>) => {
        listeners.monitor = listener;
        return { remove: jest.fn() };
      },
    ),
  };
  const manager = {
    onStateChange: jest.fn((listener: (bleState: string) => void) => {
      Promise.resolve().then(() => listener(state));
      return { remove: jest.fn() };
    }),
    startDeviceScan: jest.fn(async (_uuids: string[], _options: null, listener: Listener<FakeDevice>) => {
      if (advertises) Promise.resolve().then(() => listener(null, device));
    }),
    stopDeviceScan: jest.fn(async () => undefined),
    connectToDevice: jest.fn(async () => device),
    cancelDeviceConnection: jest.fn(async () => device),
    onDeviceDisconnected: jest.fn((_id: string, listener: Listener<FakeDevice>) => {
      listeners.dropped = listener;
      return { remove: jest.fn() };
    }),
  };
  mockManager = manager;
  return {
    device,
    manager,
    monitor: (error: FakeBleError | null, value: { value: string | null } | null) =>
      listeners.monitor?.(error, value),
    drop: () => listeners.dropped?.(null, device),
  };
}

let mockManager: unknown;
jest.mock('react-native-ble-plx', () => ({
  BleManager: jest.fn(() => mockManager),
  State: { Unknown: 'Unknown', Resetting: 'Resetting', PoweredOn: 'PoweredOn', PoweredOff: 'PoweredOff' },
  // ble-plx 3.5.1 src/BleError.js: DeviceDisconnected is 201.
  BleErrorCode: { DeviceDisconnected: 201 },
}));

const events = () => ({ onMeasurement: jest.fn(), onLost: jest.fn() });

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('connects to the first strap advertising the Heart Rate service and reports parsed packets', async () => {
  const fake = fakeBle();
  const strapEvents = events();
  const connection = await connectStrap(strapEvents);

  expect(connection.name).toBe('Polar H10 1234ABCD');
  expect(fake.manager.startDeviceScan).toHaveBeenCalledWith([HEART_RATE_SERVICE], null, expect.any(Function));
  expect(fake.manager.stopDeviceScan).toHaveBeenCalled();
  expect(fake.device.monitorCharacteristicForService).toHaveBeenCalledWith(
    HEART_RATE_SERVICE,
    HEART_RATE_MEASUREMENT,
    expect.any(Function),
  );
  fake.monitor(null, { value: PACKET_75_BPM });
  expect(strapEvents.onMeasurement).toHaveBeenCalledWith({
    bpm: 75,
    contact: 'detected',
    rrMs: [(819 / 1024) * 1000],
  });
});

test('refuses when Bluetooth is off, before scanning', async () => {
  const fake = fakeBle({ state: 'PoweredOff' });
  await expect(connectStrap(events())).rejects.toThrow('Bluetooth is PoweredOff');
  expect(fake.manager.startDeviceScan).not.toHaveBeenCalled();
});

test('gives up after 15 s without a strap and stops the scan', async () => {
  jest.useFakeTimers();
  const fake = fakeBle({ advertises: false });
  const connecting = connectStrap(events());
  const outcome = expect(connecting).rejects.toThrow(/no heart-rate strap found within 15 s/);
  await jest.advanceTimersByTimeAsync(15_000);
  await outcome;
  expect(fake.manager.stopDeviceScan).toHaveBeenCalled();
});

test('drops the connection and says why when a packet cannot be read', async () => {
  const fake = fakeBle();
  const strapEvents = events();
  await connectStrap(strapEvents);

  fake.monitor(null, { value: PACKET_ODD_RR });
  expect(strapEvents.onLost).toHaveBeenCalledWith(expect.stringMatching(/odd length/));
  expect(fake.manager.cancelDeviceConnection).toHaveBeenCalledWith('AA:BB');
  expect(strapEvents.onMeasurement).not.toHaveBeenCalled();
});

test('reports a strap that walks away without trying to disconnect it again', async () => {
  const fake = fakeBle();
  const strapEvents = events();
  await connectStrap(strapEvents);

  fake.drop();
  expect(strapEvents.onLost).toHaveBeenCalledWith('the strap disconnected');
  expect(fake.manager.cancelDeviceConnection).not.toHaveBeenCalled();
});

test('a monitor that fails because the strap left reports once and does not disconnect it again', async () => {
  const fake = fakeBle();
  const strapEvents = events();
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  await connectStrap(strapEvents);

  fake.monitor({ message: 'Device AA:BB was disconnected', errorCode: 201 }, null);
  fake.drop();
  expect(strapEvents.onLost).toHaveBeenCalledTimes(1);
  expect(strapEvents.onLost).toHaveBeenCalledWith('Device AA:BB was disconnected');
  expect(fake.manager.cancelDeviceConnection).not.toHaveBeenCalled();
  expect(warn).not.toHaveBeenCalled();
});

test('disconnect() closes the link and a later monitor error is not reported as a loss', async () => {
  const fake = fakeBle();
  const strapEvents = events();
  const connection = await connectStrap(strapEvents);

  await connection.disconnect();
  fake.monitor({ message: 'Operation was cancelled' }, null);
  expect(fake.manager.cancelDeviceConnection).toHaveBeenCalledWith('AA:BB');
  expect(strapEvents.onLost).not.toHaveBeenCalled();
});

test('on Android 12+ asks for scan and connect, and stops if either is refused', async () => {
  const fake = fakeBle();
  jest.replaceProperty(Platform, 'OS', 'android');
  jest.spyOn(Platform, 'Version', 'get').mockReturnValue(31);
  const request = jest.spyOn(PermissionsAndroid, 'requestMultiple').mockResolvedValue({
    [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN]: PermissionsAndroid.RESULTS.GRANTED,
    [PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]: PermissionsAndroid.RESULTS.DENIED,
  } as Awaited<ReturnType<typeof PermissionsAndroid.requestMultiple>>);

  await expect(connectStrap(events())).rejects.toThrow(
    `Bluetooth permission refused: ${PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT}`,
  );
  expect(request).toHaveBeenCalledWith([
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
  ]);
  expect(fake.manager.startDeviceScan).not.toHaveBeenCalled();
});
