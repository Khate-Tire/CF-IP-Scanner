/* Copyright (c) 2026 Taher AkbariSaeed
 * Secure preload script — exposes a minimal IPC surface to the renderer
 * via contextBridge so we can keep contextIsolation:true + nodeIntegration:false.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Backend lifecycle
    onBackendReady: (cb) => {
        const listener = () => { try { cb(); } catch (_) { /* noop */ } };
        ipcRenderer.on('backend-ready', listener);
        return () => ipcRenderer.removeListener('backend-ready', listener);
    },
    getBackendUrl: () => ipcRenderer.invoke('get-backend-url'),

    // Debug log file (read in main process — renderer never touches fs)
    readLogFile: () => ipcRenderer.invoke('read-log-file'),

    // Auto-updater
    onUpdateAvailable: (cb) => {
        const listener = () => { try { cb(); } catch (_) { /* noop */ } };
        ipcRenderer.on('update_available', listener);
        return () => ipcRenderer.removeListener('update_available', listener);
    },
    onUpdateDownloaded: (cb) => {
        const listener = () => { try { cb(); } catch (_) { /* noop */ } };
        ipcRenderer.on('update_downloaded', listener);
        return () => ipcRenderer.removeListener('update_downloaded', listener);
    },
    restartApp: () => ipcRenderer.send('restart_app'),

    // Marker so renderer can detect Electron environment
    isElectron: true,
});
