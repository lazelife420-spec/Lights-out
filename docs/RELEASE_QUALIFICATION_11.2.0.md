# v11.2.0 release qualification

The release closes the October desktop/settings/WiZ work and reconciles the
existing Android implementation. Parked features remain outside its scope.

## Automated release gates

The [candidate CI run](https://github.com/lazelife420-spec/Lights-out/actions/runs/38957961548)
qualifies source `ee92baac4f9fc17b7501bbbeaf21bd2f1a956875`. Publication requires a
subsequent RG-governed release push and a successful run of all release gates:

- Linux lint, syntax, 1,046 unit tests and 299 smoke checks.
- Windows 1,046 unit tests and real Electron geometry/restore checks.
- Android 53 unit tests, lint and an isolated debug APK build.
- Packaged Windows LAN/firewall checks and Night Modes runtime qualification.
- Installer file integrity, 60 installed settings-layout checks, clean QA
  uninstall, portable ZIP entry integrity and distribution SHA-256 checksums.
- Clean source provenance and independent verification of downloaded CI assets
  before publication.

The release's attached `BUILD-MANIFEST.json` records its exact source commit,
locked Electron version, package-lock digest, runtime inventory and artifact
hashes. `SHA256SUMS.txt` names the downloadable installer and portable ZIP.
`WINDOWS-VERIFICATION.json` records installer and portable qualification.

## Additional local evidence

The packaged native desktop interaction gate passed startup, navigation,
shared start, Use Tonight, settings and active-run phases, capturing 51
screenshots. It performed zero real power actions. Packaged local companion
checks and all eight Night Modes checks also passed.
The same six-phase native gate also passed against the downloaded CI candidate,
capturing 51 screenshots from that exact runtime.

Two independent local Windows builds produced identical installer and portable
ZIP bytes and identical inventories of 614 runtime files. Installer QA matched
all 614 installed files, passed 60 layout checks and removed the QA installation
without changing production registration or user data.

The owned API 35 Android emulator passed ten phases, including precise-alarm
permission handling, WiZ acknowledgement/failure handling, saved routines,
calendar layouts, reboot alarm restoration before opening the app, screen-off
scheduled start/completion, duplicate occurrence handling and active timer
independence. The installed APK's SHA-256 matched the isolated build, and its
47 application inputs matched the committed source. Android DST tests use
historical Vancouver transitions so timezone-policy updates do not invalidate
the gap/overlap checks.

## Qualification limits

Android qualification is debug/emulator only. This Windows release includes
Android source, with no new production-signed APK. Production signing material
was not accessed. UDP stand-ins and emulator evidence do not prove physical
phone, router or bulb reliability. WiZ remains opt-in and experimental.

Quiet House, School Night, household-member management, focus scoring and
enforced screen-time limits remain deferred.
