const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');

let mainWindow;
let pythonProcess;
let tray = null;
let isQuitting = false;

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

function startPythonBackend() {
    const isDev = !app.isPackaged;

    if (isDev) {
        // In dev, assuming the dev server is started via `npm run dev` in backend separately or concurrently
        console.log("Running in dev mode. Ensure python backend is running manually.");
    } else {
        // In production, spawn the bundled executable
        const executablePath = path.join(process.resourcesPath, 'backend.exe');
        console.log(`Starting Python backend from: ${executablePath}`);

        pythonProcess = spawn(executablePath, [], {
            detached: false, // We want it to die when the parent dies
            windowsHide: true
        });

        pythonProcess.stdout.on('data', (data) => {
            console.log(`Backend stdout: ${data}`);
        });

        pythonProcess.stderr.on('data', (data) => {
            console.error(`Backend stderr: ${data}`);
        });

        pythonProcess.on('close', (code) => {
            console.log(`Python backend exited with code ${code}`);
        });
    }
}

app.on('ready', () => {
    startPythonBackend();

    // Give the python backend a second or two to bind to port 8000 before loading UI
    setTimeout(createWindow, 2000);

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
    // Do nothing here instead of app.quit()
});

app.on('will-quit', () => {
    // Ensure we kill the python background process!
    if (pythonProcess) {
        console.log("Killing python backend process...");
        pythonProcess.kill('SIGINT');
    }
});
