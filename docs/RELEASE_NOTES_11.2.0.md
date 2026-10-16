# Lights Out v11.2.0

This release refines the Windows bedtime workflow with a polished searchable
Settings menu, compact navigation, persistent Save/Cancel controls and clearer
forms. Failed saves retain edits.

WiZ settings support individual lights, locally named rooms, brightness, white
temperature, RGB colour and presets. Discovery preserves selection. Wind-down
reads live bulb power before changing brightness and releases lights switched
off manually, including during cancellation and completion. Automation remains
off until enabled. WiZ LAN integration is experimental; UDP fixtures and emulator
QA do not establish physical bulb, phone or router reliability.

The calendar supports weekly, monthly and individual-date rules, selected
months, last-day scheduling and saved routines. The countdown ring remains the
default, with an optional analog idle clock. System effects remain opt-in.

The repository now includes the standalone Android timer, direct WiZ controls
and native phone routines/calendar with debug tests and lint/build qualification.
Phone and PC settings remain independent. No new production-signed Android APK
is included in this Windows release.

Download **Lights Out Setup 11.2.0.exe** for installation, or extract
**Lights-Out-Portable-v11.2.0-win-x64.zip** and run **Lights Out.exe**.
**SHA256SUMS.txt** verifies the downloads. **BUILD-MANIFEST.json** records the
source commit, locked runtime and file hashes; **WINDOWS-VERIFICATION.json**
records installer and portable qualification.

CI fixes Linux child-process cleanup, uses the supported Node runtime, and
qualifies Windows artifacts before publication. Quiet House, School Night,
household-member management, focus scoring and enforced screen-time limits
remain deferred.
