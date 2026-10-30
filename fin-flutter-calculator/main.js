'use strict';
const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'app');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.gz': 'application/gzip',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

// 在本機（只綁 127.0.0.1）提供 app 資料夾，讓文字辨識的 Worker 能正常載入檔案
function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        let rel = decodeURIComponent(req.url.split('?')[0]);
        if (rel === '/') rel = '/index.html';
        const file = path.normalize(path.join(ROOT, rel));
        if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
        fs.readFile(file, (err, data) => {
          if (err) { res.writeHead(404); res.end('Not found'); return; }
          res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
          res.end(data);
        });
      } catch (e) {
        res.writeHead(400); res.end();
      }
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

let server = null;

// 存檔放在使用者資料夾的 JSON 檔（本機伺服器的連接埠每次不同，localStorage 會遺失）
const STORE_KEYS = new Set(['snapshots', 'prefs']);
function storeFile() { return path.join(app.getPath('userData'), 'store.json'); }
function readStore() {
  try { const o = JSON.parse(fs.readFileSync(storeFile(), 'utf8')); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; }
}
ipcMain.handle('store:get', (_e, key) => (STORE_KEYS.has(key) ? (readStore()[key] ?? null) : null));
ipcMain.handle('store:set', (_e, key, value) => {
  if (!STORE_KEYS.has(key)) throw new Error('unknown key');
  const o = readStore(); o[key] = value;
  fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
  fs.writeFileSync(storeFile(), JSON.stringify(o));
  return true;
});

async function createWindow() {
  server = await startServer();
  const port = server.address().port;
  const win = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 380,
    minHeight: 600,
    title: '鰭片顫振計算器',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.js') }
  });
  Menu.setApplicationMenu(null);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('http://127.0.0.1:' + port + '/')) e.preventDefault();
  });
  win.loadURL('http://127.0.0.1:' + port + '/index.html');
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => { if (server) server.close(); app.quit(); });
}
