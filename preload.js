const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('spawnVault', {
 checkUpdates: () => ipcRenderer.invoke('updates:check'),
 copyText: text => ipcRenderer.invoke('clipboard:write', text),
 openExternal: url => ipcRenderer.invoke('external:open', url),
 onBeforeClose: callback => ipcRenderer.on('app:before-close', callback),
 closeReady: () => ipcRenderer.send('app:close-ready')
});
