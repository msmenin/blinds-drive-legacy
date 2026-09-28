# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

This is a web app for the motorized blinds sold with the discontinued Android app `com.example.feng.ktcurtainscontroller` ("KT curtains controller"). It talks to the motors directly over **Web Bluetooth**. The main target is iPhone using the **Bluefy** browser, because Safari has no Web Bluetooth. Chrome and Edge work on Android and desktop.

It is a static site (Vite + TypeScript, no framework) deployed to Cloudflare Workers static assets. Saved blinds (name, password, last settings) are stored in `localStorage` under `blinds.devices.v1`. Demo mode uses `blinds.demo.v1`.

The protocol was reverse engineered from the decompiled APK at `../blinds/`. That directory's `CLAUDE.md` maps where each part of the protocol lives in the smali.

## Commands

```bash
npm run dev                         # Vite dev server
npm test                            # Vitest: protocol vectors + connection-vs-simulator tests
npx vitest run -t "timer"           # a single test by name
npm run build                       # tsc typecheck + vite build → dist/
npm run deploy                      # build + wrangler deploy (needs `npx wrangler login` once)
```

Open `/?demo` for a simulated blind (password `1234`). It runs the full UI and protocol with no hardware.

## Architecture

- `src/protocol/` is pure code with no DOM or Bluetooth.
  - `frame.ts` builds frames and has `FrameParser`.
  - `commands.ts` holds the encoders and type bytes.
  - `decode.ts` decodes the notifications.
  - Every encoder has a byte-exact test vector in `protocol.test.ts`, derived from the smali. **If you change an encoder, the vectors must still pass.**
- `src/ble/connection.ts` contains `DeviceConnection`. It handles the GATT connection, a serialized write queue, notify parsing, request/reply matching (`request(frame, replyType)`), the login handshake, and automatic acks.
- `src/ble/mock.ts` is a simulated blind that speaks the wire protocol. It is used by `?demo` and by `connection.test.ts`.
- `src/session.ts` holds the single live connection. It covers the add and reconnect flows and prompts for the password.
- `src/ui/*` contains the hand-rolled DOM views. `h()` is in `dom.ts`, and `main.ts` has the hash router (`#/`, `#/d/:id/:tab`). Each view returns `{el, dispose}`. Views subscribe to `conn.on('state')`. The settings and light views only re-render when the settings or season objects are replaced, so a form the user is editing isn't wiped by position updates.

## Protocol essentials

- Service `0xFE50`. Characteristic `0xFE51` is used for both write and notify.
- TX frame: `00 FF 00 00 9A type len payload chk`, where `chk = XOR(9A..payload)`.
- Acks sent by the app use the fixed trailer `31` in place of `chk`.
- RX frames arrive without the prefix. Parse them **by length**, because checksum and payload bytes can equal `9A`.
- Login steps:
  1. Send `17 [pw hi, lo]` and wait for a `17` reply with `5A`.
  2. Send `A7 01`. The device replies `A7` (settings), `A8` (timers) and `A9` (seasons).
  3. After `A9`, send the ack `A7 5A 31`.
  4. Then send the time `14 [dow, h, m, s]`.
- The app must ack every `A1`, `A2`, `A3` and `A6` notify.
- The bit layout of the `A7` flags byte **differs** from the `0x11` write layout. See `decode.ts` and `commands.ts`.
- **Timer hours are 1-based on the wire (1–24).** The original app sends the picked hour + 1 and shows the stored hour − 1 (`SettingTimingTimeSetActivity`). `timerHourToWire` and `timerHourFromWire` handle the conversion. Season hours and the clock sync (`0x14`) are **not** offset.
- Unverified on real hardware:
  - whether 0% means fully open;
  - whether notifications include the `00FF0000` prefix (the parser tolerates both);
  - whether the device replies to `0x18` (password change).

  The in-app **Log** button shows every TX/RX frame in hex so these can be checked.

## Platform constraints

- Web Bluetooth requires HTTPS (or localhost) and a user gesture for `requestDevice`.
- Bluefy may not support `getDevices()`. Reconnecting calls `requestDevice` with a `name` filter so the picker shows only that blind. Renaming a blind also updates the saved `name`.
- `device.id` is opaque and can change between browsers. `findDevice` falls back to matching by name.
