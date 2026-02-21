const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let pythonProcess;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
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
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('will-quit', () => {
    // Ensure we kill the python background process!
    if (pythonProcess) {
        console.log("Killing python backend process...");
        pythonProcess.kill('SIGINT');
    }
});
