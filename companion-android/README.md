# Lights Out — standalone Android app and PC companion

Open the app to a **phone timer that works offline**, with no PC, account or pairing
required. Start, pause, resume, add five minutes or cancel. Countdown ring is the
default; an optional analog clock appears while idle. Timers remain saved when you
leave the screen, close the app normally or reopen it. They finish with an Android
notification, rather than a phone power action. The Lighting, Routines and Calendar
tabs are also native phone features: their saved settings and alarms do not need
the PC or the PC companion server.

**Pair a PC / Open PC controls** opens a separate screen for controlling a running
Lights Out desktop app. The phone and PC timers are independent: operating one
does not change the other. PC routines run on the PC; phone routines run on the
phone. Set up the phone's lights and schedules separately. This is phone-to-PC
control, as requested; the PC does not control the phone timer.

## Direct WiZ lighting and phone calendar

1. Open **Lighting**, join the bulbs' Wi-Fi and enable **Local communication** in
   the WiZ app. Find lights or enter their local IPv4 addresses. Save up to eight
   lights. **Check** reads status without changing a bulb; On, Off and warm
   brightness controls require a WiZ acknowledgement before reporting success.
2. Open **Routines**. Save a name and timer duration, optionally select lights,
   warm starting brightness (10–100%, 2700K), and lights off at completion.
   A routine can also be a phone reminder with no lighting action.
3. Open **Calendar**, choose a saved routine and a local start time. Rules support
   ISO weekdays, selected months with days 1–31 or **last**, and individual dates.
   The month planner covers all months and can create a date rule by tapping a day.
4. Grant **Allow precise alerts** (Android Alarms & reminders). Saved calendar
   rules remain paused without this access. Android displays scheduled routines
   as alarms. Notifications are separate permission for visible finish alerts.

Calendar rules use the phone's local time zone, with a fresh alarm after each
occurrence and on reboot, time/time-zone changes, app updates and permission
grant. Reboot restoration requires Android to unlock the app's ordinary storage.
A spring DST gap moves forward; the first fall overlap runs once. Month days that
do not exist are skipped. A persistent occurrence ledger prevents duplicate
starts. A routine delivered more than two minutes late is skipped; a running or
paused phone timer takes priority over another scheduled routine.

An active run captures its selected targets and finish action: editing/deleting
the saved routine affects future starts. Pause holds the timer, resume and +5 min
move its finish, and cancel leaves lights as they are and cancels the finish
action. Warm starting light is a single command, not a gradual fade.

WiZ commands go directly over UDP 38899 from Android, with bounded response
waits, address/port/method checks, per-target serialization and explicit negative
acknowledgement handling. WiZ local control has no application authentication;
use it only on a trusted local network. No cloud or PC relay is used. The phone
must stay powered on and connected to the bulbs' network for lighting actions.
Network failure does not stop the reminder timer; failed lighting commands are
reported and are not automatically replayed later. Android Force stop suspends
all alarms until Lights Out is reopened. OEM battery restrictions can also affect
delivery and still need physical-device testing.

Emulator QA uses a debug package and a local UDP stand-in. It does not establish
broadcast discovery or background Wi-Fi reliability on a physical phone/router.

## Phone timer and Android alerts

- A native foreground service provides the active timer notification and pause,
  resume and cancel controls. AlarmManager delivers the finish alert with the
  screen asleep; the timer does not depend on a WebView or network connection.
- Allow notifications to receive the finish alert. On Android 12+, use **Allow
  precise alerts** to grant Alarms & reminders access. Without it, Android may
  delay background delivery; the app displays that limitation and uses an
  inexact alarm. The visible countdown still measures elapsed time.
- The saved deadline survives a process restart and is rescheduled after reboot.
  Changing the wall clock does not change a running countdown within the same
  boot. After reboot, restoration uses the saved wall-clock deadline.
- Android **Force stop**, app-data clearing and uninstall are distinct from
  closing the screen: force stop disables alerts until the app is opened again;
  clearing data/uninstall removes the saved timer and pairing.
- The native message bridge exists only on the bundled HTTPS asset origin. The
  remote PC WebView has no access to that bridge. App backup is disabled so PC
  pairing credentials are not copied into device backups. WebView debugging is
  enabled only for debug builds.

## PC connection

The desktop app serves the companion over **plain HTTP on your LAN**
(`http://PC-IP:58732/?t=TOKEN`). Browsers refuse to install that as a standalone
PWA — and a Trusted Web Activity (TWA) refuses to wrap it — because installability
requires a **secure context (HTTPS)**, which a rotating LAN IP can't provide. A
native WebView is not subject to that rule: it just loads the URL. The companion
page persists its pairing token in `localStorage`, which the WebView keeps
(DOM storage is enabled), so after the first connect you don't need the token again.

The app has no cloud relay or account. It stores its phone timer, WiZ targets,
routines, calendar rules, occurrence ledger and companion URL/token locally.

## Prerequisites

- **Android Studio** (Koala/2024.1+) — or a standalone JDK 17 + Android SDK with
  `cmdline-tools`.
- For PC control only: the desktop app running with the phone companion in **Same Wi-Fi** mode
  (Settings › Phone Companion › Same Wi-Fi). That's what starts the companion
  server and mints the pairing token.

## Build

### Option A — Android Studio (simplest)
1. **Open** the `companion-android/` folder as a project. Let Gradle sync (it
   downloads the matching Gradle/AGP automatically).
2. **Run** (▶) onto your device, or **Build → Build APK(s)**.

### Option B — command line
The Gradle 8.7 wrapper is included, with a pinned distribution checksum. Build a
debug APK with:

```bash
cd companion-android
./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
# On Windows, use gradlew.bat.
```

Point Gradle at your SDK if it isn't auto-detected — create `local.properties`:

```
sdk.dir=C:\\Users\\YOU\\AppData\\Local\\Android\\Sdk
```

The debug APK lands at:

```
app/build/outputs/apk/debug/app-debug.apk
```

Agents use `electron/scripts/android-debug-qa.ps1` from the repository root. It
copies only source and wrapper files into a new temporary project, supplies
explicit QA properties, isolates Gradle/Android user homes, and clears signing
variables. Never build QA in the owner's checkout or load signing properties.
The v11.2.0 Windows release reconciles this Android source and qualifies its
debug build; it does not publish a new production-signed Android APK. Physical
phone/router and broadcast-discovery reliability remain unqualified.

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
2. Use **Start phone timer** independently, or tap **Pair a PC**. For PC control,
   enable **Same Wi-Fi** in the desktop Phone Companion settings (it shows a QR).
3. Tap **Scan QR code** and point the camera at it — the app pairs and connects
   automatically. (Or paste/type the `http://PC-IP:58732/?t=TOKEN` link and tap
   **Connect**.)
4. To repoint at a different PC later: **⋮ menu → Change PC / URL**.
5. Use the **PC controls** screen's back arrow to return to your phone timer.

QR scanning uses CameraX + on-device ML Kit barcode scanning (no network, no
Play Services dependency). Camera permission is requested on first scan.

> Note: ML Kit's bundled native libraries aren't 16 KB-page aligned, so on
> Android 15 a debuggable build shows a one-time "App Compatibility" warning. It
> is harmless on current devices and does not appear in release builds.

## Debugging

WebView contents debugging is enabled in debug builds, so with the phone on wireless ADB you can
open desktop Chrome → `chrome://inspect` → **inspect** the WebView to see the
companion page's console, network, and WebSocket frames.

## Release signing

A release keystore exists for this app (alias `lightsout-companion`), stored
**outside any git checkout** at a stable per-machine path so it survives
worktree pruning:

```
~/.android/lightsout-companion-release.jks   (Windows: C:\Users\<you>\.android\...)
```

To build a release APK on a machine that has this file, create
`companion-android/keystore.properties` (gitignored, never commit it):

```properties
storeFile=C:/Users/<you>/.android/lightsout-companion-release.jks
storePassword=<the store password>
keyAlias=lightsout-companion
keyPassword=<same as storePassword — PKCS12 keystores require it>
```

Release builds **fail closed** without authorized signing configuration. Debug
builds use the separate `com.lightsout.companion.debug` package, so emulator QA
does not replace the production app or erase its pairing. Never uninstall the
production app to work around a debug signing mismatch.

> **Back up `lightsout-companion-release.jks` and its password.** There is no
> recovery path if it's lost — a new keystore cannot resign updates for an
> existing install, so every user would need to uninstall and reinstall from
> scratch.

## Notes / limits

- PC control requires phone and PC on the **same Wi-Fi** (no cloud relay).
  The standalone phone timer works without Wi-Fi or cellular data.
- Cleartext HTTP is allowed via `res/xml/network_security_config.xml` because the
  companion is LAN-only. If you later put the companion behind HTTPS, tighten that.
- `applicationId` is `com.lightsout.companion`; bump `versionCode`/`versionName` in
  `app/build.gradle` for updates.
- **The "auto-detect" card may never appear, and that's likely not a bug.**
  It relies on the desktop broadcasting a UDP beacon on port 58733
  (`family.js`'s `LIGHTSOUT_FAMILY_V1` beacon) that the app listens for in
  `MainActivity.startUdpDiscovery()`. Confirmed 2026-07-10 on a real network:
  even a raw OS-level broadcast probe, sent from the same PC with the same
  Windows Firewall/network profile as the real app, never reached the phone
  — while a normal unicast WebSocket connection to that same PC's specific IP
  worked fine. This points to the router/AP silently dropping broadcast
  traffic between Wi-Fi clients ("client/AP isolation," a common default on
  mesh systems and many consumer routers), not a code defect on either end.
  There is no app-level fix for this: it's why "Scan QR code" is the primary,
  most-prominent button on the setup screen and auto-detect is a bonus, not
  the main path. Don't spend time re-debugging `startUdpDiscovery()` or
  `family.js`'s beacon unless you have concrete evidence the specific network
  in question actually permits Wi-Fi client-to-client broadcast.
