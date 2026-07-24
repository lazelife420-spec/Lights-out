# Desktop UX functional gate

This is the second pre-commit source-runtime pass for the v11.1.2 Desktop
Consolidation closure lane.

- Runtime: the repository's Electron 43 executable
- Status: passed
- Screenshots: 25
- Phases: startup, top menu, shared start, Use Tonight, Settings, active run
- Real power actions: 0
- Uncaught renderer exceptions: 0

The gate used isolated user-data directories and Dry Run. It verified that
legacy Settings/Help routes migrate before first visible render, top menus work
with mouse and keyboard, all primary start gestures dispatch one canonical
payload, selected ready modes remain authoritative through restart and receipt
creation, Settings is a dedicated responsive workspace, and the active-run view
keeps Dry Run and timer controls prominent.

`report.json` contains the machine-readable assertions. Screenshot dimensions
and hashes are in `screenshot-manifest.json` and `SHA256SUMS.txt`.

The report's Git SHA is the pre-commit HEAD used as the starting point for the
dirty-tree source gate. Definitive packaged proof is generated only after the
reviewed source/proof commit and records its exact source commit separately.
