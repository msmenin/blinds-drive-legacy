import { buildFrame } from './frame';

// Command type bytes (remote/Contact.smali).
export const T = {
  CONTROL: 0x0a,
  PERCENT: 0x0d,
  SETTINGS: 0x11,
  TIME: 0x14,
  TIMER: 0x15,
  SEASON: 0x16,
  PASSWORD: 0x17,
  PASSWORD_CHANGE: 0x18,
  LIMIT: 0x22,
  RENAME: 0x35,
  MOVE: 0xa1,
  BATTERY: 0xa2,
  SPEED: 0xa3,
  FAULT: 0xa6,
  FIND_ALL: 0xa7,
  FIND_TIMERS: 0xa8,
  FIND_SEASONS: 0xa9,
  LIGHT: 0xaa,
} as const;

export const Control = { OPEN: 0xdd, CLOSE: 0xee, STOP: 0xcc } as const;
export type ControlAction = keyof typeof Control;

export const DeviceType = {
  VENETIAN: 1,
  VERTICAL: 2,
  ROLLER: 3,
  HONEYCOMB: 4,
  ZEBRA: 5,
  TRIPLE: 8,
} as const;

export const DEVICE_TYPE_LABELS: Record<number, string> = {
  1: 'Venetian blind',
  2: 'Vertical blind',
  3: 'Roller shade',
  4: 'Honeycomb shade',
  5: 'Zebra shade',
  8: 'Triple shade',
};

export const DIAMETERS = [13, 18, 29] as const;

/** Lux for light level 1..9 (SettingSeasonLightLevelActivity). */
export const LIGHT_LUX = [20, 100, 200, 300, 500, 800, 1000, 2000, 5000] as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));

function checkPassword(pw: number): number {
  if (!Number.isInteger(pw) || pw < 0 || pw > 9999) throw new Error('Password must be 0–9999');
  return pw;
}

export const encodeControl = (a: ControlAction) => buildFrame(T.CONTROL, [Control[a]]);

export const encodePercent = (percent: number) => buildFrame(T.PERCENT, [clamp(percent, 0, 100)]);

export function encodePassword(pw: number): Uint8Array {
  checkPassword(pw);
  return buildFrame(T.PASSWORD, [(pw >> 8) & 0xff, pw & 0xff]);
}

export function encodePasswordChange(pw: number): Uint8Array {
  checkPassword(pw);
  return buildFrame(T.PASSWORD_CHANGE, [(pw >> 8) & 0xff, pw & 0xff]);
}

export const encodeFindAll = () => buildFrame(T.FIND_ALL, [0x01]);
export const encodeFindBattery = () => buildFrame(T.BATTERY, [0x01]);
export const encodeFindLight = () => buildFrame(T.LIGHT, [0x01]);

/** [dayOfWeek (Sun=0), hour24, minute, second]; the device has no date. */
export function encodeTime(d: Date): Uint8Array {
  return buildFrame(T.TIME, [d.getDay(), d.getHours(), d.getMinutes(), d.getSeconds()]);
}

export interface WritableSettings {
  deviceType: number;
  /** true = reversed. */
  direction: boolean;
  /** true = inching (motor runs only while button held). */
  inching: boolean;
  speed: number;
  /** Blind height, mm. */
  length: number;
  /** Gear diameter, mm (13/18/29). */
  diameter: number;
}

export function encodeSettings(s: WritableSettings): Uint8Array {
  const p0 = ((s.direction ? 1 : 0) << 1) | ((s.inching ? 1 : 0) << 2) | ((s.deviceType & 0x0f) << 4);
  const len = clamp(s.length, 0, 0xffff);
  return buildFrame(T.SETTINGS, [p0, s.speed & 0xff, 0x00, (len >> 8) & 0xff, len & 0xff, s.diameter & 0xff]);
}

export type LimitEdge = 'top' | 'bottom';
const edgeBit = (e: LimitEdge) => (e === 'top' ? 0x01 : 0x02);

export const encodeLimitEnter = (e: LimitEdge) => buildFrame(T.LIMIT, [0x00, edgeBit(e), 0x00]);
export const encodeLimitSave = (e: LimitEdge) => buildFrame(T.LIMIT, [0x20, edgeBit(e), 0x00]);
export const encodeLimitExit = () => buildFrame(T.LIMIT, [0x40, 0x01, 0x00]);
export const encodeFactoryReset = () => buildFrame(T.LIMIT, [0x00, 0x00, 0x01]);

export const MAX_NAME_BYTES = 18;

export function encodeName(name: string): Uint8Array {
  const bytes = new TextEncoder().encode(name.trim());
  if (bytes.length === 0) throw new Error('Name cannot be empty');
  if (bytes.length > MAX_NAME_BYTES) throw new Error(`Name too long (max ${MAX_NAME_BYTES} bytes)`);
  return buildFrame(T.RENAME, bytes);
}

export interface Timer {
  /** 1..4 */
  slot: number;
  enabled: boolean;
  percent: number;
  /** Index 0 = Sunday … 6 = Saturday. */
  days: boolean[];
  hour: number;
  minute: number;
}

export const MAX_TIMERS = 4;

export function daysToMask(days: boolean[]): number {
  let m = 0;
  for (let i = 0; i < 7; i++) if (days[i]) m |= 1 << i;
  return m;
}

export function maskToDays(mask: number): boolean[] {
  return Array.from({ length: 7 }, (_, i) => (mask & (1 << i)) !== 0);
}

/**
 * Timer hours are stored on the blind 1-based (1..24). The original app's time picker
 * (SettingTimingTimeSetActivity) saves `pickedHour + 1` and shows `storedHour - 1`.
 * Season hours have no such offset.
 */
export const timerHourToWire = (hour: number) => clamp(hour, 0, 23) + 1;
export const timerHourFromWire = (b: number) => Math.min(23, Math.max(0, b - 1));

function checkSlot(slot: number) {
  if (!Number.isInteger(slot) || slot < 1 || slot > MAX_TIMERS) throw new Error('Timer slot must be 1–4');
}

export function encodeTimer(t: Timer): Uint8Array {
  checkSlot(t.slot);
  return buildFrame(T.TIMER, [
    t.slot,
    0x00,
    t.enabled ? 1 : 0,
    clamp(t.percent, 0, 100),
    daysToMask(t.days),
    timerHourToWire(t.hour),
    clamp(t.minute, 0, 59),
  ]);
}

export function encodeTimerDelete(slot: number): Uint8Array {
  checkSlot(slot);
  return buildFrame(T.TIMER, [slot, 0x01, 0, 0, 0, 0, 0]);
}

export type SeasonKind = 'summer' | 'winter';

export interface Season {
  kind: SeasonKind;
  enabled: boolean;
  openByLight: boolean;
  closeByLight: boolean;
  /** 1..9 */
  openLevel: number;
  /** 1..9 */
  closeLevel: number;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
}

export function encodeSeason(s: Season): Uint8Array {
  const mode = (s.openByLight ? 0x10 : 0) | (s.closeByLight ? 0x01 : 0);
  const levels = (clamp(s.openLevel, 1, 9) << 4) | clamp(s.closeLevel, 1, 9);
  return buildFrame(T.SEASON, [
    s.kind === 'summer' ? 0 : 1,
    s.enabled ? 1 : 0,
    mode,
    levels,
    clamp(s.startHour, 0, 23),
    clamp(s.startMinute, 0, 59),
    clamp(s.endHour, 0, 23),
    clamp(s.endMinute, 0, 59),
  ]);
}

/** Returns an error message, or null if the season config is acceptable to the original app. */
export function validateSeason(s: Season): string | null {
  if (s.openByLight && s.closeByLight) {
    if (s.kind === 'summer' && !(s.openLevel < s.closeLevel))
      return 'In summer the open light level must be lower than the close level.';
    if (s.kind === 'winter' && !(s.openLevel > s.closeLevel))
      return 'In winter the open light level must be higher than the close level.';
  }
  return null;
}
