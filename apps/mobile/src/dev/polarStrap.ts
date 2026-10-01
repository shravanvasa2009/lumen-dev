import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, State, type Device } from 'react-native-ble-plx';

import {
  bytesFromBase64,
  parseHeartRateMeasurement,
  type HeartRateMeasurement,
} from './heartRateMeasurement';

// Bluetooth SIG assigned numbers: Heart Rate service 0x180D and its Heart Rate Measurement characteristic
// 0x2A37, written out on the Bluetooth base UUID. Any standard strap works; the Polar H10 is the one the
// spec names (§14).
const HEART_RATE_SERVICE = '0000180d-0000-1000-8000-00805f9b34fb';
const HEART_RATE_MEASUREMENT = '00002a37-0000-1000-8000-00805f9b34fb';
// A worn H10 advertises about once a second, so 15 s means it is not worn, not charged, or held by another app.
const SCAN_TIMEOUT_MS = 15_000;
// iOS reports Unknown until its Bluetooth service answers, usually within a second.
const STATE_TIMEOUT_MS = 5_000;

export interface StrapEvents {
  onMeasurement(measurement: HeartRateMeasurement): void;
  // The strap went away or sent something unreadable; the connection is already closed when this runs.
  onLost(reason: string): void;
}

export interface StrapConnection {
  name: string;
  disconnect(): Promise<void>;
}

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

// Android 12 (API 31) and later ask for the Bluetooth permissions; older versions only scan with location
// (https://reactnative.dev/docs/0.86/permissionsandroid). iOS asks by itself on first use, with the purpose
// string from the config plugin.
async function allowBluetooth() {
  if (Platform.OS !== 'android') return;
  const needed =
    Platform.Version >= 31
      ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const answers = await PermissionsAndroid.requestMultiple(needed);
  const refused = needed.filter((permission) => answers[permission] !== PermissionsAndroid.RESULTS.GRANTED);
  if (refused.length) throw new Error(`Bluetooth permission refused: ${refused.join(', ')}`);
}

function bluetoothReady(manager: BleManager): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      watch.remove();
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(
      () => settle(new Error(`Bluetooth did not report its state within ${STATE_TIMEOUT_MS / 1000} s`)),
      STATE_TIMEOUT_MS,
    );
    const watch = manager.onStateChange((state) => {
      if (state === State.Unknown || state === State.Resetting) return;
      settle(state === State.PoweredOn ? undefined : new Error(`Bluetooth is ${state}`));
    }, true);
  });
}

function findStrap(manager: BleManager): Promise<Device> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (outcome: { device: Device } | { error: Error }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      manager
        .stopDeviceScan()
        .then(() => ('device' in outcome ? resolve(outcome.device) : reject(outcome.error)), reject);
    };
    const timer = setTimeout(
      () =>
        settle({
          error: new Error(
            `no heart-rate strap found within ${SCAN_TIMEOUT_MS / 1000} s; wet the strap, wear it, and close other apps using it`,
          ),
        }),
      SCAN_TIMEOUT_MS,
    );
    manager
      .startDeviceScan([HEART_RATE_SERVICE], null, (error, device) => {
        if (error) settle({ error });
        else if (device) settle({ device });
      })
      .catch((error: unknown) => settle({ error: new Error(reasonOf(error), { cause: error }) }));
  });
}

// Development builds only (spec §9.5, §12 Lab mode): connects to the first chest strap advertising the
// standard Heart Rate service and reports each Heart Rate Measurement notification.
export async function connectStrap({ onMeasurement, onLost }: StrapEvents): Promise<StrapConnection> {
  await allowBluetooth();
  // A singleton since ble-plx 3.4.0, so repeated connects share one native client.
  const manager = new BleManager();
  await bluetoothReady(manager);
  const found = await findStrap(manager);
  const device = await manager.connectToDevice(found.id);
  try {
    await device.discoverAllServicesAndCharacteristics();
  } catch (error) {
    await manager
      .cancelDeviceConnection(device.id)
      .catch((cancelError: unknown) => console.warn(`strap did not disconnect: ${reasonOf(cancelError)}`));
    throw error;
  }

  let closed = false;
  const close = () => {
    closed = true;
    monitor.remove();
    dropped.remove();
  };
  const lose = (reason: string, stillConnected: boolean) => {
    if (closed) return;
    close();
    if (stillConnected)
      manager
        .cancelDeviceConnection(device.id)
        .catch((error: unknown) => console.warn(`strap did not disconnect: ${reasonOf(error)}`));
    onLost(reason);
  };
  const monitor = device.monitorCharacteristicForService(
    HEART_RATE_SERVICE,
    HEART_RATE_MEASUREMENT,
    (error, characteristic) => {
      if (error) return lose(error.message, true);
      if (!characteristic?.value) return;
      let measurement: HeartRateMeasurement;
      try {
        measurement = parseHeartRateMeasurement(bytesFromBase64(characteristic.value));
      } catch (parseError) {
        return lose(reasonOf(parseError), true);
      }
      onMeasurement(measurement);
    },
  );
  const dropped = manager.onDeviceDisconnected(device.id, (error) =>
    lose(error?.message ?? 'the strap disconnected', false),
  );

  return {
    name: device.name ?? device.localName ?? device.id,
    disconnect: async () => {
      if (closed) return;
      close();
      await manager.cancelDeviceConnection(device.id);
    },
  };
}
