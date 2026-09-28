import type { DeviceSettings } from './protocol/decode';
import { isDemo } from './ble/mock';

export interface SavedDevice {
  /** Web Bluetooth device.id (opaque, per-origin; may change on some browsers). */
  id: string;
  /** Advertised BLE name; used to narrow the picker on reconnect. */
  name: string;
  /** Friendly label shown in the list. */
  label: string;
  password: number;
  lastSeen: number;
  settings?: DeviceSettings | null;
}

const KEY = isDemo() ? 'blinds.demo.v1' : 'blinds.devices.v1';

export function loadDevices(): SavedDevice[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as SavedDevice[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function save(list: SavedDevice[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage unavailable (private mode etc.); the app still works for this session.
  }
}

export function findDevice(id: string, name?: string): SavedDevice | undefined {
  const list = loadDevices();
  return list.find((d) => d.id === id) ?? (name ? list.find((d) => d.name === name) : undefined);
}

export function upsertDevice(dev: SavedDevice): void {
  const list = loadDevices().filter((d) => d.id !== dev.id && !(d.name === dev.name && dev.name));
  list.push(dev);
  list.sort((a, b) => a.label.localeCompare(b.label));
  save(list);
}

export function updateDevice(id: string, patch: Partial<SavedDevice>): void {
  const list = loadDevices();
  const d = list.find((x) => x.id === id);
  if (!d) return;
  Object.assign(d, patch);
  save(list);
}

export function removeDevice(id: string): void {
  save(loadDevices().filter((d) => d.id !== id));
}
