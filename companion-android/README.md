# Lights Out — Android Companion (WebView wrapper)

A thin native Android app that loads the Lights Out desktop **companion page** in a
WebView, so you get a real installed app icon on your phone instead of a browser
shortcut.

## Why a wrapper (and not a PWA / Play-Store TWA)

The desktop app serves the companion over **plain HTTP on your LAN**
(`http://PC-IP:58732/?t=TOKEN`). Browsers refuse to install that as a standalone
PWA — and a Trusted Web Activity (TWA) refuses to wrap it — because installability
requires a **secure context (HTTPS)**, which a rotating LAN IP can't provide. A
native WebView is not subject to that rule: it just loads the URL. The companion
page persists its pairing token in `localStorage`, which the WebView keeps
(DOM storage is enabled), so after the first connect you don't need the token again.

This app does **not** transmit anything off your LAN and stores only the companion
URL locally.

## Prerequisites

- **Android Studio** (Koala/2024.1+) — or a standalone JDK 17 + Android SDK with
  `cmdline-tools`.
- The desktop app running with **Remote Control enabled** (Settings → Remote
  Control). That's what starts the companion server and mints the pairing token.

## Build

### Option A — Android Studio (simplest)
1. **Open** the `companion-android/` folder as a project. Let Gradle sync (it
   downloads the matching Gradle/AGP automatically).
2. **Run** (▶) onto your device, or **Build → Build APK(s)**.

### Option B — command line
This scaffold ships without the Gradle wrapper JAR (a binary). Generate it once,
then build:

```bash
cd companion-android
gradle wrapper            # needs a local Gradle install; creates ./gradlew + jar
./gradlew assembleDebug   # on Windows: gradlew.bat assembleDebug
```

Point Gradle at your SDK if it isn't auto-detected — create `local.properties`:

```
sdk.dir=C:\\Users\\YOU\\AppData\\Local\\Android\\Sdk
```

The debug APK lands at:

```
app/build/outputs/apk/debug/app-debug.apk
```

## Install over wireless ADB

On the phone: **Developer options → Wireless debugging → on**. Then, from the PC:

```bash
# Android 11+ pairing (one time): use the "Pair device with pairing code" screen
adb pair PHONE-IP:PAIR-PORT          # enter the 6-digit code it shows
adb connect PHONE-IP:DEBUG-PORT      # the port under "Wireless debugging"

adb install -r app/build/outputs/apk/debug/app-debug.apk
```

(If you built in Android Studio with the device already connected via wireless
ADB, just hit Run and skip the manual install.)

## First run

1. Open **Lights Out** on the phone.
2. In the desktop app's Remote Control settings, **scan the QR** with your phone
   camera to get the `http://…:58732/?t=…` link, then **paste it** into the app and
   tap **Connect**. (Or type `PC-IP:58732/?t=TOKEN`.)
3. To repoint at a different PC later: **⋮ menu → Change PC / URL**.

## Debugging

WebView contents debugging is enabled, so with the phone on wireless ADB you can
open desktop Chrome → `chrome://inspect` → **inspect** the WebView to see the
companion page's console, network, and WebSocket frames.

## Notes / limits

- Phone and PC must be on the **same Wi-Fi** (no cloud relay; won't work on
  cellular).
- Cleartext HTTP is allowed via `res/xml/network_security_config.xml` because the
  companion is LAN-only. If you later put the companion behind HTTPS, tighten that.
- `applicationId` is `com.lightsout.companion`; bump `versionCode`/`versionName` in
  `app/build.gradle` for updates.
