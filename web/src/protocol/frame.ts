// Frame layout (from AgreementCommand$Companion.sendBleCommand):
//   TX:  00 FF 00 00 | 9A | type | len | payload[len] | chk
//   chk = XOR of every byte from 9A through the payload.
// Ack frames (sendBleCommandNotHandshake) replace chk with a fixed 0x31 (ok) / 0xCE (fail).

export const HEAD_TAG = [0x00, 0xff, 0x00, 0x00] as const;
export const HEAD = 0x9a;
export const TRAILER_OK = 0x31;
export const TRAILER_FAIL = 0xce;
export const STATUS_OK = 0x5a;
export const STATUS_FAIL = 0xa5;

export function xor(bytes: ArrayLike<number>): number {
  let x = 0;
  for (let i = 0; i < bytes.length; i++) x ^= bytes[i];
  return x & 0xff;
}

export function buildFrame(type: number, payload: ArrayLike<number>): Uint8Array {
  if (payload.length > 0xff) throw new Error('payload too long');
  const body = [HEAD, type & 0xff, payload.length, ...Array.from(payload, (b) => b & 0xff)];
  return Uint8Array.from([...HEAD_TAG, ...body, xor(body)]);
}

export function buildAck(type: number, ok = true): Uint8Array {
  return Uint8Array.from([
    ...HEAD_TAG,
    HEAD,
    type & 0xff,
    1,
    STATUS_OK,
    ok ? TRAILER_OK : TRAILER_FAIL,
  ]);
}

export interface Frame {
  type: number;
  payload: Uint8Array;
  /** Full frame starting at 9A. */
  raw: Uint8Array;
}

/**
 * Reassembles notify chunks into frames. Unlike the original app (which split on every 0x9A),
 * this walks by the length byte, so payloads/checksums containing 0x9A are handled.
 */
export class FrameParser {
  private buf: number[] = [];

  push(chunk: ArrayLike<number>): Frame[] {
    for (let i = 0; i < chunk.length; i++) this.buf.push(chunk[i] & 0xff);
    const out: Frame[] = [];
    for (;;) {
      const start = this.buf.indexOf(HEAD);
      if (start < 0) {
        this.buf = [];
        break;
      }
      if (start > 0) this.buf.splice(0, start);
      if (this.buf.length < 3) break;
      const len = this.buf[2];
      const total = len + 4;
      if (this.buf.length < total) break;
      const candidate = this.buf.slice(0, total);
      const last = candidate[total - 1];
      const valid =
        last === xor(candidate.slice(0, total - 1)) || last === TRAILER_OK || last === TRAILER_FAIL;
      if (!valid) {
        // Not a real frame start; drop this 9A and resync.
        this.buf.shift();
        continue;
      }
      this.buf.splice(0, total);
      const raw = Uint8Array.from(candidate);
      out.push({ type: raw[1], payload: raw.slice(3, 3 + len), raw });
    }
    return out;
  }

  reset(): void {
    this.buf = [];
  }
}

export function toHex(bytes: ArrayLike<number>): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}
