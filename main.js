const { app, BrowserWindow, clipboard, ipcMain, shell, dialog, powerMonitor } = require('electron');
const path = require('node:path');
const { autoUpdater } = require('electron-updater');
const { createUpdateService } = require('./updates');
let installingUpdate = false;


function createWindow() {
  const win = new BrowserWindow({
    width: 1180, height: 780, minWidth: 900, minHeight: 620,
    backgroundColor: '#151517',
    title: 'SpawnVault',
    icon: path.join(__dirname, 'assets', 'app-icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.loadFile('index.html');
  win.on('focus', () => updates.resume());
  let closeConfirmed = false;
  win.on('close', e => {
    if (installingUpdate || closeConfirmed || win.webContents.isDestroyed()) return;
    e.preventDefault();
    win.webContents.send('app:before-close');
    const fallback = setTimeout(() => { closeConfirmed = true; if (!win.isDestroyed()) win.close(); }, 2200);
    ipcMain.once('app:close-ready', event => { if(event.sender!==win.webContents)return; clearTimeout(fallback); closeConfirmed = true; if (!win.isDestroyed()) win.close(); });
  });
}
app.whenReady().then(() => {
  createWindow();
  updates.start();
  powerMonitor.on('resume', () => updates.resume());
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('clipboard:write', (_event, text) => {
  clipboard.writeText(String(text ?? ''));
  return true;
});
ipcMain.handle('external:open', (_event, url) => {
  if (typeof url === 'string' && /^https:\/\/[^ ]+$/i.test(url)) return shell.openExternal(url);
  throw new Error('URL inválido');
});
// Allow the renderer to sign out before the update closes application windows.
async function prepareForUpdateInstall() {
  installingUpdate = true;
  await Promise.all(BrowserWindow.getAllWindows().filter(win => !win.isDestroyed()).map(win => new Promise(resolve => {
    const finish = () => { clearTimeout(timer); ipcMain.removeListener('app:close-ready', ready); resolve(); };
    const ready = event => { if(event.sender === win.webContents) finish(); };
    const timer = setTimeout(finish,1800);
    ipcMain.on('app:close-ready',ready);
    win.webContents.send('app:before-close');
  })));
}
const updates = createUpdateService({
 app,autoUpdater,dialog,publish:require('./update-config.json'),
 beforeInstall:prepareForUpdateInstall,
 setProgress:value=>BrowserWindow.getAllWindows().forEach(win=>{if(!win.isDestroyed())win.setProgressBar(value);})
});
ipcMain.handle('updates:check',()=>updates.check({manual:true}));
