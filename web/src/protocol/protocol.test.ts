import { describe, expect, it } from 'vitest';
import { buildAck, FrameParser, fromHex, toHex } from './frame';
import * as C from './commands';
import * as D from './decode';

// Expected vectors were hand-derived from the decompiled smali (AgreementCommand$Companion).
const hex = (b: Uint8Array) => toHex(b).replace(/ /g, '');
const h = (s: string) => s.replace(/\s/g, '').toUpperCase();

describe('encoders', () => {
  it.each([
    ['open', C.encodeControl('OPEN'), '00FF00009A0A01DD4C'],
    ['close', C.encodeControl('CLOSE'), '00FF00009A0A01EE7F'],
    ['stop', C.encodeControl('STOP'), '00FF00009A0A01CC5D'],
    ['50%', C.encodePercent(50), '00FF00009A0D0132A4'],
    ['password 1234', C.encodePassword(1234), '00FF00009A170204D259'],
    ['password change 1234', C.encodePasswordChange(1234), '00FF00009A180204D256'],
    ['find all', C.encodeFindAll(), '00FF00009AA701013D'],
    ['find battery', C.encodeFindBattery(), '00FF00009AA2010138'],
    ['find light', C.encodeFindLight(), '00FF00009AAA010130'],
    ['ack A9', buildAck(0xa7), '00FF00009AA7015A31'],
    ['ack A1', buildAck(0xa1), '00FF00009AA1015A31'],
    ['limit enter top', C.encodeLimitEnter('top'), '00FF00009A2203000100BA'],
    ['limit enter bottom', C.encodeLimitEnter('bottom'), '00FF00009A2203000200B9'],
    ['limit save top', C.encodeLimitSave('top'), '00FF00009A22032001009A'],
    ['limit save bottom', C.encodeLimitSave('bottom'), '00FF00009A220320020099'],
    ['limit exit', C.encodeLimitExit(), '00FF00009A2203400100FA'],
    ['factory reset', C.encodeFactoryReset(), '00FF00009A2203000001BA'],
    ['rename Living', C.encodeName('Living'), '00FF00009A35064C6976696E679A'],
  ])('%s', (_, bytes, expected) => {
    expect(hex(bytes)).toBe(h(expected));
  });

  it('time (Wed 14:30:05)', () => {
    // 2026-09-30 is a Wednesday.
    expect(hex(C.encodeTime(new Date(2026, 8, 30, 14, 30, 5)))).toBe('00FF00009A1404030E1E059C');
  });

  it('settings: venetian, forward, continuous, speed 28, 1500mm, 18mm', () => {
    const f = C.encodeSettings({ deviceType: 1, direction: false, inching: false, speed: 28, length: 1500, diameter: 18 });
    expect(hex(f)).toBe(h('00FF00009A1106101C0005DC124A'));
  });

  it('settings: roller, reverse, speed 30, 2000mm, 29mm', () => {
    const f = C.encodeSettings({ deviceType: 3, direction: true, inching: false, speed: 30, length: 2000, diameter: 29 });
    expect(hex(f)).toBe(h('00FF00009A1106321E0007D01D6B'));
  });

  it('timer: slot 1 on, 50%, Mon–Fri 07:30 (hour sent 1-based, as the original app did)', () => {
    const days = [false, true, true, true, true, true, false];
    const f = C.encodeTimer({ slot: 1, enabled: true, percent: 50, days, hour: 7, minute: 30 });
    expect(hex(f)).toBe(h('00FF00009A150701000132 3E081E92'));
  });

  it('timer hour wire mapping covers midnight and 23:00', () => {
    expect(C.timerHourToWire(0)).toBe(1);
    expect(C.timerHourToWire(23)).toBe(24);
    expect(C.timerHourFromWire(1)).toBe(0);
    expect(C.timerHourFromWire(24)).toBe(23);
  });

  it('timer delete slot 2', () => {
    expect(hex(C.encodeTimerDelete(2))).toBe(h('00FF00009A15070201000000000 08B'));
  });

  it('season: summer on, both triggers, open 2 close 7, all day', () => {
    const f = C.encodeSeason({
      kind: 'summer', enabled: true, openByLight: true, closeByLight: true,
      openLevel: 2, closeLevel: 7, startHour: 0, startMinute: 0, endHour: 23, endMinute: 59,
    });
    expect(hex(f)).toBe(h('00FF00009A16080001112700 00173B9F'));
  });

  it('season: winter on, open-only, open 6 close 1, 08:00–18:00', () => {
    const f = C.encodeSeason({
      kind: 'winter', enabled: true, openByLight: true, closeByLight: false,
      openLevel: 6, closeLevel: 1, startHour: 8, startMinute: 0, endHour: 18, endMinute: 0,
    });
    expect(hex(f)).toBe(h('00FF00009A1608010110610800120 0EF'));
  });

  it('rejects bad input', () => {
    expect(() => C.encodePassword(10000)).toThrow();
    expect(() => C.encodeName('')).toThrow();
    expect(() => C.encodeName('x'.repeat(19))).toThrow();
    expect(() => C.encodeTimer({ slot: 5, enabled: true, percent: 0, days: [], hour: 0, minute: 0 })).toThrow();
  });

  it('validates season light levels', () => {
    const base: C.Season = {
      kind: 'summer', enabled: true, openByLight: true, closeByLight: true,
      openLevel: 7, closeLevel: 2, startHour: 0, startMinute: 0, endHour: 23, endMinute: 59,
    };
    expect(C.validateSeason(base)).not.toBeNull();
    expect(C.validateSeason({ ...base, kind: 'winter' })).toBeNull();
  });
});

describe('FrameParser', () => {
  it('parses a frame with the 00FF0000 prefix split across chunks', () => {
    const p = new FrameParser();
    const bytes = C.encodePassword(1234);
    expect(p.push(bytes.slice(0, 6))).toEqual([]);
    const frames = p.push(bytes.slice(6));
    expect(frames).toHaveLength(1);
    expect(frames[0].type).toBe(0x17);
    expect(Array.from(frames[0].payload)).toEqual([0x04, 0xd2]);
  });

  it('handles a checksum byte equal to 9A', () => {
    const p = new FrameParser();
    const frames = p.push(C.encodeName('Living'));
    expect(frames).toHaveLength(1);
    expect(new TextDecoder().decode(frames[0].payload)).toBe('Living');
  });

  it('accepts ack trailers and multiple frames per chunk', () => {
    const p = new FrameParser();
    const frames = p.push(fromHex('9A 17 01 5A 31 9A A1 02 00 32 ' + (0x9a ^ 0xa1 ^ 0x02 ^ 0x00 ^ 0x32).toString(16).padStart(2, '0')));
    expect(frames.map((f) => f.type)).toEqual([0x17, 0xa1]);
    expect(D.isOk(frames[0])).toBe(true);
    expect(D.decodePosition(frames[1])).toBe(50);
  });

  it('resyncs past garbage and bad checksums', () => {
    const p = new FrameParser();
    const frames = p.push(fromHex('01 9A 02 03 9A 0A 01 5A ' + (0x9a ^ 0x0a ^ 0x01 ^ 0x5a).toString(16).padStart(2, '0')));
    expect(frames.map((f) => f.type)).toEqual([0x0a]);
  });
});

describe('decoders', () => {
  const frame = (type: number, payload: number[]) => new FrameParser().push(buildRaw(type, payload))[0];
  const buildRaw = (type: number, payload: number[]) => {
    const body = [0x9a, type, payload.length, ...payload];
    return Uint8Array.from([...body, body.reduce((a, b) => a ^ b, 0)]);
  };

  it('A7 settings', () => {
    const s = D.decodeSettings(frame(0xa7, [0b11101, 28, 40, 0x05, 0xdc, 18, 0x30]))!;
    expect(s).toMatchObject({
      direction: true, inching: false, topLimitSet: true, bottomLimitSet: true, hasLightSensor: true,
      speed: 28, position: 40, length: 1500, diameter: 18, deviceType: 3,
    });
    expect(D.decodeSettings(frame(0xa7, [0, 0, 0xff, 0, 0, 0, 0]))!.position).toBeNull();
  });

  it('A8 timers', () => {
    const t = D.decodeTimers(frame(0xa8, [1, 50, 0x3e, 8, 30, 0, 100, 0x41, 23, 0]));
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({ slot: 1, enabled: true, percent: 50, hour: 7, minute: 30 });
    expect(t[0].days).toEqual([false, true, true, true, true, true, false]);
    expect(t[1]).toMatchObject({ slot: 2, enabled: false, percent: 100, hour: 22 });
    expect(t[1].days).toEqual([true, false, false, false, false, false, true]);
  });

  it('A9 seasons', () => {
    const s = D.decodeSeasons(frame(0xa9, [0, 1, 0x11, 0x27, 0, 0, 23, 59, 1, 0, 0x10, 0x61, 8, 0, 18, 0]))!;
    expect(s.summer).toMatchObject({ enabled: true, openByLight: true, closeByLight: true, openLevel: 2, closeLevel: 7, endHour: 23 });
    expect(s.winter).toMatchObject({ enabled: false, openByLight: true, closeByLight: false, openLevel: 6, closeLevel: 1, startHour: 8 });
  });

  it('A2 battery and AA light', () => {
    expect(D.decodeBattery(frame(0xa2, [0, 0, 0, 0, 87]))).toBe(87);
    expect(D.decodeLight(frame(0xaa, [1, 5]))).toEqual({ hasSensor: true, level: 5 });
  });
});
