import { buildAck, Frame, FrameParser, STATUS_OK, toHex } from '../protocol/frame';
import * as C from '../protocol/commands';
import * as D from '../protocol/decode';
import { createMockDevice, isDemo } from './mock';

// Full 128-bit strings, not the 0xFE50 shorthand: Bluefy (iOS) fails to parse numeric UUIDs
// ("RequestDevice, request payload could not be parsed").
export const SERVICE_UUID = '0000fe50-0000-1000-8000-00805f9b34fb';
export const CHAR_UUID = '0000fe51-0000-1000-8000-00805f9b34fb';

const CHUNK = 20;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type LogDir = 'tx' | 'rx' | 'info' | 'error';
export interface LogEntry {
  at: Date;
  dir: LogDir;
  text: string;
}

export interface DeviceState {
  settings: D.DeviceSettings | null;
  timers: C.Timer[];
  seasons: { summer: C.Season; winter: C.Season } | null;
  position: number | null;
  battery: number | null;
  light: { hasSensor: boolean; level: number } | null;
}

type Events = {
  state: DeviceState;
  frame: Frame;
  log: LogEntry;
  disconnected: void;
  fault: Frame;
};
type Listener<K extends keyof Events> = (v: Events[K]) => void;

export class WrongPasswordError extends Error {
  constructor() {
    super('Wrong password');
  }
}

let demoDevice: BluetoothDevice | null = null;
const demo = () => (demoDevice ??= createMockDevice());

export function bluetoothAvailable(): boolean {
  if (isDemo()) return true;
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

/** Opens the browser device picker. Pass a name to narrow the picker to one saved blind. */
export async function pickDevice(name?: string): Promise<BluetoothDevice> {
  if (isDemo()) return demo();
  const filter: BluetoothLEScanFilter = name ? { services: [SERVICE_UUID], name } : { services: [SERVICE_UUID] };
  try {
    // The filter's service is already accessible, so no optionalServices (keeps the payload minimal).
    return await navigator.bluetooth.requestDevice({ filters: [filter] });
  } catch (e) {
    // Some Bluefy versions reject filter payloads they can't parse; fall back to an unfiltered chooser.
    if (e instanceof Error && /pars/i.test(e.message)) {
      return navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [SERVICE_UUID] });
    }
    // Chrome throws NotFoundError both for "user cancelled" and, without showing a chooser,
    // for "Bluetooth adapter not available" (off, or the OS denied the browser access).
    if (e instanceof DOMException && e.name === 'NotFoundError' && !/cancel/i.test(e.message)) {
      const available = await navigator.bluetooth.getAvailability?.().catch(() => true);
      throw new BluetoothUnavailableError(e.message, available === false);
    }
    throw e;
  }
}

export class BluetoothUnavailableError extends Error {
  constructor(
    readonly detail: string,
    readonly adapterOff: boolean,
  ) {
    super(
      adapterOff
        ? 'Bluetooth is off, or this browser isn’t allowed to use it. Turn Bluetooth on and allow the browser in your system’s Bluetooth privacy settings.'
        : `The browser couldn’t open the Bluetooth chooser: ${detail}`,
    );
  }
}

/** Previously-permitted devices, where the browser supports it (Chrome). Bluefy may not. */
export async function knownDevices(): Promise<BluetoothDevice[]> {
  if (isDemo()) return [demo()];
  const bt = navigator.bluetooth as Bluetooth & { getDevices?: () => Promise<BluetoothDevice[]> };
  if (typeof bt.getDevices !== 'function') return [];
  try {
    return await bt.getDevices();
  } catch {
    return [];
  }
}

interface Waiter {
  match: (f: Frame) => boolean;
  resolve: (f: Frame) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class DeviceConnection {
  readonly state: DeviceState = {
    settings: null,
    timers: [],
    seasons: null,
    position: null,
    battery: null,
    light: null,
  };

  private char: BluetoothRemoteGATTCharacteristic | null = null;
  private parser = new FrameParser();
  private queue: Promise<unknown> = Promise.resolve();
  private waiters = new Set<Waiter>();
  private listeners = new Map<keyof Events, Set<(v: never) => void>>();
  private useWithoutResponse = false;

  constructor(readonly device: BluetoothDevice) {
    device.addEventListener('gattserverdisconnected', this.onDisconnected);
  }

  get connected(): boolean {
    return !!this.device.gatt?.connected && !!this.char;
  }

  on<K extends keyof Events>(event: K, fn: Listener<K>): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(fn as (v: never) => void);
    return () => set.delete(fn as (v: never) => void);
  }

  private emit<K extends keyof Events>(event: K, v: Events[K]) {
    (this.listeners.get(event) as Set<Listener<K>> | undefined)?.forEach((fn) => fn(v));
  }

  private log(dir: LogDir, text: string) {
    this.emit('log', { at: new Date(), dir, text });
  }

  async connect(): Promise<void> {
    const gatt = this.device.gatt;
    if (!gatt) throw new Error('Device has no GATT server');
    this.log('info', `Connecting to ${this.device.name ?? this.device.id}…`);
    const server = await gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    const char = await service.getCharacteristic(CHAR_UUID);
    this.useWithoutResponse = !char.properties.write && char.properties.writeWithoutResponse;
    char.addEventListener('characteristicvaluechanged', this.onNotify);
    await char.startNotifications();
    this.char = char;
    this.parser.reset();
    this.log('info', 'Connected, notifications on');
  }

  /**
   * Session handshake, mirroring BluetoothService / MyBleConnectCallbackImpl:
   * password (17) → find-all (A7 01) → wait for A9 → ack A7 → send time (14).
   */
  async login(password: number): Promise<void> {
    const reply = await this.request(C.encodePassword(password), C.T.PASSWORD, 5000);
    if (!D.isOk(reply)) throw new WrongPasswordError();
    await sleep(100);
    const seasons = this.waitFor((f) => f.type === C.T.FIND_SEASONS, 8000);
    await this.write(C.encodeFindAll());
    await seasons;
    await this.write(buildAck(C.T.FIND_ALL));
    await sleep(100);
    await this.write(C.encodeTime(new Date()));
    this.write(C.encodeFindBattery()).catch(() => {});
  }

  disconnect(): void {
    this.device.gatt?.disconnect();
  }

  // ---- commands -------------------------------------------------------------

  /** Open/close/stop. Retries on a non-OK 0A reply (the original retried up to 4 times). */
  async control(action: C.ControlAction): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const r = await this.request(C.encodeControl(action), C.T.CONTROL, 1500);
        if (D.isOk(r)) return;
      } catch (e) {
        if (attempt === 3) throw e;
      }
    }
    throw new Error(`Device rejected ${action.toLowerCase()}`);
  }

  async moveTo(percent: number): Promise<void> {
    await this.write(C.encodePercent(percent));
  }

  async refresh(): Promise<void> {
    await this.write(C.encodeFindAll());
  }

  async refreshBattery(): Promise<void> {
    await this.write(C.encodeFindBattery());
  }

  async queryLight(): Promise<{ hasSensor: boolean; level: number } | null> {
    const r = await this.request(C.encodeFindLight(), C.T.LIGHT, 3000);
    return D.decodeLight(r);
  }

  async writeSettings(s: C.WritableSettings): Promise<void> {
    await this.expectOk(C.encodeSettings(s), C.T.SETTINGS);
  }

  async rename(name: string): Promise<void> {
    await this.expectOk(C.encodeName(name), C.T.RENAME);
  }

  /** The original app never waited for a reply to 0x18, so we don't either. */
  async changePassword(pw: number): Promise<void> {
    await this.write(C.encodePasswordChange(pw));
  }

  async setTimer(t: C.Timer): Promise<void> {
    await this.expectOk(C.encodeTimer(t), C.T.TIMER);
  }

  /** Delete replies are odd in the original (A5 triggered a refresh); treat any reply as done. */
  async deleteTimer(slot: number): Promise<void> {
    await this.request(C.encodeTimerDelete(slot), C.T.TIMER, 3000).catch(() => null);
    await this.refresh();
  }

  async setSeason(s: C.Season): Promise<void> {
    const err = C.validateSeason(s);
    if (err) throw new Error(err);
    await this.expectOk(C.encodeSeason(s), C.T.SEASON);
  }

  /** Returns the limit reply status byte (see D.LimitReply). */
  async limit(frame: Uint8Array, timeout = 5000): Promise<number> {
    const r = await this.request(frame, C.T.LIMIT, timeout);
    return r.payload[0];
  }

  // ---- plumbing -------------------------------------------------------------

  private async expectOk(frame: Uint8Array, type: number): Promise<void> {
    const r = await this.request(frame, type, 4000);
    if (!D.isOk(r)) throw new Error('Device rejected the change');
  }

  /** Writes a frame and resolves with the first notify of `replyType`. */
  async request(frame: Uint8Array, replyType: number, timeout = 3000): Promise<Frame> {
    const p = this.waitFor((f) => f.type === replyType, timeout);
    try {
      await this.write(frame);
    } catch (e) {
      p.catch(() => {});
      throw e;
    }
    return p;
  }

  waitFor(match: (f: Frame) => boolean, timeout: number): Promise<Frame> {
    return new Promise((resolve, reject) => {
      const w: Waiter = {
        match,
        resolve: (f) => {
          clearTimeout(w.timer);
          this.waiters.delete(w);
          resolve(f);
        },
        reject: (e) => {
          clearTimeout(w.timer);
          this.waiters.delete(w);
          reject(e);
        },
        timer: setTimeout(() => w.reject(new Error('Device did not respond')), timeout),
      };
      this.waiters.add(w);
    });
  }

  /** Serialized write; frames longer than 20 bytes are split like FastBle did. */
  write(frame: Uint8Array): Promise<void> {
    const run = async () => {
      const char = this.char;
      if (!char) throw new Error('Not connected');
      this.log('tx', toHex(frame));
      for (let i = 0; i < frame.length; i += CHUNK) {
        const chunk = new Uint8Array(frame.subarray(i, i + CHUNK)) as Uint8Array<ArrayBuffer>;
        await this.writeChunk(char, chunk);
      }
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => {});
    return next;
  }

  private async writeChunk(char: BluetoothRemoteGATTCharacteristic, chunk: Uint8Array<ArrayBuffer>) {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (this.useWithoutResponse) await char.writeValueWithoutResponse(chunk);
        else if (typeof char.writeValueWithResponse === 'function') await char.writeValueWithResponse(chunk);
        else await char.writeValue(chunk);
        return;
      } catch (e) {
        lastErr = e;
        if (!this.useWithoutResponse && char.properties.writeWithoutResponse) this.useWithoutResponse = true;
        await sleep(300);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  private onNotify = (ev: Event) => {
    const value = (ev.target as BluetoothRemoteGATTCharacteristic).value;
    if (!value) return;
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    for (const f of this.parser.push(bytes)) this.handleFrame(f);
  };

  private handleFrame(f: Frame) {
    this.log('rx', toHex(f.raw));
    const s = this.state;
    let changed = true;
    switch (f.type) {
      case C.T.MOVE: {
        const pos = D.decodePosition(f);
        if (pos !== null) s.position = pos;
        break;
      }
      case C.T.BATTERY:
        if (f.payload.length > 1) s.battery = D.decodeBattery(f);
        break;
      case C.T.SPEED: {
        const sp = D.decodeSpeed(f);
        if (sp && s.settings) Object.assign(s.settings, sp);
        break;
      }
      case C.T.FIND_ALL: {
        const st = D.decodeSettings(f);
        if (st) {
          s.settings = st;
          if (st.position !== null) s.position = st.position;
        }
        break;
      }
      case C.T.FIND_TIMERS:
        s.timers = D.decodeTimers(f);
        break;
      case C.T.FIND_SEASONS:
        s.seasons = D.decodeSeasons(f);
        break;
      case C.T.LIGHT:
        s.light = D.decodeLight(f);
        break;
      case C.T.FAULT:
        this.emit('fault', f);
        changed = false;
        break;
      default:
        changed = false;
    }

    // The app acked every A1/A2/A3/A6 notify with <type> 01 5A 31.
    if (f.type === C.T.MOVE || f.type === C.T.BATTERY || f.type === C.T.SPEED || f.type === C.T.FAULT) {
      // Only ack device-originated notifies, not echoes of our own ack.
      if (!(f.payload.length === 1 && f.payload[0] === STATUS_OK)) this.write(buildAck(f.type)).catch(() => {});
    }

    for (const w of [...this.waiters]) if (w.match(f)) w.resolve(f);
    this.emit('frame', f);
    if (changed) this.emit('state', s);
  }

  private onDisconnected = () => {
    this.char = null;
    this.log('info', 'Disconnected');
    for (const w of [...this.waiters]) w.reject(new Error('Disconnected'));
    this.emit('disconnected', undefined);
  };

  dispose(): void {
    this.device.removeEventListener('gattserverdisconnected', this.onDisconnected);
    this.disconnect();
  }
}
