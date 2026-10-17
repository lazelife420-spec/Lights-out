# Local WiZ timer modes and notification beacons

Room Hourglass, Orbit and Ember are opt-in WiZ experiences on Windows and
standalone Android. They require explicitly selected local lights. They do not
need cloud services, handoff pairing or a running PC for phone operation.
These are new local development features, not a published release or a claim
of exclusive features unavailable in other products.

| Mode | Behavior |
| --- | --- |
| Room Hourglass | Selected lights fade toward amber in sequence as time passes. |
| Orbit | A slow, 24-second cool accent travels across the lights and lands in amber. |
| Ember | A warm, 12-second breathing glow gradually settles to the minimum level. |

Frames follow the existing timer's remaining time. Pause freezes the animation;
resume and added time use that device's timer. Experience frames stay within
10–60% brightness and contain no power-on field. Windows retains its existing
end-of-timer lighting behavior. Android restores its own prior lighting intent;
a routine's explicit lights-off-at-end behavior retains priority.

Windows Settings → Lighting contains the three WiZ modes, a screen-only preview
and a separate, default-off soft blue beacon for the final six seconds. Existing
provider verification and selected lights/room controls apply. Other providers
do not advertise or execute these WiZ experiences.

Android Lighting contains the same screen-only preview and independently saved
selections for timer lights and alert lights. It has separate switches for:

- Phone timer completion/reminder beacons.
- Selected phone-app notification beacons.

App beacons require both the local switch/app allowlist and an explicit Android
notification-access grant. The button opens Android's permission settings; the
app never grants itself access. Eligible apps come from visible launcher apps;
no QUERY_ALL_PACKAGES permission is requested. The listener uses package name,
notification identifier and ongoing/group-summary flags. It never reads extras,
titles or message text, saves content, or forwards notifications elsewhere.
Own-app and ongoing/group-summary notifications are ignored. Repeated IDs are
deduplicated for a minute; app beacons have a global 30-second cooldown.

Beacons use a finite six-second soft blue envelope. They capture only lights
already on and restore prior settings only while the light remains on and still
matches the app's last change. Manual phone commands share per-light locks and
invalidate the animation's ownership. An off from WiZ releases the light for
the timer run; failed or unreachable lights are skipped rather than repeatedly
written from stale snapshots. No effect frame or restoration sets `state:true`.

Phone effects run alongside the existing foreground timer and AlarmManager
engine; they do not replace either. Work is serialized and bounded, with short
wake locks and no indefinite notification animation. Timer, app-alert and
permission consent stay local; routine-file import cannot enable these settings.

## Evidence and limits

Local qualification records live in `review/LO-LIGHT-1-20261016/`. Desktop unit,
smoke, lint and packaged UI checks cover the actual main/preload/renderer and
WiZ UDP adapter. Android debug QA uses source-only isolated projects and an
owned emulator, a separate synthetic notification app, the actual OS notification
listener and a UDP bulb simulator bound to loopback. These tests do not operate
physical bulbs or read personal notification contents. Production signing and
remote publication are outside this tranche.

Physical WiZ firmware behavior, RGB capability, phone background restrictions,
router connectivity and long-duration battery impact remain field-unproven.
The independent LO-SDH-1 native cross-device TLS gate remains open; these local
lighting features do not claim to resolve or depend on it.
