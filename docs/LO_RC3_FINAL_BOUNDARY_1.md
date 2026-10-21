# LO-RC3-FINAL-BOUNDARY-1

RC3 portable identity is directly proved on Windows in a disposable Sandbox,
without a harness path override: Electron 43.7.11 honors the supplied
`--user-data-dir`. Both userData and sessionData resolve to the sibling
`user-data`; settings, receipts and startup.log are written there. A second
instance with the same path yields its lock. Do not add a redundant setPath fix.

The successor is 11.2.1-rc.4, an unsigned internal candidate from a sealed dirty
source snapshot, not a committed public release. No owner profile migration,
Desktop installation, shortcut change or production promotion is performed.

New Wi-Fi blocking is disabled in the main-process lifecycle, including manual
Block IPC. This immutable build policy cannot be enabled through saved settings.
Denied blocks never call a provider, become pending, or trigger compensation.
There is no new network mutation to orphan after process loss. This is prevention,
not implemented durable recovery. Explicit user-requested restoration remains a
live action; it does not establish connectivity or recover an unknown old block.
Existing blocks from RC3/older builds require explicit recovery in that build or
at the router/adapter before switching; no journal or automatic retry is invented.

The existing serialized lifecycle is preserved for qualification and future work.
`unblockOnCancel=false` retains a confirmed block only on cancellation. Normal
completion always requests restoration. Uncertain/failed blocks are compensated;
failed restoration stays pending. Retained changes prevent subsequent completion
from passing the power gate until explicitly restored. No API acknowledgement
proves physical power or network outcome.

Supported power dispatch, receipt truth/legacy labels, clock logic, styles, lamp,
navigation, preload, profile and encryption implementations remain unchanged.
Focused fake-provider, process-recreation and guarded packaged checks supplement
the existing accepted evidence; full suites are not repeated.

Signing, clean committed release custody, owner promotion, credential downgrade
compatibility, physical power/resume, First Light wake and overnight acceptance
remain separate gates. Roll back by closing the isolated candidate and keeping
its sibling profile separate. Older builds cannot read newly encrypted fields;
never overwrite current history with a stale whole-profile backup.
