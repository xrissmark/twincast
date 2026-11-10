// Desktop app: same web client, plus
//  - a window/screen picker (desktopCapturer)
//  - per-application audio capture via bin/apploopback.exe (window's app, all, all but Discord, or picked apps)
//  - a transparent overlay that shows viewers' marks on the sharer's real screen
//  - automatic updates from GitHub Releases (electron-updater)
//  It connects to a separate TwinCast server (see server/).
const { app, BrowserWindow, ipcMain, desktopCapturer, session, protocol, net, shell, screen } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');
const { pathToFileURL } = require('url');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const HELPER = [
  path.join(process.resourcesPath || '', 'bin', 'apploopback.exe'),
  path.join(__dirname, '..', 'bin', 'apploopback.exe'),
].find((p) => fs.existsSync(p));

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Renamed from ScreenShare: on first run, bring over the saved settings (server address,
// language, sound choices...) from the old settings folder.
try {
  const oldDir = path.join(app.getPath('appData'), 'screenshare');
  const newDir = app.getPath('userData');
  // (The new folder may already exist: the app creates it at startup. What matters is that
  // it has no saved data yet.)
  if (oldDir.toLowerCase() !== newDir.toLowerCase() && fs.existsSync(path.join(oldDir, 'Local Storage')) && !fs.existsSync(path.join(newDir, 'Local Storage'))) {
    fs.cpSync(oldDir, newDir, { recursive: true, filter: (src) => !/[\\/](Cache|Code Cache|GPUCache|DawnCache|blob_storage)([\\/]|$)/i.test(src) });
  }
} catch {}

// Only one copy of the app: a second launch just focuses the existing window
// (two copies would fight over the audio capture).
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

let win = null;
let pendingSourceId = null;
const captures = new Map(); // key -> child process

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 860, minWidth: 720, minHeight: 500,
    backgroundColor: '#0f1115', title: 'TwinCast', autoHideMenuBar: true, icon: path.join(PUBLIC_DIR, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadURL('app://local/index.html');
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('closed', () => { stopAudio(); closeOverlay(); win = null; });
}

const fromApp = (e) => e.senderFrame && e.senderFrame.url.startsWith('app://local/');

function runHelper(args) {
  return new Promise((resolve, reject) => {
    if (!HELPER) return reject(new Error('apploopback.exe not found - run "npm run build:native"'));
    execFile(HELPER, args, { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      if (err && !stdout) return reject(err);
      try { resolve(JSON.parse(stdout)); } catch (e) { reject(e); }
    });
  });
}

// ---- Annotation overlay ------------------------------------------------------------
// A transparent, click-through window placed exactly over what is being shared, so the
// sharer sees viewers' marks on their real screen. setContentProtection() hides it from
// screen capture (Windows 10 2004+), so viewers don't get the marks twice in the video.
let overlay = null, tracker = null;
const CAN_EXCLUDE_FROM_CAPTURE = process.platform === 'win32' && Number(os.release().split('.')[2]) >= 19041;

function closeOverlay() {
  if (tracker) { tracker.kill(); tracker = null; }
  if (overlay && !overlay.isDestroyed()) overlay.destroy();
  overlay = null;
}

async function openOverlay(sourceId) {
  closeOverlay();
  if (!CAN_EXCLUDE_FROM_CAPTURE) return false;
  let bounds = null, hwnd = null;
  if (sourceId.startsWith('screen:')) {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
    const src = sources.find((s) => s.id === sourceId);
    const display = screen.getAllDisplays().find((d) => src && String(d.id) === String(src.display_id)) || screen.getPrimaryDisplay();
    bounds = display.bounds;
  } else {
    const m = /^window:(\d+):/.exec(sourceId);
    if (!m || !HELPER) return false;
    hwnd = m[1];
  }
  const ov = new BrowserWindow({
    ...(bounds || { width: 10, height: 10 }), show: false, frame: false, transparent: true, backgroundColor: '#00000000',
    resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
    focusable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: !hwnd, title: 'TwinCast marks',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  overlay = ov;
  ov.setIgnoreMouseEvents(true);
  ov.setContentProtection(true);
  if (!hwnd) ov.setAlwaysOnTop(true, 'screen-saver');
  await ov.loadURL('app://local/overlay.html');
  if (overlay !== ov) return false; // closed while loading
  if (!hwnd) { ov.setBounds(bounds); ov.showInactive(); return true; }

  // Window share: the helper reports the window's position and keeps the overlay
  // just above it in the window stack (so other windows on top hide the marks too).
  const handle = ov.getNativeWindowHandle();
  const ovHwnd = (handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0))).toString();
  const child = spawn(HELPER, ['track', '--hwnd', hwnd, '--overlay', ovHwnd, '--parent', String(process.pid)], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  tracker = child;
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line || overlay !== ov || ov.isDestroyed()) continue;
      let r; try { r = JSON.parse(line); } catch { continue; }
      if (r.gone || r.min || r.w <= 0 || r.h <= 0) { ov.hide(); continue; }
      ov.setBounds(screen.screenToDipRect(null, { x: r.x, y: r.y, width: r.w, height: r.h }));
      if (!ov.isVisible()) ov.showInactive();
    }
  });
  child.on('exit', () => { if (tracker === child) tracker = null; });
  return true;
}

function stopAudio() {
  for (const p of captures.values()) p.kill();
  captures.clear();
}

app.whenReady().then(() => {
  protocol.handle('app', async (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(pathname)));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return new Response('Forbidden', { status: 403 });
    // no-cache: after an app update the window must not keep running old page files.
    const res = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(res.headers);
    headers.set('Cache-Control', 'no-cache');
    return new Response(res.body, { status: res.status, headers });
  });

  // getDisplayMedia() -> use the source the user chose in our picker.
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } });
      const source = sources.find((s) => s.id === pendingSourceId);
      pendingSourceId = null;
      if (!source) return callback({});
      callback({ video: source });
    } catch { callback({}); }
  });
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => {
    cb(['media', 'display-capture', 'clipboard-sanitized-write', 'fullscreen'].includes(permission) && (details.requestingUrl || '').startsWith('app://local/'));
  });

  ipcMain.handle('get-sources', async (e) => {
    if (!fromApp(e)) return [];
    const sources = await desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true });
    const ownId = win ? win.getMediaSourceId() : '';
    return sources
      .filter((s) => s.id !== ownId && !(s.id.startsWith('window:') && s.thumbnail.isEmpty()))
      .map((s) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL(), appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null }));
  });
  ipcMain.handle('select-source', (e, id) => { if (fromApp(e)) pendingSourceId = String(id); });

  ipcMain.handle('list-audio-apps', async (e) => {
    if (!fromApp(e)) return [];
    const apps = await runHelper(['list']);
    // Never list this app or its own capture helpers (they show up as audio sessions too).
    return apps.filter((a) => a.pid !== process.pid && !/^electron\.exe$|^twincast|^screenshare|^apploopback\.exe$/i.test(a.name));
  });
  ipcMain.handle('resolve-source-app', async (e, sourceId) => {
    if (!fromApp(e)) return null;
    const m = /^window:(\d+):/.exec(sourceId);
    return m ? runHelper(['resolve', '--hwnd', m[1]]) : null;
  });

  // A capture target: { key, pid } = that app (and its child processes);
  // { exclude: true } = everything except it; { self: true } = this app itself, used
  // with exclude for "Share all" so friends' streams playing here are never sent back.
  function startCapture(wc, t) {
    const key = String(t.key);
    if (captures.has(key)) return;
    const pid = t.self ? process.pid : Number(t.pid);
    const args = ['capture', '--pid', String(pid), '--parent', String(process.pid)];
    if (t.exclude) args.push('--exclude');
    const child = spawn(HELPER, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    captures.set(key, child);
    child.stdout.on('data', (chunk) => { if (!wc.isDestroyed()) wc.send('audio-data', key, chunk); });
    child.stderr.on('data', (d) => {
      const text = d.toString();
      if (/ERROR/.test(text) && !wc.isDestroyed()) wc.send('audio-error', key, text.trim());
    });
    child.on('exit', () => {
      if (captures.get(key) === child) captures.delete(key);
      if (!wc.isDestroyed()) wc.send('audio-ended', key); // e.g. the app was closed
    });
  }
  ipcMain.handle('start-audio', (e, targets) => {
    if (!fromApp(e) || !HELPER) throw new Error('Audio helper not available');
    for (const t of targets) startCapture(e.sender, t);
  });
  // Add more apps to a running share ("All but Discord" picks up apps that start later).
  ipcMain.handle('add-audio', (e, targets) => {
    if (!fromApp(e) || !HELPER) return;
    for (const t of targets) startCapture(e.sender, t);
  });
  // stop-audio(keys): stop those captures only; without keys: stop all.
  ipcMain.handle('stop-audio', (e, keys) => {
    if (!fromApp(e)) return;
    if (!Array.isArray(keys)) return stopAudio();
    for (const k of keys) { const c = captures.get(String(k)); if (c) { c.kill(); captures.delete(String(k)); } }
  });

  ipcMain.handle('overlay-open', (e, sourceId) => (fromApp(e) ? openOverlay(String(sourceId)) : false));
  ipcMain.handle('overlay-close', (e) => { if (fromApp(e)) closeOverlay(); });
  ipcMain.on('overlay-send', (e, msg) => {
    if (fromApp(e) && e.sender === (win && win.webContents) && overlay && !overlay.isDestroyed()) overlay.webContents.send('overlay-msg', msg);
  });

  ipcMain.handle('app-info', (e) => (fromApp(e) ? { version: app.getVersion(), update: updateStatus } : null));
  ipcMain.handle('update-install', (e) => { if (fromApp(e)) installUpdate(); });

  createWindow();
  setupUpdates();
});

// ---- Updates ---------------------------------------------------------------------------
// The installed app checks GitHub Releases (xrissmark/twincast) on start and every 4 hours,
// downloads a newer version in the background, then the page offers "Restart to update".
// If the user doesn't restart, it installs the next time they close the app.
// TWINCAST_UPDATE_URL=<folder url> points it at a plain web folder instead (for testing).
let updater = null;
let updateStatus = null;
function tellUpdate(status) {
  updateStatus = status;
  if (win && !win.isDestroyed()) win.webContents.send('update-status', status);
}
function setupUpdates() {
  const testUrl = process.env.TWINCAST_UPDATE_URL;
  if (!app.isPackaged && !testUrl) return; // running from source: nothing to update
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch { return; }
  updater = autoUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;
  if (testUrl) autoUpdater.setFeedURL({ provider: 'generic', url: testUrl });
  let version = null;
  autoUpdater.on('update-available', (info) => { version = info.version; tellUpdate({ state: 'downloading', version, percent: 0 }); });
  autoUpdater.on('download-progress', (p) => tellUpdate({ state: 'downloading', version, percent: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (info) => tellUpdate({ state: 'ready', version: info.version }));
  autoUpdater.on('error', (err) => {
    console.warn('update check failed:', err && err.message);
    if (updateStatus && updateStatus.state === 'downloading') tellUpdate(null); // try again next check
  });
  const check = () => { if (!updateStatus || updateStatus.state !== 'ready') autoUpdater.checkForUpdates().catch(() => {}); };
  setTimeout(check, 5000);
  setInterval(check, 4 * 3600e3).unref();
}
function installUpdate() {
  if (!updater || !updateStatus || updateStatus.state !== 'ready') return;
  stopAudio(); closeOverlay();
  // silent install, then start TwinCast again
  setImmediate(() => updater.quitAndInstall(true, true));
}

app.on('window-all-closed', () => { stopAudio(); closeOverlay(); app.quit(); });
