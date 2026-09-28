// Simulated blind for ?demo mode: speaks the same wire protocol so the whole app can be exercised
// without hardware. Password is 1234.
import { buildFrame, FrameParser, STATUS_FAIL, STATUS_OK } from '../protocol/frame';
import { T } from '../protocol/commands';

const PASSWORD = 1234;

export function isDemo(): boolean {
  return new URLSearchParams(location.search).has('demo');
}

export function createMockDevice(name = 'Demo blind'): BluetoothDevice {
  const target = new EventTarget();
  let connected = false;
  let loggedIn = false;
  let position = 30;
  let goal = 30;
  let motion: ReturnType<typeof setInterval> | undefined;
  let limitMode: number | null = null;
  const settings = { flags: 0b11101, speed: 28, length: 1500, diameter: 18, type: 3 };
  const timers: number[][] = [[1, 0, 0x3e, 8, 30]]; // hour byte is 1-based: 8 = 07:30
  const seasons = [0, 0, 0x11, 0x27, 0, 0, 23, 59, 1, 0, 0x10, 0x72, 8, 0, 18, 0];
  const parser = new FrameParser();

  const char = new EventTarget() as unknown as BluetoothRemoteGATTCharacteristic & { value?: DataView };
  const notify = (type: number, payload: number[]) => {
    setTimeout(() => {
      if (!connected) return;
      const frame = buildFrame(type, payload).slice(4); // devices don't send the 00FF0000 prefix (assumed)
      Object.defineProperty(char, 'value', { value: new DataView(frame.buffer), configurable: true });
      char.dispatchEvent(new Event('characteristicvaluechanged'));
    }, 60);
  };

  const moveTo = (pct: number) => {
    goal = pct;
    clearInterval(motion);
    motion = setInterval(() => {
      if (position === goal) {
        clearInterval(motion);
        return;
      }
      position += Math.sign(goal - position) * Math.min(5, Math.abs(goal - position));
      notify(T.MOVE, [0x00, position]);
    }, 250);
  };

  const sendAll = () => {
    notify(T.FIND_ALL, [
      settings.flags, settings.speed, position, settings.length >> 8, settings.length & 0xff, settings.diameter, settings.type << 4,
    ]);
    notify(T.FIND_TIMERS, timers.flat());
    notify(T.FIND_SEASONS, seasons);
  };

  const handle = (type: number, p: Uint8Array) => {
    if (type === T.PASSWORD) {
      loggedIn = ((p[0] << 8) | p[1]) === PASSWORD;
      notify(T.PASSWORD, [loggedIn ? STATUS_OK : STATUS_FAIL]);
      return;
    }
    if (!loggedIn) return;
    switch (type) {
      case T.FIND_ALL:
        if (p[0] === 0x01) sendAll();
        break;
      case T.BATTERY:
        notify(T.BATTERY, [0, 0, 0, 0, 82]);
        break;
      case T.LIGHT:
        notify(T.LIGHT, [1, 4]);
        break;
      case T.CONTROL:
        notify(T.CONTROL, [STATUS_OK]);
        if (p[0] === 0xdd) moveTo(0);
        else if (p[0] === 0xee) moveTo(100);
        else {
          clearInterval(motion);
          goal = position;
        }
        break;
      case T.PERCENT:
        moveTo(p[0]);
        break;
      case T.SETTINGS:
        settings.flags = (settings.flags & 0b11100) | ((p[0] >> 1) & 1) | (((p[0] >> 2) & 1) << 1);
        settings.type = p[0] >> 4;
        settings.speed = p[1];
        settings.length = (p[3] << 8) | p[4];
        settings.diameter = p[5];
        notify(T.SETTINGS, [STATUS_OK]);
        break;
      case T.TIMER: {
        const slot = p[0];
        if (p[1] === 1) timers.splice(slot - 1, 1);
        else timers[slot - 1] = [p[2], p[3], p[4], p[5], p[6]];
        notify(T.TIMER, [STATUS_OK]);
        break;
      }
      case T.SEASON: {
        const off = p[0] === 0 ? 0 : 8;
        seasons.splice(off, 8, ...p);
        notify(T.SEASON, [STATUS_OK]);
        break;
      }
      case T.LIMIT:
        if (p[2] === 0x01) {
          notify(T.LIMIT, [0xc5]);
        } else if (p[0] === 0x00) {
          limitMode = p[1];
          notify(T.LIMIT, [0x5a]);
        } else if (p[0] === 0x20 && limitMode !== null) {
          settings.flags |= limitMode === 1 ? 0x04 : 0x08; // edge bit 1 = top, 2 = bottom
          limitMode = null;
          notify(T.LIMIT, [0x5b]);
        } else if (p[0] === 0x40) {
          limitMode = null;
          notify(T.LIMIT, [0x5c]);
        }
        break;
      case T.RENAME:
        notify(T.RENAME, [STATUS_OK]);
        break;
    }
  };

  const write = async (data: BufferSource) => {
    if (!connected) throw new Error('GATT disconnected');
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    for (const f of parser.push(bytes)) handle(f.type, f.payload);
  };

  Object.assign(char, {
    properties: { write: true, writeWithoutResponse: false, notify: true },
    startNotifications: async () => char,
    writeValueWithResponse: write,
    writeValue: write,
  });

  const device = target as unknown as BluetoothDevice;
  const gatt = {
    get connected() {
      return connected;
    },
    connect: async () => {
      await new Promise((r) => setTimeout(r, 300));
      connected = true;
      loggedIn = false;
      return gatt;
    },
    disconnect: () => {
      if (!connected) return;
      connected = false;
      clearInterval(motion);
      target.dispatchEvent(new Event('gattserverdisconnected'));
    },
    getPrimaryService: async () => ({ getCharacteristic: async () => char }),
  };
  Object.assign(device, { id: 'demo-device', name, gatt });
  return device;
}
