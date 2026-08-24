# Post-v11.1.2 tranche selection — portable folder layout

## Selected problem

The Windows portable ZIP currently places the unpacked Electron runtime directly at archive root. A normal extraction therefore spills hundreds of files into whichever directory the user chose instead of creating one recognizable `Lights Out` folder.

## Current reproduction

- The current `dist-native/Lights-Out-Portable-v11.1.2-win-x64.zip` has 577 entries whose first entries are `locales/*.pak` at archive root.
- Current packaging source uses `Compress-Archive -Path "$UnpackedDir\*"`, which intentionally omits the source folder itself.
- Phase A independently reproduced the same user-facing problem in the frozen public artifact as F-06. Phase B could provide guidance only; it did not change the frozen artifact.

Classification: **UX/COHERENCE IMPROVEMENT** based on a **REPRODUCED DEFECT** in distribution ergonomics.

## Why this outranks alternatives

This is the only remaining non-external Phase A finding with a concrete current source cause, direct end-user friction, a bounded correction, and deterministic local proof. GitHub visibility, live-site deployment, and updater discovery remain external. Physical QR-camera ergonomics remain manual observation rather than a reproduced defect. Previously remediated Phase B items are not reopened.

## Affected surface

- `electron/scripts/package-native-windows.ps1`
- a focused portable-ZIP writer and unit proof

## Non-goals

- Do not rebuild, replace, rename, or publish the frozen v11.1.2 ZIP.
- Do not change product runtime, updater behavior, release version, signing, or GitHub state.
- Do not create an installer or automatic in-place updater.

## Proof and rollback

Focused proof creates a three-file fixture, builds a ZIP, extracts it, requires exactly one top-level `Lights Out` folder, verifies nested bytes, and proves source immutability. Standard lint/unit/smoke follow, then the full Reality Gate local CI pipeline closes the tranche. Rollback point: CI canonicalization commit `4002e3ea364937f7f002abfb32c3e69e4978688b`.
