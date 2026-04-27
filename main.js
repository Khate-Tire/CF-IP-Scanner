/* Copyright (c) 2026 Khate Tire */
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const { autoUpdater } = require('electron-updater');
const http = require('http');

let mainWindow;
let pythonProcess;
let tray = null;
let isQuitting = false;

// ─── Log File ───
const logPath = path.join(app.getPath('userData'), 'backend.log');

// ─── Single Instance Lock ───
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // Someone tried to run a second instance, focus our window.
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
    });
}

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
        show: false,
        backgroundColor: '#0f172a',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            preload: path.join(__dirname, 'preload.js')
        },
        autoHideMenuBar: true,
    });

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
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

function checkBackendHealth() {
    return new Promise((resolve) => {
        const req = http.get('http://127.0.0.1:8000/', (res) => {
            resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.setTimeout(1500, () => { req.destroy(); resolve(false); });
    });
}

function killProcessOnPort(port) {
    // Strict integer validation — these values feed into shell commands.
    const portNum = Number(port);
    if (!Number.isInteger(portNum) || portNum <= 0 || portNum > 65535) {
        log(`killProcessOnPort: refusing invalid port ${port}`);
        return;
    }
    const safePort = String(portNum);
    const isValidPid = (pid) => /^[0-9]+$/.test(pid) && pid !== '0';
    if (process.platform === 'win32') {
        try {
            const result = execSync(`netstat -ano | findstr :${safePort} | findstr LISTENING`, { encoding: 'utf8' });
            const lines = result.trim().split('\n');
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                const pid = parts[parts.length - 1];
                if (isValidPid(pid)) {
                    execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
                    log(`Killed stale process PID ${pid} on port ${safePort}`);
                }
            }
        } catch (e) { /* no process on port — normal */ }
    } else {
        try {
            const result = execSync(`lsof -ti :${safePort}`, { encoding: 'utf8' });
            for (const pid of result.trim().split('\n')) {
                if (isValidPid(pid)) {
                    execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
                    log(`Killed stale process PID ${pid} on port ${safePort}`);
                }
            }
        } catch (e) { /* no process on port — normal */ }
    }
}

async function startPythonBackend() {
    const isDev = !app.isPackaged;

    if (isDev) {
        log("Running in dev mode. Ensure python backend is running manually.");
        return;
    }

    // Check if an existing backend on port 8000 is already healthy
    const alive = await checkBackendHealth();
    if (alive) {
        log("Existing backend on port 8000 is healthy. Reusing it.");
        return;
    }

    // Port 8000 is not responding — kill only the specific stale process on that port
    killProcessOnPort(8000);

    // In production, spawn the bundled executable
    const isWin = process.platform === 'win32';
    const backendName = isWin ? 'backend.exe' : 'backend';
    const executablePath = path.join(process.resourcesPath, backendName);
    log(`Starting Python backend from: ${executablePath}`);
    log(`Platform: ${process.platform}`);
    log(`File exists: ${fs.existsSync(executablePath)}`);
    log(`Resources dir: ${process.resourcesPath}`);
    log(`Resources contents: ${fs.readdirSync(process.resourcesPath).join(', ')}`);

    // Set CWD to the resources directory where .env lives
    const cwd = process.resourcesPath;
    log(`Backend CWD: ${cwd}`);

    const spawnOpts = {
        detached: false,
        cwd: cwd,
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
    };
    if (isWin) spawnOpts.windowsHide = true;

    pythonProcess = spawn(executablePath, [], spawnOpts);

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

// ─── Electron IPC ───
// Read the log file in main and return its content (renderer no longer touches fs).
ipcMain.handle('read-log-file', () => {
    try {
        if (!fs.existsSync(logPath)) return '';
        return fs.readFileSync(logPath, 'utf8');
    } catch (e) {
        return '';
    }
});
// Backend URL discovery (currently fixed; future: dynamic port).
ipcMain.handle('get-backend-url', () => 'http://127.0.0.1:8000');
// Legacy alias (kept so an old renderer build won't crash mid-upgrade).
ipcMain.handle('get-log-path', () => logPath);

app.on('ready', async () => {
    // Clear old log
    try { fs.writeFileSync(logPath, ''); } catch (e) { }

    log('═══ ELECTRON APP STARTING ═══');
    log(`App version: ${app.getVersion()}`);
    log(`Is packaged: ${app.isPackaged}`);
    log(`User data: ${app.getPath('userData')}`);

    // Show the window immediately so the user sees the UI right away
    createWindow();

    // Start backend and wait for it in the background (UI is already visible)
    startPythonBackend().then(() => {
        log('Waiting for backend to be ready...');
        return waitForBackend(60, 1000);
    }).then((ready) => {
        if (ready && mainWindow) {
            mainWindow.webContents.send('backend-ready');
            log('Backend ready signal sent to renderer');
        }
    });

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
        const pid = pythonProcess.pid;
        const validPid = Number.isInteger(pid) && pid > 0;
        if (process.platform === 'win32') {
            if (validPid) {
                try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }); } catch (e) { }
            }
        } else {
            try { pythonProcess.kill('SIGTERM'); } catch (e) { }
            // Force-kill after 5s if SIGTERM didn't take.
            setTimeout(() => {
                try { if (pythonProcess) pythonProcess.kill('SIGKILL'); } catch (e) { }
            }, 5000);
        }
        pythonProcess = null;
    }
});
