import { Frame, STATUS_OK } from './frame';
import { maskToDays, Season, SeasonKind, Timer, timerHourFromWire } from './commands';

export interface DeviceSettings {
  direction: boolean;
  inching: boolean;
  topLimitSet: boolean;
  bottomLimitSet: boolean;
  hasLightSensor: boolean;
  speed: number;
  /** 0..100, or null when limits are not set (0xFF). */
  position: number | null;
  length: number;
  diameter: number;
  deviceType: number;
}

const bit = (v: number, m: number) => (v & m) !== 0;

export function isOk(f: Frame): boolean {
  return f.payload[0] === STATUS_OK;
}

/** A7 find-normal readback. Note the flag layout differs from the 0x11 write layout. */
export function decodeSettings(f: Frame): DeviceSettings | null {
  const p = f.payload;
  if (p.length < 7) return null;
  return {
    direction: bit(p[0], 0x01),
    inching: bit(p[0], 0x02),
    topLimitSet: bit(p[0], 0x04),
    bottomLimitSet: bit(p[0], 0x08),
    hasLightSensor: bit(p[0], 0x10),
    speed: p[1],
    position: p[2] === 0xff ? null : p[2],
    length: (p[3] << 8) | p[4],
    diameter: p[5],
    deviceType: p[6] >> 4,
  };
}

/** A1 move notify: payload[1] = current position. */
export function decodePosition(f: Frame): number | null {
  const v = f.payload[1];
  return v === undefined || v > 100 ? null : v;
}

/** A2 battery notify: frame byte [7] = percent (payload[4]). */
export function decodeBattery(f: Frame): number | null {
  const v = f.raw[7];
  return v === undefined ? null : v;
}

/** A3 speed notify. */
export function decodeSpeed(f: Frame) {
  const p = f.payload;
  if (p.length < 2) return null;
  return {
    direction: bit(p[0], 0x02),
    inching: bit(p[0], 0x04),
    hasLightSensor: bit(p[0], 0x08),
    speed: p[1],
  };
}

/** A8 timer readback: 5 bytes per slot [enable, percent, mask, hour (1-based), minute]. */
export function decodeTimers(f: Frame): Timer[] {
  const p = f.payload;
  const out: Timer[] = [];
  for (let i = 0; i + 5 <= p.length; i += 5) {
    out.push({
      slot: i / 5 + 1,
      enabled: p[i] === 1,
      percent: p[i + 1],
      days: maskToDays(p[i + 2]),
      hour: timerHourFromWire(p[i + 3]),
      minute: p[i + 4],
    });
  }
  return out;
}

function decodeOneSeason(p: Uint8Array, off: number, kind: SeasonKind): Season {
  return {
    kind,
    enabled: p[off + 1] === 1,
    openByLight: bit(p[off + 2], 0x10),
    closeByLight: bit(p[off + 2], 0x01),
    openLevel: p[off + 3] >> 4 || 1,
    closeLevel: p[off + 3] & 0x0f || 1,
    startHour: p[off + 4],
    startMinute: p[off + 5],
    endHour: p[off + 6],
    endMinute: p[off + 7],
  };
}

/** A9 season readback: 16 bytes, summer then winter, each in the 0x16 layout. */
export function decodeSeasons(f: Frame): { summer: Season; winter: Season } | null {
  const p = f.payload;
  if (p.length < 16) return null;
  return { summer: decodeOneSeason(p, 0, 'summer'), winter: decodeOneSeason(p, 8, 'winter') };
}

/** AA light notify. */
export function decodeLight(f: Frame): { hasSensor: boolean; level: number } | null {
  const p = f.payload;
  if (p.length < 2) return null;
  return { hasSensor: p[0] === 1, level: p[1] };
}

export const LimitReply = {
  ENTERED: 0x5a,
  SAVED: 0x5b,
  EXITED: 0x5c,
  SAME_POSITION: 0xb5,
  TIMEOUT: 0xa5,
  RESET_DONE: 0xc5,
} as const;
