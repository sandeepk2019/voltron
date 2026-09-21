import { BleManager, Device, ScanMode } from "react-native-ble-plx";

export type BleAdapter = {
  id: string;
  name: string;
  rssi: number | null;
  device: Device;
};

const manager = new BleManager();
const ELM_HINTS = ["elm", "obd", "obdlink", "vgate", "icar", "konnwei", "viecar", "canable"];

function adapterName(device: Device) {
  return device.name || device.localName || "Unnamed BLE adapter";
}

function looksLikeVehicleAdapter(device: Device) {
  const name = adapterName(device).toLowerCase();
  return ELM_HINTS.some((hint) => name.includes(hint));
}

export async function getBluetoothState() {
  return manager.state();
}

export function scanForElm327(onAdapter: (adapter: BleAdapter) => void, onError: (error: Error) => void) {
  manager.stopDeviceScan();
  manager.startDeviceScan(null, { allowDuplicates: false, scanMode: ScanMode.LowLatency }, (error, device) => {
    if (error) {
      onError(error);
      return;
    }
    if (device && looksLikeVehicleAdapter(device)) {
      onAdapter({ id: device.id, name: adapterName(device), rssi: device.rssi, device });
    }
  });
}

export function stopBleScan() {
  manager.stopDeviceScan();
}

export async function connectElm327(deviceId: string) {
  stopBleScan();
  const device = await manager.connectToDevice(deviceId, { autoConnect: false, timeout: 10000 });
  return device.discoverAllServicesAndCharacteristics();
}

export async function disconnectElm327(deviceId: string) {
  try {
    await manager.cancelDeviceConnection(deviceId);
  } catch {
    // The adapter may already be disconnected.
  }
}

export function destroyBleManager() {
  stopBleScan();
  manager.destroy();
}
