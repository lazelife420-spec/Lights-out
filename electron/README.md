# Lights Out: Windows desktop app

The Windows desktop app for Lights Out, the bedtime system for Windows. It is built with Electron: a frameless cockpit window with its own controls, a tray menu, and Windows system calls made from the main process.

## Agent Handoff

Before making code changes, read `..\AGENTS.md`.
It explains which runtime is authoritative for a task and what verification path to use afterward.

## Prerequisites

- **Node.js** 22.13.0+ (Download from https://nodejs.org/)
- **Windows 10/11**
- PowerShell 5.1+

## Quick Start

### Option 1: Run with Batch File (Easiest)
```batch
# In File Explorer, navigate to: Lights Out\electron\
# Double-click: run-electron.bat
```

### Option 2: Run from PowerShell/Terminal
```powershell
cd electron
npm ci
npm run electron:provision
npm run electron:verify
npm start
```

Electron 42+ installs the JavaScript package during `npm ci` and downloads the
native Electron binary only through its explicit official installer. Run
`npm run electron:provision` before Electron runtime, smoke, or packaging
commands in fresh worktrees and CI. This is an explicit setup step, not an
automatic `postinstall` hook.

## Features

### Window
- Frameless window with in-page mini mode, minimize, maximize and close-to-tray controls (can be moved and resized)
- System tray menu: start 28 min / 1 hour, pause, snooze, cancel, quit
- Taskbar (Windows): progress, plus a badge on the app button while a run is active (amber = Test Mode, rose = a REAL action, the tray dot's colours; a pause sign while paused) and Pause/Resume, Snooze +5 min and Cancel buttons in the window thumbnail. After the countdown ends only Cancel stays, until the power request is sent; idle clears both (`taskbarPresence.js`, images pre-rendered by `npm run icons`)
- Single instance lock
- No application menu bar; the tray menu and the sidebar are the navigation

### Cockpit Dashboard UI
- **Sidebar pages** - Tonight, Night Modes, Schedule, Devices, Proof, Settings, About
- **Timer Ring** - Visual countdown with progress ring. While idle the ring (or analog face) is also a slider for tonight's duration: drag up for longer and down for shorter (about 1 min per 6 px, `Shift` for 5 min steps), scroll it, or focus it and use the arrow keys, `PageUp`/`PageDown`, `Home`/`End`; pressing Escape during a drag puts the duration back. It writes through the same path as the -/+ stepper (`tonightDial.js`, `applyTonightDuration`), never starts or changes a run, and is inert during a run, a ritual, mini mode, the fullscreen clock, before settings load and while a Schedule › One night only time sets the end
- **Quick Actions** - Start, pause, resume, snooze, cancel
- **Status** - Tonight's plan shows the ending and end time; the Devices page shows battery, power plan, lights, Wi-Fi Guard and phone status
- **Night Modes** - Declarative mode cards and My Modes; choosing one never starts it

### Power Integration
- Shutdown, Restart, Sleep, Hibernate, Lock, Log out
- Grace period and Test Mode (a rehearsal that skips the power action and all automatic effects)
- Force shutdown capability (opt-in, Shutdown/Restart only)
- Battery-aware warnings
- Run at login creates a lightweight startup entry that opens minimized and idle

### Keyboard shortcuts
- `Ctrl+Shift+X` cancels from anywhere, including during Last Light, until the power request is sent. `Esc` cancels a running or paused countdown when the window has focus, but it closes an open dialog or panel first, or leaves a focused field (the renderer `keydown` handler): at the imminent-action warning (`#warning-modal`) `Esc` only closes the warning and the countdown keeps going, so use its **Cancel timer** button or `Ctrl+Shift+X`
- `Ctrl+Shift+Space` pause/resume, `Ctrl+Shift+Z` snooze, `Ctrl+Shift+S` show/hide the window, `Ctrl+Shift+P` preview Last Light, `Ctrl+Shift+W` widget. There is no global alarm shortcut: set First Light in Settings > Automations
- The quick-start hotkeys `Ctrl+Shift+L` and `Ctrl+Shift+1`..`4` start real timers from inside other apps, so they are off by default (`app.globalQuickStartShortcuts: false` in settings.json; read at launch). Quit Lights Out (tray > Quit) before editing settings.json, then start it again: the app rewrites the file from memory while it runs, so an edit made while it is open is lost. Portable builds keep it at `<extracted folder>\user-data\settings.json`

### Data and network safety
- **Export all data** writes settings, streaks and modes without credentials, the companion pairing token or an in-flight timer (`settings.js` `exportSnapshot`); import keeps this PC's credentials and pairing token and never restores a timer
- **Wi-Fi Guard** is experimental and off by default. `wifiGuardLifecycle.js` writes a credential-free recovery record (provider + adapter GUID, `userData\wifi-guard-recovery.json`) before any network change and clears it only after a confirmed restore; if the record cannot be written, no change is requested. Quit restores first (bounded to 8 s) and startup restores a block a crashed session left, or notifies when the user chose to keep it. This is unit-tested only; physical router/adapter behaviour is not qualified
- A real countdown whose deadline passed more than 5 minutes earlier (the PC slept through it) ends as `missed`; no power action is requested

## Project Structure

```
electron/
├── package.json          # Electron dependencies
├── main.js               # Main process (window, tray, IPC)
├── preload.js            # Secure IPC bridge
├── index.html            # Main UI
├── styles.css            # Dark cockpit theme
├── renderer.js           # Frontend logic
├── native/               # WindowsSuspend.cs (Sleep/Hibernate helper source)
├── run-electron.bat      # Easy launcher
└── README.md             # This file
```

## Building Executable

To create a standalone `.exe`:

```bash
cd electron
npm ci
npm run electron:provision
npm run build
```

Output will be in `../dist-native/` (`Lights-Out-Setup-v<version>.exe`, `Lights-Out-Portable-v<version>-win-x64.zip`, `SHA256SUMS.txt`, and `BUILD-MANIFEST.json`).

## How It Works

1. **Electron** creates the native window with HTML/CSS UI
2. **Electron main process** owns the timer state for pause, resume, snooze, cancel, tray, and taskbar progress
3. **PowerShell** calls (`child_process`) read system information such as battery and power plans
4. **Final power actions**: Shutdown, Restart and Log out run `shutdown.exe`, Lock runs `rundll32 user32.dll,LockWorkStation` (`powerActionDispatcher.js`). Sleep and Hibernate run only through the bundled `native/WindowsSuspend.exe` helper (`windowsSuspend.js`), a small .NET Framework 4.x program built from `native/WindowsSuspend.cs` that calls `SetSuspendState`. It checks Windows' power capabilities before and right before the request; Hibernate needs S4 and a full hibernation file. An unavailable state is recorded as **blocked** and nothing runs; there is no fallback to `rundll32`, Sleep or Shutdown. Receipts record what was requested; the physical Windows outcome stays unverified.

## Troubleshooting

### "Node.js not found"
Install Node.js from https://nodejs.org/ and restart your terminal.

### "npm install fails"
Run PowerShell as Administrator and try again, or check your internet connection.

### Window won't show
Check the console for errors. Press `Ctrl+Shift+I` in the window to open DevTools.

### Companion and Windows Firewall

Same Wi-Fi mode attempts to create two inbound rules in the **Lights Out Companion** rule group. They are restricted to the current executable, the Private profile, TCP on the configured companion port, and UDP discovery on port 58733. Lights Out never requests elevation; if Windows denies the change, the app reports that firewall access is unverified and tells the user which executable must be allowed.

Changing the companion port replaces only rules in that app-owned group. Turning the companion off removes only that group. An uninstall cannot reliably run application cleanup, so rules may remain after uninstall; remove the **Lights Out Companion** group manually in Windows Defender Firewall if the app is no longer installed. Portable builds may extract to a different executable path after an update and therefore may require a newly approved private-network rule.

## Development

Edit these files to customize:
- `styles.css` - Colors, layout, animations
- `index.html` - UI structure
- `renderer.js` - Frontend behavior
- `main.js` - Window behavior, system integration

## License

MIT, © 2026 The Proof Foundry. See [`LICENSE`](../LICENSE) in the repository root.
