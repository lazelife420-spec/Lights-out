# LO-SDH-0 — secured routine handoff foundation

This local engineering tranche implements protocol components and isolated
proofs. It does not enable a production listener, discovery, remote control,
device enrollment UI or persistent trust/key storage. Windows and standalone
Android still operate independently; offline LO-RIE-1 files remain available.

## Existing pairing and scope

`electron/companion.js` and Android `MainActivity`/`ScannerActivity` provide a
separate token-protected HTTP/WebSocket PC-control connection. That token and
its QR URLs are not handoff identities and must never enter this protocol.
Neither companion routes nor timer/action dispatch were changed.

`routineHandoff.js` and native `RoutineHandoff.kt` implement the same bounded
wire/state contract. The two inbox adapters call the existing LO-RIE-1 preview
and import functions. There are no timer, lighting, alarm, shell or power
callbacks in these components. Only isolated QA creates sockets/listeners.

## Enrollment and transport

Identity is the full lowercase SHA-256 fingerprint of a device's DER X.509 leaf
certificate. A QR-ready enrollment link contains only public identity, platform,
a random 128-bit one-use nonce and a maximum two-minute expiry:

`lightsout-handoff://enroll/v1?fingerprint=<64hex>&platform=windows&nonce=<32hex>&expires=<epoch-ms>`

Links contain no endpoint, private key, token or execution authority. Both owners
must confirm the full authenticated peer fingerprint on their own device. A
link alone does not enroll a peer: the matching peer must prove possession of
the certificate's private key through mutual TLS. Duplicate/unknown fields,
wrong identities, expired links and repeated enrollment nonces are rejected.
Certificate renewal/key rotation requires a new explicit enrollment.

Transport uses established platform TLS implementations: Node/OpenSSL and
Android/Java JSSE. Both sides present certificates, validate the pinned leaf
identities and require TLS 1.2/1.3 with the supported ECDHE-ECDSA/AES-GCM or
TLS 1.3 AES-GCM/ChaCha20 suites. Platform TLS supplies authentication,
confidentiality and record integrity; there is no custom cipher, key agreement,
signature scheme or application encryption. Production adapters must configure
normal trust/certificate validation plus the exact expected peer pin. The
isolated proofs use one-day synthetic identities and remove their private keys.

References: [Node TLS](https://nodejs.org/docs/latest-v22.x/api/tls.html),
[Android TLS guidance](https://developer.android.com/privacy-and-security/security-ssl),
[JSSE peer certificates](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/javax/net/ssl/SSLSession.html).

## Wire contract v1

Every frame starts with this 150-byte, big-endian header. The receiver bounds
the body before allocation and rejects truncation, trailing bytes and unsupported
versions/types/capabilities. TLS is required before any enrollment or frame
state transition; an ordinary object claiming a peer identity is insufficient.

| Offset | Bytes | Field |
| --- | --- | --- |
| 0 | 8 | ASCII `LOSDH001` |
| 8 | 1 | type: challenge 0, offer 1, accept 2, document 3 |
| 9 | 1 | sender platform: Windows 1, Android 2 |
| 10 | 2 | protocol version: 1 |
| 12 | 2 | negotiated capability: exactly 1, LO-RIE-1 intent files |
| 14 | 16 | recipient-generated random session challenge |
| 30 | 32 | sender certificate fingerprint |
| 62 | 32 | recipient certificate fingerprint |
| 94 | 8 | issued epoch milliseconds |
| 102 | 8 | expiry epoch milliseconds |
| 110 | 4 | offered UTF-8 file byte count, 1–262144 |
| 114 | 32 | SHA-256 of the exact offered file |
| 146 | 4 | body byte count |
| 150 | variable | document bytes; other frame types have no body |

Challenge frames use offered length 1 and an all-zero digest as sentinels.
The offer replaces those two fields with actual file metadata. A challenge's
version/capability and the response must agree; unknown/future capabilities
fail closed. This negotiates interchange compatibility, not execution support.
Per-platform action availability is disclosed by the established file preview.

## State and consent

1. An enrolled recipient requests a session by issuing a fresh challenge on its
   authenticated channel. At most eight sessions may be pending.
2. The sender validates the file with LO-RIE-1 and offers its digest/size against
   that exact challenge. The recipient checks the same live channel, both peer
   identities, platform, capability and expiry. No preview or write occurs yet.
3. The recipient explicitly confirms this peer and offer. The sender accepts
   only that matching acceptance and releases the document once.
4. The recipient verifies exact length, digest, strict UTF-8 and LO-RIE-1 schema
   before invoking the existing read-only import preview.
5. A separate local recipient confirmation may save the preview as inactive
   intent through the existing import store. Default conflicts reject; an
   explicit copy choice uses LO-RIE-1 identity/reference remapping. Save failure
   retains the preview for a safe explicit retry. Adoption and rule activation
   still require the existing separate local application controls.

Session state is tied to the authenticated socket object. Old offers cannot
enter a restarted recipient without its new challenge. Repeated offer/accept/
document messages and cancelled/unknown sessions fail. Nonces are retained until
expiry, with a bounded 128-entry limit; exhaustion rejects new sessions rather
than evicting live replay protection. Interruptions require a fresh session and
consent; no transfer resumption or automatic reconnect/import is implemented.

Revocation is checked at every transition and again before local import, so
already-previewed documents cannot be saved through a revoked session. Sessions
and previews expire at the original two-minute deadline (not a renewed preview
deadline). Wall-clock validity assumes a reasonably correct trusted device
clock; inbound issuance allows at most five seconds of skew. No claimed success
means adoption, execution or remote delivery acknowledgement: outcomes are
offer, acceptance, preview, and local inactive import only.

## Qualification and remaining work

Node tests exercise real mutual TLS, enrollment, framing, replay, corruption,
wrong identities, revocation, expiry, interruption, limits, conflicts and import
failure. The isolated loopback proof exchanges actual frames between Node and
the Kotlin/JCA implementation in both directions. The JVM recipient uses a
golden-document validator/preview callback; separate owned-emulator
instrumentation exercises the real native LO-RIE parser, preview and phone store.
Neither proof establishes physical phone/Wi-Fi reliability.

Future product work must provide OS-protected device identities, persistent
owner-approved trust and revocation, visible enrollment/transfer consent,
connection policy, cancellation/timeouts, and field qualification. The current
in-memory coordinator assumes serialized calls; future network workers must
marshal state transitions onto one authority thread. No bridge remotely exposes
the local `save`/adopt controls. The transport is disabled by absence of any
production wiring, not by a setting that a received file could change.

Parked product features, existing timers and the companion PC-control security
boundary remain unchanged. Evidence is in `review/LO-SDH-0-20261016/`.
