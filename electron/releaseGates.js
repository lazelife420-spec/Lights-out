/* Release gates for features whose source ships in the tree but which are not
 * qualified for a public release.
 *
 * HANDOFF_PAIRING (LO-SDH-1 secured device routine pairing): the native
 * Android-to-Electron TLS handshake does not have a complete local PASS
 * (docs/SECURED_DEVICE_PAIRING_V1.md). Until it is qualified, the desktop app
 * exposes no pairing UI, never initializes the handoff controller or TLS
 * listener, and refuses every handoff-action IPC call. Flip this only in a
 * release that carries its own LO-SDH-1 qualification evidence.
 */
(function(root, factory) {
  const gates = factory();
  if (typeof module === 'object' && module.exports) module.exports = gates;
  else root.ReleaseGates = gates;
})(typeof globalThis === 'object' ? globalThis : this, function() {
  'use strict';
  return Object.freeze({
    HANDOFF_PAIRING: false,
    HANDOFF_UNAVAILABLE_MESSAGE: 'Secure routine pairing is not available in this release.'
  });
});
