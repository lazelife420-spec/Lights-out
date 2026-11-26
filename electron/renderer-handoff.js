/* global api, HandoffUI, ReleaseGates */
(function(){
  'use strict';
  const section = document.getElementById('handoff-pairing');
  const container = document.getElementById('handoff-body');
  const enabled = typeof ReleaseGates !== 'undefined' && ReleaseGates.HANDOFF_PAIRING === true;
  const canMount = enabled && Boolean(container && typeof api !== 'undefined' && typeof api.handoffAction === 'function' && typeof HandoffUI !== 'undefined');
  if (section) {
    section.hidden = !canMount;
    if (!canMount) section.open = false;
  }
  if (!canMount) return;
  window.handoffUI = HandoffUI.mount(container, {
    platform: 'windows',
    invoke: (action, args) => api.handoffAction(action, args),
    onImported: () => void window.routineTransfer?.refresh()
  });
})();
