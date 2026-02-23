const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');
const http = require('http');

let mainWindow;
let pythonProcess;
let tray = null;
let isQuitting = false;

// ─── Log File ───
const logPath = path.join(app.getPath('userData'), 'backend.log');
function log(msg) {
    const ts = new Date().toISOString();
    const line = `[${ts}] ${msg}\n`;
    console.log(msg);
    try { fs.appendFileSync(logPath, line); } catch (e) { }
}

function createWindow() {
    const iconPath = app.isPackaged
        ? path.join(process.resourcesPath, 'icon.png')
        : path.join(__dirname, 'build', 'icon.png');

    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        icon: iconPath,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        autoHideMenuBar: true,
    });

    // In production, load the built React app. In dev, load localhost.
    const isDev = !app.isPackaged;

    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(__dirname, 'frontend/dist/index.html'));
    }

    mainWindow.on('close', function (event) {
        if (!isQuitting) {
            event.preventDefault();
            mainWindow.hide();
            return false;
        }
    });

    mainWindow.on('closed', function () {
        mainWindow = null;
    });
}

function waitForBackend(maxRetries = 30, interval = 1000) {
    return new Promise((resolve) => {
        let retries = 0;
        const check = () => {
            const req = http.get('http://127.0.0.1:8000/health', (res) => {
                log(`Backend is ready! (status ${res.statusCode})`);
                resolve(true);
            });
            req.on('error', () => {
                retries++;
                if (retries < maxRetries) {
                    log(`Waiting for backend... attempt ${retries}/${maxRetries}`);
                    setTimeout(check, interval);
                } else {
                    log('WARNING: Backend did not start within timeout. Loading UI anyway.');
                    resolve(false);
                }
            });
            req.setTimeout(2000, () => { req.destroy(); });
        };
        check();
    });
}

function startPythonBackend() {
    const isDev = !app.isPackaged;

    if (isDev) {
        log("Running in dev mode. Ensure python backend is running manually.");
        return;
    }

    // In production, spawn the bundled executable
    const executablePath = path.join(process.resourcesPath, 'backend.exe');
    log(`Starting Python backend from: ${executablePath}`);
    log(`File exists: ${fs.existsSync(executablePath)}`);
    log(`Resources dir: ${process.resourcesPath}`);
    log(`Resources contents: ${fs.readdirSync(process.resourcesPath).join(', ')}`);

    // Set CWD to the resources directory where .env lives
    const cwd = process.resourcesPath;
    log(`Backend CWD: ${cwd}`);

    pythonProcess = spawn(executablePath, [], {
        detached: false,
        windowsHide: true,
        cwd: cwd,
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
    });

    pythonProcess.stdout.on('data', (data) => {
        const msg = data.toString().trim();
        log(`Backend: ${msg}`);
    });

    pythonProcess.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        log(`Backend ERR: ${msg}`);
    });

    pythonProcess.on('error', (err) => {
        log(`Backend SPAWN ERROR: ${err.message}`);
    });

    pythonProcess.on('close', (code) => {
        log(`Backend process exited with code ${code}`);
    });
}

// ─── Electron Log endpoint ───
// Expose the log file path to the renderer so DebugConsole can read it
ipcMain.handle('get-log-path', () => logPath);

app.on('ready', async () => {
    // Clear old log
    try { fs.writeFileSync(logPath, ''); } catch (e) { }

    log('═══ ELECTRON APP STARTING ═══');
    log(`App version: ${app.getVersion()}`);
    log(`Is packaged: ${app.isPackaged}`);
    log(`User data: ${app.getPath('userData')}`);

    startPythonBackend();

    // Wait for the backend to actually be ready (up to 30 seconds)
    log('Waiting for backend to be ready...');
    await waitForBackend(30, 1000);

    createWindow();

    // Auto updater logic
    autoUpdater.checkForUpdatesAndNotify();

    // System Tray logic
    const trayIconPath = app.isPackaged
        ? path.join(process.resourcesPath, 'icon.png')
        : path.join(__dirname, 'build', 'icon.png');
    const trayIcon = nativeImage.createFromPath(trayIconPath).resize({ width: 16, height: 16 });
    tray = new Tray(trayIcon);
    const contextMenu = Menu.buildFromTemplate([
        { label: 'Show CF Scanner', click: () => mainWindow.show() },
        {
            label: 'Quit', click: () => {
                isQuitting = true;
                app.quit();
            }
        }
    ]);
    tray.setToolTip('Antigravity Scanner');
    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => {
        mainWindow.show();
    });
});

autoUpdater.on('update-available', () => {
    if (mainWindow) mainWindow.webContents.send('update_available');
});

autoUpdater.on('update-downloaded', () => {
    if (mainWindow) mainWindow.webContents.send('update_downloaded');
});

ipcMain.on('restart_app', () => {
    autoUpdater.quitAndInstall();
});

app.on('window-all-closed', function () {
    // Keep app running in tray when all windows are closed
});

app.on('will-quit', () => {
    if (pythonProcess) {
        log("Killing python backend process...");
        pythonProcess.kill('SIGINT');
    }
});
