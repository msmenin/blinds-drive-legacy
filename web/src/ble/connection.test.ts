import { describe, expect, it } from 'vitest';
import { DeviceConnection, WrongPasswordError } from './connection';
import { createMockDevice } from './mock';

const until = async (fn: () => boolean, ms = 3000) => {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

async function session() {
  const conn = new DeviceConnection(createMockDevice());
  const tx: string[] = [];
  conn.on('log', (e) => e.dir === 'tx' && tx.push(e.text));
  await conn.connect();
  return { conn, tx };
}

describe('DeviceConnection against the simulated blind', () => {
  it('rejects a wrong password', async () => {
    const { conn } = await session();
    await expect(conn.login(1111)).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it('logs in with the original handshake order and reads state', async () => {
    const { conn, tx } = await session();
    await conn.login(1234);
    const types = tx.map((t) => t.split(' ')[5]);
    // password, find-all, ack A7, time
    expect(types.slice(0, 4)).toEqual(['17', 'A7', 'A7', '14']);
    expect(tx[2]).toBe('00 FF 00 00 9A A7 01 5A 31');
    expect(conn.state.settings).toMatchObject({ topLimitSet: true, bottomLimitSet: true, deviceType: 3, length: 1500 });
    expect(conn.state.timers).toHaveLength(1);
    expect(conn.state.seasons?.winter.enabled).toBe(false);
  });

  it('moves, acks position notifies, and edits timers', async () => {
    const { conn, tx } = await session();
    await conn.login(1234);
    await conn.control('CLOSE');
    await until(() => conn.state.position === 100, 6000);
    expect(tx).toContain('00 FF 00 00 9A A1 01 5A 31');

    await conn.moveTo(40);
    await until(() => conn.state.position === 40, 6000);

    await conn.setTimer({ slot: 2, enabled: true, percent: 100, days: Array(7).fill(true), hour: 22, minute: 0 });
    await conn.refresh();
    await until(() => conn.state.timers.length === 2);
    await conn.deleteTimer(1);
    await until(() => conn.state.timers.length === 1);
    expect(conn.state.timers[0]).toMatchObject({ hour: 22, percent: 100 });
  }, 15000);

  it('runs a limit setup and a settings write', async () => {
    const { conn } = await session();
    await conn.login(1234);
    const { encodeLimitEnter, encodeLimitSave } = await import('../protocol/commands');
    expect(await conn.limit(encodeLimitEnter('top'))).toBe(0x5a);
    expect(await conn.limit(encodeLimitSave('top'))).toBe(0x5b);
    await conn.writeSettings({ deviceType: 1, direction: true, inching: true, speed: 30, length: 2000, diameter: 29 });
    const before = conn.state.settings;
    await conn.refresh();
    await until(() => conn.state.settings !== before);
    expect(conn.state.settings).toMatchObject({ deviceType: 1, direction: true, inching: true, speed: 30, length: 2000 });
  });

  it('rejects in-flight requests on disconnect', async () => {
    const { conn } = await session();
    await conn.login(1234);
    const p = conn.waitFor(() => false, 5000);
    conn.disconnect();
    await expect(p).rejects.toThrow('Disconnected');
    expect(conn.connected).toBe(false);
  });
});
