# Lights Out v11.3.0

This release comes out of a full production audit of the Windows app. Its
focus: Lights Out never surprises you with a power action, and nothing it
changes on your PC can be left behind.

**No shutdown on wake.** If your PC sleeps or hibernates through a real timer
(lid closed, idle sleep), Lights Out records the night as *missed* instead of
shutting down seconds after you open the laptop. Cancel now works until the
power request is actually sent — from the window, the tray, Ctrl+Shift+X, your
phone or family controls — and Emergency Override stops the timer before it
contacts partners.

**Nothing left blocked.** Wi-Fi Guard keeps a credential-free recovery record
before it changes anything. A crash, forced quit or power loss while blocking
is undone at the next launch, and quitting restores internet first. Wi-Fi
Guard remains opt-in and experimental.

**Honest Test Mode.** Test Mode now skips every automatic effect — lights,
Night Light, app closing, media, Wi-Fi Guard, site blocking and partner
messages — not just the power action, and the Devices cards say so.

**Quieter defaults.** The hidden Ctrl+Shift+L / Ctrl+Shift+1–4 global
quick-start shortcuts are off by default, so they no longer steal those keys
from Excel and other apps. Paused music is no longer restarted right before
Sleep or Lock. Phone-started Night Modes can only shut down, sleep or restart.

**Private backups.** "Export all data" no longer writes passwords, tokens or
webhook addresses to the backup file, and importing a backup keeps the
credentials already on this PC. More integration credentials are encrypted at
rest. Dropping a file onto the window is ignored.

**Smarter lights.** Dimming now follows the countdown, so pausing or snoozing
no longer turns your lights off early. Hue cancel only restores the lights it
dimmed and never switches a light back on. New, opt-in light cues signal your
bedtime reminder, an upcoming Autopilot run and changes made from your phone —
using only lights that are already on. First Light now plays when the wake task
starts the app.

**Nicer to use.** Drag the Tonight dial to set tonight's length, see a run in
the taskbar, and use Pause / Snooze / Cancel from the taskbar buttons. Old
Phone Companion firewall rules are cleaned up automatically.

**Sleep and Hibernate** go through a small native helper that calls the
documented Windows API and refuses safely when this PC does not offer the
state; it never falls back to Shutdown. Windows accepting the request is
reported as just that — the physical power state is not verified.

Download **Lights-Out-Setup-v11.3.0.exe** to install, or extract
**Lights-Out-Portable-v11.3.0-win-x64.zip** and run **Lights Out.exe**.
**SHA256SUMS.txt** verifies the downloads; **BUILD-MANIFEST.json** records the
source commit, locked runtime and file hashes; **WINDOWS-VERIFICATION.json**
records installer and portable qualification.

Known limits: physical sleep/hibernate/resume, real router and Wi-Fi adapter
recovery, and real phone/bulb behaviour are not established by automated
tests. Moving back to v11.2.0 after running this version cannot decrypt the
newly protected integration credentials (re-enter them there). If you might go
back, quit Lights Out and copy the `%APPDATA%\lights-out-electron` folder before
upgrading: restoring that copy on the same Windows account brings v11.2.0's
settings back. Secure device
pairing ships gated off. The Android app in this repository is
debug-qualified only; no production-signed APK ships with this Windows release.

[Full changelog](https://github.com/lazelife420-spec/Lights-out/blob/v11.3.0/CHANGELOG.md) ·
[Qualification evidence and limits](https://github.com/lazelife420-spec/Lights-out/blob/v11.3.0/docs/RELEASE_QUALIFICATION_11.3.0.md)
