# Studio interface

The October 17 Studio pass replaces the desktop cockpit presentation with a
labelled sidebar, a dedicated clock card and a separate timer setup panel.
`electron/studio.css` loads after the existing component styles. The current
theme and accent still supply the palette. The main window uses quiet surfaces
and a simple wordmark instead of the old beam and particles. The shutdown truth
pill, settings save semantics and actual device status remain visible and retain
their meaning.

The sidebar expands at 1180px; smaller windows keep the compact navigation rail.
Short windows omit the decorative Tonight heading to preserve controls. Night
Modes uses larger two-column cards. Settings, Schedule, Devices and Proof share
the same typography and surfaces. These are presentation changes: they neither
enable integrations nor change timer or routine execution. Parked features are
unchanged. Mini and full-screen clock layouts retain their existing structure.

The standalone Android assets use their own `studio.css`. All four local pages
share a bottom navigation bar with icon/text labels and touch targets. Content
and sticky light-setting actions reserve space above it. Native timers, alarms,
notification consent and direct WiZ execution are unchanged.

Evidence is scoped in `review/LO-STUDIO-20261017/`: desktop renderer/native
packaging checks, phone Chromium fixture checks, and isolated Android debug
unit/lint/build results. A phone renderer fixture does not prove physical-phone
background behavior. This design work does not resolve the separate secured
pairing TLS integration gate or authorize remote publication.
