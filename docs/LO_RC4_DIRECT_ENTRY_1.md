# LO-RC4-DIRECT-ENTRY-1

RC4 bare-EXE startup was directly observed in Windows Sandbox without shared
folders: it used the disposable account's default AppData profile. Its wrapper
supplied a sibling profile. The former entry was therefore unsafe for isolated
owner-machine acceptance; no owner profile was accessed to establish this.

RC5 adds an early portable-only storage guard. Before any feature modules load,
it reads the build's package metadata. Unmarked installed/source editions do
nothing and retain their existing profile behavior. Portable staging uses
`scripts/stamp-portable-mode.cjs` to add `lightsOutDistribution: "portable"` only
to the staged package.json; the source/installed package stays unmarked. This
one documented build transform is included in source-to-payload provenance.

A marked portable verifies its complete folder/manifest and binds userData and
sessionData synchronously to sibling user-data, plus local logs. Bare and wrapper
entries share that profile. Matching --user-data-dir and existing First Light
arguments remain accepted; an empty, relative, conflicting or duplicate profile
argument is rejected. Missing markers, an invalid/unwritable profile or a profile
junction fail before settings/receipt imports; no AppData fallback or migration
is attempted. An actionable startup message directs re-extraction/launcher use.

Power dispatch, clock, UI, receipt semantics, Wi-Fi interdiction and launcher
lifetime are unchanged. Qualification is limited to guarded startup in disposable
Windows accounts, pure boundary tests and exact artifact hashes. It is not proof
of physical power, wake, devices, overnight or owner-host acceptance.

RC4 and the working Desktop/profile/shortcuts/rollback are untouched. No owner
profile was read, copied or rehashed in this tranche. To roll back isolated QA,
close RC5 and reopen frozen RC4 through its verified wrapper with a separate QA
profile. Bare RC4 remains unqualified. RC5 does not accept original-profile
binding via a conflicting CLI path; any future nightly integration requires a
separate explicit decision. Signing, clean commit, promotion and release remain
owner-controlled gates.
