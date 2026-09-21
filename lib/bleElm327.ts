import { BleManager, Characteristic, Device, ScanMode, Subscription } from "react-native-ble-plx";

export type BleAdapter = {
  id: string;
  name: string;
  rssi: number | null;
  device: Device;
};

export type Elm327CanSample = {
  capturedAt: string;
  packVoltageV: number | null;
  batteryTemperatureC: number | null;
  adapterVoltageV: number | null;
  moduleTemperaturesC: number[];
  rawResponses: Record<string, string>;
  supportedPids: string[];
  unsupportedPids: string[];
};

export type Elm327DtcResult = {
  acknowledged: boolean;
  response: string;
  message: string;
};

const manager = new BleManager();
const ELM_HINTS = ["elm", "obd", "obdlink", "vgate", "icar", "konnwei", "viecar", "canable"];

let activeTransport: {
  device: Device;
  writeCharacteristic: Characteristic;
  notifyCharacteristic: Characteristic | null;
  monitorSubscription: Subscription | null;
  responseBuffer: string;
  pending: { resolve: (value: string) => void; reject: (reason: Error) => void } | null;
} | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let pollCancelled = false;
let commandQueue = Promise.resolve();

function adapterName(device: Device) {
  return device.name || device.localName || "Unnamed BLE adapter";
}

function looksLikeVehicleAdapter(device: Device) {
  const name = adapterName(device).toLowerCase();
  return ELM_HINTS.some((hint) => name.includes(hint));
}

function encodeBase64(value: string) {
  return globalThis.btoa(value);
}

function decodeBase64(value: string) {
  return globalThis.atob(value);
}

function normaliseResponse(value: string) {
  return value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

function finishPending(value: string) {
  const pending = activeTransport?.pending;
  if (!pending) return;
  activeTransport!.pending = null;
  pending.resolve(normaliseResponse(value));
}

function handleIncomingCharacteristic(characteristic: Characteristic | null, error?: Error | null) {
  if (error) {
    const pending = activeTransport?.pending;
    if (pending) {
      activeTransport!.pending = null;
      pending.reject(error);
    }
    return;
  }
  if (!characteristic?.value || !activeTransport) return;
  activeTransport.responseBuffer += decodeBase64(characteristic.value);
  const response = activeTransport.responseBuffer;
  if (response.includes(">")) {
    activeTransport.responseBuffer = "";
    finishPending(response.replace(/>/g, ""));
  } else if (/NO DATA|ERROR|UNABLE TO CONNECT|STOPPED|\?/.test(response.toUpperCase())) {
    activeTransport.responseBuffer = "";
    finishPending(response);
  }
}

async function chooseTransport(device: Device) {
  const services = await device.services();
  const allCharacteristics: Characteristic[] = [];
  for (const service of services) {
    allCharacteristics.push(...(await device.characteristicsForService(service.uuid)));
  }

  const writeCharacteristic =
    allCharacteristics.find((item) => item.isWritableWithResponse) ||
    allCharacteristics.find((item) => item.isWritableWithoutResponse);
  const notifyCharacteristic =
    allCharacteristics.find((item) => item.isNotifiable || item.isIndicatable) ||
    allCharacteristics.find((item) => item.isReadable) ||
    null;

  if (!writeCharacteristic) {
    throw new Error("The adapter connected, but no writable BLE characteristic was discovered.");
  }

  activeTransport = {
    device,
    writeCharacteristic,
    notifyCharacteristic,
    monitorSubscription: null,
    responseBuffer: "",
    pending: null,
  };

  if (notifyCharacteristic && (notifyCharacteristic.isNotifiable || notifyCharacteristic.isIndicatable)) {
    activeTransport.monitorSubscription = device.monitorCharacteristicForService(
      notifyCharacteristic.serviceUUID,
      notifyCharacteristic.uuid,
      (error, characteristic) => handleIncomingCharacteristic(characteristic, error),
    );
  }
}

async function sendCommandInternal(command: string, timeoutMs = 3000): Promise<string> {
  if (!activeTransport) throw new Error("No ELM327 adapter is connected.");
  const transport = activeTransport;
  const payload = encodeBase64(`${command.trim()}\r`);

  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (transport.pending?.resolve === resolve) {
        transport.pending = null;
        reject(new Error(`ELM327 command timed out: ${command}`));
      }
    }, timeoutMs);

    transport.pending = {
      resolve: (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    };

    const writePromise = transport.writeCharacteristic.isWritableWithResponse
      ? transport.writeCharacteristic.writeWithResponse(payload)
      : transport.writeCharacteristic.writeWithoutResponse(payload);

    writePromise.catch((error) => {
      clearTimeout(timeout);
      transport.pending = null;
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

export function sendElm327Command(command: string, timeoutMs = 3000) {
  const next = commandQueue.then(() => sendCommandInternal(command, timeoutMs));
  commandQueue = next.then(() => undefined, () => undefined);
  return next;
}

function parsePidBytes(response: string, pid: string) {
  const clean = response.toUpperCase().replace(/[^0-9A-F]/g, "");
  const marker = `41${pid.toUpperCase()}`;
  const index = clean.indexOf(marker);
  if (index < 0 || clean.length < index + marker.length + 2) return null;
  const byteA = Number.parseInt(clean.slice(index + marker.length, index + marker.length + 2), 16);
  const byteB = Number.parseInt(clean.slice(index + marker.length + 2, index + marker.length + 4), 16);
  if (!Number.isFinite(byteA) || !Number.isFinite(byteB)) return null;
  return { byteA, byteB };
}

function parsePid42Voltage(response: string) {
  const bytes = parsePidBytes(response, "42");
  return bytes ? (bytes.byteA * 256 + bytes.byteB) / 1000 : null;
}

function parsePid5cTemperature(response: string) {
  const bytes = parsePidBytes(response, "5C");
  return bytes ? bytes.byteA - 40 : null;
}

function parseAdapterVoltage(response: string) {
  const match = response.match(/(-?\d+(?:\.\d+)?)\s*V/i);
  return match ? Number(match[1]) : null;
}

export async function pollElm327CanTelemetry(): Promise<Elm327CanSample> {
  const rawResponses: Record<string, string> = {};
  const supportedPids: string[] = [];
  const unsupportedPids: string[] = [];

  const queries = [
    { key: "0142", command: "0142", parse: parsePid42Voltage },
    { key: "015C", command: "015C", parse: parsePid5cTemperature },
    { key: "ATRV", command: "ATRV", parse: parseAdapterVoltage },
  ];

  for (const query of queries) {
    try {
      const response = await sendElm327Command(query.command, 1800);
      rawResponses[query.key] = response;
      const parsed = query.parse(response);
      if (parsed !== null && Number.isFinite(parsed)) supportedPids.push(query.key);
      else unsupportedPids.push(query.key);
    } catch {
      unsupportedPids.push(query.key);
    }
  }

  const packVoltage = rawResponses["0142"] ? parsePid42Voltage(rawResponses["0142"]) : null;
  const batteryTemperature = rawResponses["015C"] ? parsePid5cTemperature(rawResponses["015C"]) : null;
  const adapterVoltage = rawResponses.ATRV ? parseAdapterVoltage(rawResponses.ATRV) : null;

  return {
    capturedAt: new Date().toISOString(),
    packVoltageV: packVoltage,
    batteryTemperatureC: batteryTemperature,
    adapterVoltageV: adapterVoltage,
    // Generic OBD-II does not define a universal 96-cell/module-temperature PID.
    // OEM-specific Mode 22 mappings can be added without changing the polling UI.
    moduleTemperaturesC: [],
    rawResponses,
    supportedPids,
    unsupportedPids,
  };
}

export function startElm327Polling(
  onSample: (sample: Elm327CanSample) => void,
  onStatus: (message: string) => void,
  intervalMs = 1500,
) {
  stopElm327Polling();
  pollCancelled = false;
  const tick = async () => {
    if (pollCancelled || !activeTransport) return;
    try {
      const sample = await pollElm327CanTelemetry();
      onSample(sample);
      const available = sample.supportedPids.join(", ");
      const unavailable = sample.unsupportedPids.join(", ");
      onStatus(
        available
          ? `CAN polling active · supported: ${available}${unavailable ? ` · unavailable: ${unavailable}` : ""}`
          : "CAN polling connected, but this adapter returned no supported generic battery PIDs.",
      );
    } catch (error) {
      onStatus(`CAN polling error: ${error instanceof Error ? error.message : "Unknown adapter error"}`);
    } finally {
      if (!pollCancelled) pollTimer = setTimeout(tick, intervalMs);
    }
  };
  void tick();
}

export function stopElm327Polling() {
  pollCancelled = true;
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
}

export async function clearElm327TroubleCodes(): Promise<Elm327DtcResult> {
  const response = await sendElm327Command("04", 4000);
  const upper = response.toUpperCase();
  const acknowledged = /44\b/.test(upper) && !/ERROR|NO DATA|UNABLE|\?/.test(upper);
  return {
    acknowledged,
    response,
    message: acknowledged
      ? "The adapter acknowledged OBD-II Service 04. The vehicle may need an ignition cycle before the dashboard updates."
      : `The adapter did not confirm the clear request: ${normaliseResponse(response) || "no response"}`,
  };
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
  const discovered = await device.discoverAllServicesAndCharacteristics();
  await chooseTransport(discovered);
  // Standard ELM327 setup; failures are surfaced so the UI does not claim a live link prematurely.
  await sendElm327Command("ATZ", 5000);
  await sendElm327Command("ATE0");
  await sendElm327Command("ATL0");
  await sendElm327Command("ATS0");
  await sendElm327Command("ATSP0");
  return discovered;
}

export async function disconnectElm327(deviceId: string) {
  stopElm327Polling();
  if (activeTransport?.monitorSubscription) activeTransport.monitorSubscription.remove();
  activeTransport = null;
  try {
    await manager.cancelDeviceConnection(deviceId);
  } catch {
    // The adapter may already be disconnected.
  }
}

export function destroyBleManager() {
  stopElm327Polling();
  stopBleScan();
  if (activeTransport?.monitorSubscription) activeTransport.monitorSubscription.remove();
  activeTransport = null;
  manager.destroy();
}
