'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/* ------------------------------------------------------------------ *
 * Diagnostics hook. Enabled only when the smoke-test harness sets
 * CS_SMOKE, so production runs stay silent. Errors are forwarded with
 * their stack so the harness can report them precisely.
 * ------------------------------------------------------------------ */
if (process.env.CS_SMOKE) {
  window.addEventListener('error', (e) => {
    ipcRenderer.send('smoke:error', (e.error && e.error.stack) || e.message);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    ipcRenderer.send('smoke:error', 'unhandledrejection: ' + ((reason && reason.stack) || String(reason)));
  });
}

/* ------------------------------------------------------------------ *
 * Main application bridge (window.cs)
 * ------------------------------------------------------------------ */
contextBridge.exposeInMainWorld('cs', {
  platform: process.platform,
  version: process.versions.electron,

  /* real app name + version, for the About box and the update notice */
  app: {
    info: () => ipcRenderer.invoke('app:info')
  },

  /* window controls */
  win: {
    minimize: () => ipcRenderer.send('win:minimize'),
    toggleMaximize: () => ipcRenderer.send('win:maximize'),
    close: () => ipcRenderer.send('win:close'),
    onState: (cb) => {
      const h = (_e, s) => cb(s);
      ipcRenderer.on('win:state', h);
      return () => ipcRenderer.removeListener('win:state', h);
    }
  },

  /* files */
  file: {
    openImage: () => ipcRenderer.invoke('file:openImage'),
    openText: (opts) => ipcRenderer.invoke('file:openText', opts),
    save: (opts) => ipcRenderer.invoke('file:save', opts),
    exportPng: (opts) => ipcRenderer.invoke('file:exportPng', opts),
    openPath: (p) => ipcRenderer.invoke('file:openPath', p)
  },

  clipboard: {
    writeText: (t) => ipcRenderer.invoke('clipboard:writeText', t),
    readText: () => ipcRenderer.invoke('clipboard:readText')
  },

  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url)
  },

  /* screen colour picker (eyedropper) */
  picker: {
    start: () => ipcRenderer.invoke('picker:start')
  },

  /* auto-update — the request itself happens in the main process (updater.js);
   * this is only a doorbell in both directions. */
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    status: () => ipcRenderer.invoke('update:status'),
    onStatus: (cb) => {
      const h = (_e, s) => cb(s);
      ipcRenderer.on('update:status', h);
      return () => ipcRenderer.removeListener('update:status', h);
    }
  }
});

/* ------------------------------------------------------------------ *
 * Eyedropper overlay bridge (window.pickerApi)
 * ------------------------------------------------------------------ */
contextBridge.exposeInMainWorld('pickerApi', {
  onInit: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('picker:init', h);
    return () => ipcRenderer.removeListener('picker:init', h);
  },
  pick: (color) => ipcRenderer.send('picker:pick', color),
  cancel: () => ipcRenderer.send('picker:cancel')
});
