import { DeviceConnection, knownDevices, LogEntry, pickDevice, WrongPasswordError } from './ble/connection';
import { findDevice, SavedDevice, updateDevice, upsertDevice } from './store';
import { promptDialog } from './ui/dom';

/** The one live connection (the app controls one blind at a time). */
let current: DeviceConnection | null = null;
let currentSavedId: string | null = null;
const logBuffer: LogEntry[] = [];
const logListeners = new Set<(e: LogEntry) => void>();

export function getConnection(savedId?: string): DeviceConnection | null {
  if (!current || !current.connected) return null;
  if (savedId && savedId !== currentSavedId) return null;
  return current;
}

export function getLog(): LogEntry[] {
  return logBuffer;
}

export function onLog(fn: (e: LogEntry) => void): () => void {
  logListeners.add(fn);
  return () => logListeners.delete(fn);
}

function pushLog(e: LogEntry) {
  logBuffer.push(e);
  if (logBuffer.length > 300) logBuffer.shift();
  logListeners.forEach((fn) => fn(e));
}

async function askPassword(message?: string): Promise<number | null> {
  const v = await promptDialog({
    title: 'Blind password',
    message: message ?? 'Enter the numeric password set on this blind (up to 4 digits).',
    label: 'Password',
    inputmode: 'numeric',
    pattern: '[0-9]{1,4}',
    maxlength: 4,
    confirm: 'Connect',
  });
  return v === null ? null : Number(v);
}

async function openConnection(device: BluetoothDevice): Promise<DeviceConnection> {
  let conn = current;
  if (!conn || conn.device !== device) {
    current?.dispose();
    conn = new DeviceConnection(device);
    conn.on('log', pushLog);
    current = conn;
  }
  if (!conn.connected) await conn.connect();
  return conn;
}

/** Log in, asking for the password until it works or the user cancels. */
async function loginLoop(conn: DeviceConnection, initial: number | null): Promise<number | null> {
  let pw = initial ?? (await askPassword());
  let message: string | undefined;
  while (pw !== null) {
    try {
      await conn.login(pw);
      return pw;
    } catch (e) {
      if (!(e instanceof WrongPasswordError)) throw e;
      message = 'That password was not accepted. Try again.';
      pw = await askPassword(message);
    }
  }
  return null;
}

/** "Add a blind": open the picker for any blind, log in, save it. */
export async function addDevice(): Promise<SavedDevice | null> {
  const device = await pickDevice();
  const existing = findDevice(device.id, device.name);
  const conn = await openConnection(device);
  const pw = await loginLoop(conn, null);
  if (pw === null) {
    conn.disconnect();
    return null;
  }
  const saved: SavedDevice = {
    id: device.id,
    name: device.name ?? 'Blind',
    label: existing?.label ?? device.name ?? 'Blind',
    password: pw,
    lastSeen: Date.now(),
    settings: conn.state.settings,
  };
  upsertDevice(saved);
  currentSavedId = saved.id;
  return saved;
}

/** Reconnect to a saved blind. Must be called from a tap (the picker needs a user gesture). */
export async function connectSaved(saved: SavedDevice): Promise<DeviceConnection | null> {
  const live = getConnection(saved.id);
  if (live) return live;

  let device = (await knownDevices()).find((d) => d.id === saved.id);
  if (!device) device = await pickDevice(saved.name || undefined);

  const conn = await openConnection(device);
  const pw = await loginLoop(conn, saved.password);
  if (pw === null) {
    conn.disconnect();
    return null;
  }
  // device.id can differ across browsers; keep the record keyed to what this browser reports.
  const patch = { password: pw, lastSeen: Date.now(), settings: conn.state.settings };
  if (device.id !== saved.id) {
    upsertDevice({ ...saved, ...patch, id: device.id });
    currentSavedId = device.id;
  } else {
    updateDevice(saved.id, patch);
    currentSavedId = saved.id;
  }
  return conn;
}

export function currentSavedDeviceId(): string | null {
  return current?.connected ? currentSavedId : null;
}

export function disconnectCurrent(): void {
  current?.disconnect();
}
