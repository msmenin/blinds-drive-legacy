# blinds-drive-legacy

A web app to control motorized blinds that shipped with the discontinued Android app "KT curtains controller" (`com.example.feng.ktcurtainscontroller`). It talks to the motor directly over Web Bluetooth, so there's nothing to install.

- **iPhone:** open the deployed site in the free [Bluefy](https://apps.apple.com/app/id1492822055) browser. Safari doesn't support Web Bluetooth.
- **Android / desktop:** Chrome or Edge.

The app can open, close, stop and move the blind to a position. It also covers the timers, the summer/winter light modes, the motor settings, limit setup, rename, password change and factory reset. Saved blinds and their passwords are kept in the browser's localStorage.

## Develop

```bash
cd web
npm install
npm run dev      # http://localhost:5173 — add ?demo for a simulated blind (password 1234)
npm test
```

## Deploy (Cloudflare)

```bash
cd web
npx wrangler login   # once
npm run deploy
```

Web Bluetooth only works over HTTPS, so test on a phone through the deployed `*.workers.dev` URL.

## Layout

- `web/` holds the app (Vite + TypeScript). `web/CLAUDE.md` describes the architecture and the Bluetooth protocol.
- `blinds/CLAUDE.md` holds the notes from reverse engineering the original APK: where each part of the protocol lives in the decompiled smali.

The APK and its decompiled code are not in this repo. To reproduce the decode, run `apktool d blinds.apk -o blinds` on your own copy of the APK.
