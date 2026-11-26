'use strict';

// Minimal preload for the floating desktop widget (widget.html).
// Exposes only the two widget-scoped APIs — never the full desktop IPC bridge.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onWidgetUpdate: (cb) => {
    if (typeof cb !== 'function') return () => {};
    const listener = (_event, data) => cb(data);
    ipcRenderer.on('widget-update', listener);
    return () => ipcRenderer.removeListener('widget-update', listener);
  },
  closeWidget: () => ipcRenderer.send('close-widget')
});
