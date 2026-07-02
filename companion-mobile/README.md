# Lights Out Companion (Android)

A minimal Android wrapper for the Lights Out PC Companion PWA. The phone app connects to the Lights Out desktop app over the local network using a pairing token.

## Prerequisites

- Node.js 18+
- Java 17 (Capacitor 6)
- Android SDK with `ANDROID_HOME` set
- Windows: `gradlew` must be runnable

## Build

```powershell
cd "C:\Users\KickA\Desktop\Lights Out\companion-mobile"
npm install
npm run sync
npm run build:apk
```

The debug APK is output to:

```
android/app/build/outputs/apk/debug/app-debug.apk
```

## Usage

1. Open the Lights Out desktop app.
2. Go to **Advanced Options > Phone Companion**.
3. Select **Same Wi-Fi**.
4. Type the PC address shown (e.g., `192.168.1.5:58732`) and the pairing code into the Android app.
5. Tap **Connect**.

The phone is now a remote for the desktop timer.
