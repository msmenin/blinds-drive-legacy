# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

This is **not a source repository**. It is an apktool 3.0.3 decode of `blinds.apk`: package `com.example.feng.ktcurtainscontroller`, version 1.6 (code 17), minSdk 18, targetSdk 29. It is a Kotlin Android app that controls motorized curtains and blinds over Bluetooth LE. All code is **smali**. There is no Java/Kotlin source, no Gradle build and no tests. It is not a git repo.

Most work here is reverse engineering: reading smali to understand the device protocol. Sometimes it means patching smali and rebuilding the APK.

## Commands

```bash
# Rebuild APK from this directory (output: dist/blinds.apk)
apktool b . -o dist/blinds.apk

# Sign for install (the original signature in original/META-INF is invalid after rebuild)
zipalign -p 4 dist/blinds.apk dist/blinds-aligned.apk
apksigner sign --ks <keystore> dist/blinds-aligned.apk

# Re-decode from an APK if a clean tree is needed
apktool d blinds.apk -o <dir>
```

`apktool` is installed (`/opt/homebrew/bin/apktool`). `jadx` and `baksmali` are not. If readable Java would help, suggest `brew install jadx` to the user.

## Layout

- `smali/com/example/feng/ktcurtainscontroller/` holds **the app's own code**. Everything else under `smali/` is third-party libraries: FastBle (`com/clj/fastble`), EventBus (`org/greenrobot`), RxJava, OkHttp, Kotlin stdlib, Glide, Tencent Bugly and others.
- `smali/com/bronze/kutil/` holds the author's utility lib. `ByteUtils.sysByteMerge` concatenates byte arrays, and `formatHexStringList` formats bytes for logs.
- `assets/` contains localized setup-guide images and the EULA/privacy HTML (`fuwu_*`, `yinsi_*`).
- `lib/*/libBugly.so` is only the Tencent crash reporter.
- Kotlin `companion object` members compile to `Foo$Companion.smali`. Lambdas and inner classes compile to `Foo$method$N.smali`. The real logic usually lives in the `$Companion` file.
- The package name misspells `moudle` (module) and `settting`. Keep those spellings when you look up paths.

## App architecture (app package)

Data flows as follows:

**UI → EventBus → BluetoothService → AgreementCommand → BleUtils (FastBle) → device**

**device notify → BleUtils → MyBleConnectCallbackImpl → BleSetBeanAnalysis → EventBus → UI**

- **`remote/Contact`** holds every protocol constant: GATT UUIDs, command type bytes, payload bytes, notify types and device types. Start here when you decode any message.
- **`ble/AgreementCommand$Companion`** builds command frames. There is one `send*Command` method per operation: control, percent, password, time, timing, season, limits, speed, rename and find-settings.
- **`ble/BleUtils`** wraps FastBle `BleManager`. It handles scan, the connect queue, heartbeat/disconnect, notify subscription and `write`.
- **`ble/BleSetBeanAnalysis$Companion.getNotifyInfoAnalysis`** parses incoming notifications into beans and events.
- **`service/BluetoothService`** is a long-lived service that owns `BleUtils`. Its `onEvent(...)` EventBus subscribers turn UI requests into commands.
- **`event/`** holds the EventBus message types. **`bean/`** holds the data classes.
- **`sqlite/DBOpenHelper`** manages the DB `milk.db`, which has two tables. `bledevice` has the columns blename, blemac and blepassword. `scene` has sname and an `operation` column that stores serialized text.
- UI modules live under `ui/moudle/`. `timely` covers scanning, direct control and the pairing guide. `scene` covers multi-device scenes. `settting` covers per-device config, with `season` and `timing` subfolders.

## BLE protocol (as decoded)

- Service `0000fe50-0000-1000-8000-00805f9b34fb`. Write and notify both use the same characteristic, `0000fe51-...`.
- Frame layout (`sendBleCommand`):
  ```
  00 FF 00 00 | 9A | type | len | payload[len] | chk
  chk = 0x9A ^ type ^ len ^ payload[0] ^ ... ^ payload[len-1]
  ```
  The `sendBleCommandNotHandshake` variant replaces `chk` with a fixed `0x31` (verify success) or `0xCE` (failure).
- Known send types:
  - `0x0A` direct control, with payload `DD` open, `EE` close or `CC` stop
  - `0x0D` move to a percent position (one byte)
  - `0x17` password (2 bytes, big-endian)
  - `0x18` password change
  - `0x14` send time
  - `0x15` timing
  - `0x16` season
  - `0x11` frequent settings
  - `0x22` limit or reset
  - `0xA7` find all settings
- Notify types:
  - `0xA1` move/position
  - `0xA2` electric
  - `0xA3` speed
  - `0xA6` fault
  - `0xA7`, `0xA8` and `0xA9` for find normal, find timing and find season
  - `0xAA` illuminance
  - `0x35` new name
- Status bytes: `0x5A` success and `0xA5` failure. See `Contact` for limit and season sub-codes.
- After connecting, the app sends the password command first (as a handshake), then `sendFindSetCommand` to load device state.

Smali prints signed bytes in `.field` declarations. For example, `-0x66t` is `0x9A` and `-0x23t` is `0xDD`.
