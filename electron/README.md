# Lights Out - Electron Edition

A modern, native-like desktop application built with Electron. Features a cockpit-style dashboard UI with proper window controls, menus, and PowerShell backend integration.

## Agent Handoff

Before making code changes, read `..\AGENTS.md`.
It explains which runtime is authoritative for a task and what verification path to use afterward.

## Prerequisites

- **Node.js** 18+ (Download from https://nodejs.org/)
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

### Native Window
- ✅ Standard Windows frame (can be moved, resized, minimized)
- ✅ Native minimize/close buttons
- ✅ System tray integration
- ✅ Single instance lock

### Cockpit Dashboard UI
- **Timer Ring** - Visual countdown with progress ring
- **Quick Actions** - Start, pause, resume, snooze, cancel
- **Menu Bar** - Select power action, start presets, open settings, view help
- **Status Cards** - Selected action, end time, battery, power plan, warnings
- **Tabbed Section** - Library, Schedule, Clock, Countdown tabs
- **Tonight Picks** - Quick preset cards wired to action, duration, and force mode

### Power Integration
- Shutdown, Restart, Sleep, Hibernate
- Grace period and dry-run options
- Force shutdown capability
- Battery-aware warnings
- Run at login creates a lightweight startup entry that opens minimized and idle

## Project Structure

```
electron/
├── package.json          # Electron dependencies
├── main.js               # Main process (window, tray, IPC)
├── preload.js            # Secure IPC bridge
├── index.html            # Main UI
├── styles.css            # Dark cockpit theme
├── renderer.js           # Frontend logic
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

Output will be in `dist/` folder.

## How It Works

1. **Electron** creates the native window with HTML/CSS UI
2. **Electron main process** owns the timer state for pause, resume, snooze, cancel, tray, and taskbar progress
3. **PowerShell / Windows commands** handle system information and final power actions

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

Same as original Lights Out project.
