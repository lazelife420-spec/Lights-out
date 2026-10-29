# LO-SDH-1 — protected device identity and local pairing

This is local, unreleased engineering on Windows and standalone Android.
The application now has pairing and receiving screens and persistent protected
identities. Production LAN listening, connection establishment and discovery
remain disabled. The screens say so; opening a public invitation alone cannot
enable approval. Offline LO-RIE-1 files and independent timer engines still work.

## Identity custody

Windows uses current-user `CryptProtectData` / `CryptUnprotectData` directly,
through pinned Koffi 3.3.3 Node-API bindings. Only system Crypt32/Kernel32 DLLs
are loaded. UI prompts and machine-wide encryption scope are disabled. No child
process, owner credential file, signing key or plaintext fallback is involved.
Input and native output buffers are cleared and native allocations freed.

Electron 43's TLS provider requires PEM/Buffer private-key input and rejects
Node PrivateKeyObject input. A CNG non-exportable signer would need an additional
TLS integration, which this tranche does not invent. DPAPI is the bounded
alternative: private PEM exists briefly in main-process memory to configure TLS.
JavaScript strings and native TLS key objects cannot be reliably zeroed. This
does **not** make Windows keys hardware-backed, non-exportable, or protected
against malicious software running as the same Windows user.

Electron safeStorage was investigated and tested. Its profile master-key write
can lag an immediately saved identity; fast restart reproduced decryption loss.
The shipping handoff identity uses direct DPAPI and has no dependency on that
profile master key. No safeStorage ciphertext migration is needed: these were
new, isolated QA identities, never an earlier shipped format.

Windows certificates use standard P-256 ECDSA generation and @peculiar/x509
2.2.0 encoding. The one-year self-signed certificate is a path-length-zero
trust anchor, with digital-signature and certificate-signing usage, for packaged
Electron compatibility. A future transport must still verify the **exact leaf
fingerprint**; a descendant certificate signed by this anchor grants nothing.
No certificate is installed into an OS-wide trust store.

Android generates a non-exportable P-256 signing key inside AndroidKeyStore.
An X509ExtendedKeyManager returns that key handle and its certificate chain;
there is no PKCS12 export or plaintext key file. A separate AndroidKeyStore
AES-256/GCM key seals identity metadata and trust. Hardware/software protection
is reported from KeyInfo rather than assumed. These aliases are unrelated to
APK release signing. Replacement retires only aliases named by the previous
validated handoff marker; the first sealing alias remains as a loss marker.

Both implementations bind a public installation/fingerprint marker to one
authenticated protected record. Strict schemas, canonical records and bounded
reads reject missing, corrupt, mismatched or ambiguous storage. No `.bak`
recovery silently restores authority. Recovery requires explicit identity
replacement; trust is cleared and every peer must approve the new fingerprint.
Deleting an entire Windows profile is equivalent to a fresh installation and
requires explicit setup; it cannot recover old pairings.

References: [Microsoft DPAPI](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata),
[Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage),
[Node TLS](https://nodejs.org/docs/latest-v22.x/api/tls.html),
[Android Keystore](https://developer.android.com/privacy-and-security/keystore),
[Koffi output handling](https://koffi.dev/output),
[@peculiar/x509](https://github.com/PeculiarVentures/x509).

## Trust, time and authority

One sealed record contains peers, enrollment names/timestamps, revocation,
consumed invitations and live session tombstones. Writes are atomic and checked;
failed writes cannot grant persisted authority. At most 64 identities, 128
invitation entries, 128 session tombstones and eight connected/pending devices
are retained. Revoked identities stay visible; fresh explicit approval is
required to re-enroll. Replacing a peer atomically revokes its previous identity.

Primary controllers serialize native actions and received frames. Windows uses
the existing single-instance authority; Android uses one application singleton
and serialized executor. Their data and execution remain independent.

Invitations and transfers retain their two-minute expiration. Invitation parsing
allows a sender clock at most five seconds ahead, matching the existing frame
clock tolerance. Expired invitations are never accepted. Within a process,
monotonic elapsed time prevents clock rollback from extending validity. A sealed
highest wall time blocks significant rollback after restart. Correct clocks are
still required; this is not a trusted network-time system.

An attacker controlling the same user/app UID can tamper with process memory or
restore an earlier valid protected record. These platforms provide no app-level
rollback-resistant monotonic counter here. DPAPI/Keystore sealing protects
confidentiality/integrity at rest, not a fully compromised local authority.

## Visible enrollment and inbox

Windows Devices and Android Routines contain the same accessible pairing cards:
explicit identity setup/replacement, a short-lived public QR/link, unverified
invitation state, authenticated full-fingerprint approval/rejection, local device
names, saved/connected/revoked state and revocation. Android reuses the camera
scanner in a separate handoff mode and supports the public enrollment deep link.
Companion PC-control scanning remains separate. QR contains no address, token,
private key, routine, execution grant or existing companion secret.

Only a main/native transport can attach an actual authenticated TLS socket.
Renderer/native bridge messages cannot fabricate a proof or attach a socket.
There is no production socket factory/listener in these controllers.

Receiving follows distinct steps:

1. An enrolled recipient requests a fresh transfer challenge.
2. The connected sender explicitly offers selected existing routine intent.
3. The recipient explicitly accepts the offer for preview.
4. Existing LO-RIE-1 inspection shows capabilities and ID conflicts.
5. A separate save button creates inactive drafts, with an explicit copy policy
   for conflicting IDs. Adoption stays in the existing offline routine UI.

The inbox checks trust, live channel and expiration again when saving. Revocation
after preview blocks import, even through a direct native request. Interrupted
connections require a fresh session. Nothing in pairing/import invokes power,
lighting, timer start, calendar scheduling or execution callbacks.

## Qualification and next gate

The current local record is `review/LO-SDH-1-20261016/QUALIFICATION.json`.
Windows packaged UI and immediate DPAPI restart passed six cases. Desktop
qualification passed 1,119 tests and 299 smoke checks; Android passed 93 unit
tests, lint and isolated debug packaging with 70 exact source inputs.
Native Android-to-Electron TLS currently fails during the handshake in the
private emulator bridge. Cross-device runtime and API 28 qualification remain
open; **LO-SDH-1 does not have a complete local PASS**. A certificate-library
experiment did not resolve the failure and was removed. No review archive may
represent this gate as passed. Debug QA
uses source-only isolated Gradle projects and owned emulators, with production
signing properties absent and release-signing environment cleared.

The next separate tranche is bounded LAN connection establishment and physical
Android/Windows qualification: interface/address validation, listener lifecycle,
firewall handling, connection ownership, rate limits, QR optical scanning,
background/reconnect behavior and authorized physical-device tests. No cloud
service, remote execution, production signing or publication is added here.
