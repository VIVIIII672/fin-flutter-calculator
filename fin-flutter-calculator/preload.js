'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('finStore', {
  get: (key) => ipcRenderer.invoke('store:get', String(key)),
  set: (key, value) => ipcRenderer.invoke('store:set', String(key), value)
});
