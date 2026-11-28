# Lights Out v11.3.5

Safety and reliability fixes. Nothing new to learn; a few things now behave
the way you would expect.

**The last seconds stay yours.** After a real countdown reaches zero, Lights
Out still has a few steps before it asks Windows to act (Last Light, lights
off, preparing Sleep). During those steps the window now keeps **Cancel
session** (Esc works too) and says what is next. A new start from the window,
your phone, a ritual, a routine or Autopilot can no longer quietly replace the
bedtime you set. Emergency Override now also cancels while Sleep or Hibernate
is being prepared, and if the PC slept through the final steps, the "too late,
nothing happens" check runs again right before the power request.

**Family remote keeps your pairing code private.** Family remote used to send
this PC's phone pairing code to any device on the network that announced
itself as another Lights Out PC. It no longer sends it. Because each PC has
its own code, controlling another PC never actually worked; those buttons now
say that PC-to-PC pairing is not available yet, and nothing is sent. Other
PCs on your network are still listed.

**"Tomorrow" fits.** In a window 1000 pixels wide or narrower, an end time
after midnight ("12:05 AM · tomorrow") stays on one line next to "Ends with"
in every theme, and the readiness strip stays above the footer.

**Quieter in the background.** Lights Out used to start two PowerShell
processes every 15 seconds all day, even with the phone companion off. It now
checks battery and power plan only while a phone is connected, never stacks
those checks, and every PowerShell call has a time limit.

**Tidier firewall.** Quitting now waits a moment for Lights Out's own
Companion firewall rules to be removed instead of leaving them behind.

**Safer backups.** Importing a backup can no longer switch on forced
shutdowns, Autopilot, the system-wide quick-start shortcuts or calendar
auto-start, or switch Test Mode off. A backup can still turn those off.

Assets: `Lights-Out-Setup-v11.3.5.exe`, `Lights-Out-Portable-v11.3.5-win-x64.zip`,
`SHA256SUMS.txt`, `BUILD-MANIFEST.json` and `WINDOWS-VERIFICATION.json`. Both
packages are unsigned.
