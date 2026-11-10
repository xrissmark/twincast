const { contextBridge, ipcRenderer } = require('electron');

function listen(channel, cb) {
  const handler = (_e, ...args) => cb(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('desktop', {
  getSources: () => ipcRenderer.invoke('get-sources'),
  selectSource: (id) => ipcRenderer.invoke('select-source', id),
  listAudioApps: () => ipcRenderer.invoke('list-audio-apps'),
  resolveSourceApp: (id) => ipcRenderer.invoke('resolve-source-app', id),
  startAudio: (targets) => ipcRenderer.invoke('start-audio', targets),
  stopAudio: (keys) => ipcRenderer.invoke('stop-audio', keys),
  addAudio: (targets) => ipcRenderer.invoke('add-audio', targets),
  onAudioEnded: (cb) => listen('audio-ended', cb),
  onAudioData: (cb) => listen('audio-data', cb),
  onAudioError: (cb) => listen('audio-error', cb),
  // Annotation overlay over the shared screen/window
  overlayOpen: (sourceId) => ipcRenderer.invoke('overlay-open', sourceId),
  overlaySend: (msg) => ipcRenderer.send('overlay-send', msg),
  overlayClose: () => ipcRenderer.invoke('overlay-close'),
  onOverlayMsg: (cb) => listen('overlay-msg', cb),
  // App version + automatic updates
  appInfo: () => ipcRenderer.invoke('app-info'),
  onUpdateStatus: (cb) => listen('update-status', cb),
  installUpdate: () => ipcRenderer.invoke('update-install'),
});
